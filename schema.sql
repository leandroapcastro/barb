-- ============================================================================
-- Schema multi-tenant — Sistema de Barbearias
-- ============================================================================
-- Cada barbearia é um "tenant" isolado por tenant_id. Todas as tabelas de
-- domínio (exceto `tenants`) carregam tenant_id e toda query do backend
-- DEVE filtrar por ele — não existe outra barreira de isolamento.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tenants (barbearias cadastradas no sistema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,   -- usado no subdomínio: slug.dominio.com
    name            TEXT NOT NULL,
    slogan          TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    address         TEXT DEFAULT '',
    opening_hours   TEXT DEFAULT '',
    plan            TEXT NOT NULL DEFAULT 'trial',   -- trial | basic | pro
    status          TEXT NOT NULL DEFAULT 'active',  -- active | suspended | canceled
    notify_email    TEXT DEFAULT '',        -- remetente usado nas notificações
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    trial_ends_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ---------------------------------------------------------------------------
-- Configurações por tenant (1:1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    tenant_id               TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    printer_name             TEXT DEFAULT 'Impressora padrao',
    printer_paper_width      TEXT DEFAULT '80mm',
    printer_copies           INTEGER DEFAULT 1,
    printer_show_preview     INTEGER DEFAULT 1,
    printer_receipt_footer   TEXT DEFAULT 'Obrigado pela preferencia!',
    dashboard_show_sales     INTEGER DEFAULT 1,
    dashboard_show_payment   INTEGER DEFAULT 1,
    dashboard_show_stock     INTEGER DEFAULT 1,
    dashboard_payable_days   INTEGER DEFAULT 7,
    agenda_start_time        TEXT DEFAULT '09:00',
    agenda_end_time           TEXT DEFAULT '20:00',
    agenda_slot_minutes       INTEGER DEFAULT 30
);

-- ---------------------------------------------------------------------------
-- Usuários (login interno: admin, gerente, barbeiro)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL,
    password_hash    TEXT NOT NULL,         -- bcrypt, nunca texto puro
    role             TEXT NOT NULL DEFAULT 'barbeiro',  -- admin | gerente | barbeiro
    commission_rate  REAL NOT NULL DEFAULT 0,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ---------------------------------------------------------------------------
-- Serviços oferecidos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    price       REAL NOT NULL DEFAULT 0,
    duration    INTEGER NOT NULL DEFAULT 30,  -- minutos
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);

-- ---------------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_name     TEXT NOT NULL,
    client_phone    TEXT NOT NULL,
    client_email    TEXT DEFAULT '',
    service_id      TEXT NOT NULL REFERENCES services(id),
    barber_id       TEXT NOT NULL REFERENCES users(id),
    date            TEXT NOT NULL,   -- YYYY-MM-DD
    time            TEXT NOT NULL,   -- HH:MM
    status          TEXT NOT NULL DEFAULT 'agendado', -- solicitado | agendado | concluido | cancelado
    public_request  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON appointments(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_barber ON appointments(tenant_id, barber_id, date);

-- ---------------------------------------------------------------------------
-- Estoque
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    barcode       TEXT DEFAULT '',
    quantity      INTEGER NOT NULL DEFAULT 0,
    min_quantity  INTEGER NOT NULL DEFAULT 0,
    unit_cost     REAL NOT NULL DEFAULT 0,
    sale_price    REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stock_tenant ON stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant_barcode ON stock(tenant_id, barcode);

-- ---------------------------------------------------------------------------
-- Vendas (cabeçalho) e itens da venda
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,
    client_name     TEXT NOT NULL DEFAULT 'Cliente Balcao',
    barber_id       TEXT NOT NULL REFERENCES users(id),
    payment_method  TEXT NOT NULL DEFAULT 'dinheiro',
    total           REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
    id          TEXT PRIMARY KEY,
    sale_id     TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,         -- service | product
    ref_id      TEXT NOT NULL,
    name        TEXT NOT NULL,
    quantity    REAL NOT NULL DEFAULT 1,
    unit_price  REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- ---------------------------------------------------------------------------
-- Contas a pagar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payables (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description   TEXT NOT NULL,
    due_date      TEXT NOT NULL,
    amount        REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pendente'  -- pendente | pago
);

CREATE INDEX IF NOT EXISTS idx_payables_tenant_due ON payables(tenant_id, due_date);

-- ---------------------------------------------------------------------------
-- Folha de pagamento / comissões
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id),
    period        TEXT NOT NULL,  -- YYYY-MM
    base_salary   REAL NOT NULL DEFAULT 0,
    commission    REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pendente',
    UNIQUE(tenant_id, user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_tenant_period ON payroll(tenant_id, period);

-- ---------------------------------------------------------------------------
-- Notificações (fila simples — confirmação e lembrete de agendamento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id  TEXT REFERENCES appointments(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL DEFAULT 'email',   -- email | sms (futuro)
    recipient       TEXT NOT NULL,                    -- e-mail ou telefone do cliente
    kind            TEXT NOT NULL,                    -- confirmacao | lembrete | cancelamento
    subject         TEXT DEFAULT '',
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviado | falhou
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);

-- ---------------------------------------------------------------------------
-- Sessões (login) — persistidas para sobreviver a restart do servidor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,   -- epoch ms
    expires_at  INTEGER NOT NULL    -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Tentativas de login (rate limiting básico)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT,
    email       TEXT NOT NULL,
    ip          TEXT NOT NULL,
    success     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL   -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(email, ip, created_at);
