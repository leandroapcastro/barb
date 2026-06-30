"use strict";

/**
 * db.js — camada de acesso ao banco SQLite multi-tenant.
 *
 * Toda função aqui que lê/escreve dados de domínio exige tenantId.
 * Isso é proposital: não existe nenhum "modo sem tenant" para as tabelas
 * de domínio, então é estruturalmente difícil vazar dado de uma barbearia
 * para outra por esquecimento de filtro.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const BASE_DIR = path.join(__dirname);
const SCHEMA_FILE = path.join(BASE_DIR, "schema.sql");

// Em produção no Fly.io existe um volume persistente montado em /data
// (ver fly.toml: [[mounts]] destination = "/data"). Sem isso, o banco
// SQLite seria gravado no filesystem efêmero do container e os dados
// se perderiam a cada restart/deploy. Em desenvolvimento local, /data
// normalmente não existe, então caímos de volta para a pasta do projeto.
const DATA_DIR = fs.existsSync("/data") ? "/data" : BASE_DIR;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "barbearia-prod.sqlite");

let db;

function getConnection() {
  if (db) return db;
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function applySchema() {
  const conn = getConnection();
  const schema = fs.readFileSync(SCHEMA_FILE, "utf8");
  conn.exec(schema);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

function createTenant({ name, slug, notifyEmail }) {
  const conn = getConnection();
  const id = newId("t");
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  conn.prepare(`
    INSERT INTO tenants (id, slug, name, notify_email, plan, status, trial_ends_at)
    VALUES (?, ?, ?, ?, 'trial', 'active', ?)
  `).run(id, slug, name, notifyEmail || "", trialEnds.toISOString());

  conn.prepare(`INSERT INTO settings (tenant_id) VALUES (?)`).run(id);

  return getTenantById(id);
}

function getTenantBySlug(slug) {
  return getConnection()
    .prepare(`SELECT * FROM tenants WHERE slug = ?`)
    .get(slug.toLowerCase());
}

function getTenantById(id) {
  return getConnection().prepare(`SELECT * FROM tenants WHERE id = ?`).get(id);
}

function slugExists(slug) {
  return Boolean(getTenantBySlug(slug));
}

// ---------------------------------------------------------------------------
// Settings (1:1 por tenant)
// ---------------------------------------------------------------------------

function getSettings(tenantId) {
  const row = getConnection()
    .prepare(`SELECT * FROM settings WHERE tenant_id = ?`)
    .get(tenantId);

  if (!row) return null;

  return {
    printer: {
      name: row.printer_name,
      paperWidth: row.printer_paper_width,
      copies: row.printer_copies,
      showPreview: Boolean(row.printer_show_preview),
      receiptFooter: row.printer_receipt_footer,
    },
    dashboard: {
      showSalesChart: Boolean(row.dashboard_show_sales),
      showPaymentChart: Boolean(row.dashboard_show_payment),
      showStockAlerts: Boolean(row.dashboard_show_stock),
      payableAlertDays: row.dashboard_payable_days,
    },
    agenda: {
      startTime: row.agenda_start_time,
      endTime: row.agenda_end_time,
      slotMinutes: row.agenda_slot_minutes,
    },
  };
}

function updateSettings(tenantId, patch) {
  const current = getSettings(tenantId);
  if (!current) throw new Error("Tenant sem configuracoes inicializadas.");

  const merged = {
    printer: { ...current.printer, ...(patch.printer || {}) },
    dashboard: { ...current.dashboard, ...(patch.dashboard || {}) },
    agenda: { ...current.agenda, ...(patch.agenda || {}) },
  };

  getConnection().prepare(`
    UPDATE settings SET
      printer_name = ?, printer_paper_width = ?, printer_copies = ?,
      printer_show_preview = ?, printer_receipt_footer = ?,
      dashboard_show_sales = ?, dashboard_show_payment = ?,
      dashboard_show_stock = ?, dashboard_payable_days = ?,
      agenda_start_time = ?, agenda_end_time = ?, agenda_slot_minutes = ?
    WHERE tenant_id = ?
  `).run(
    merged.printer.name,
    merged.printer.paperWidth,
    merged.printer.copies,
    merged.printer.showPreview ? 1 : 0,
    merged.printer.receiptFooter,
    merged.dashboard.showSalesChart ? 1 : 0,
    merged.dashboard.showPaymentChart ? 1 : 0,
    merged.dashboard.showStockAlerts ? 1 : 0,
    merged.dashboard.payableAlertDays,
    merged.agenda.startTime,
    merged.agenda.endTime,
    merged.agenda.slotMinutes,
    tenantId
  );

  return merged;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    commissionRate: row.commission_rate,
    active: Boolean(row.active),
  };
}

function listUsers(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM users WHERE tenant_id = ? AND active = 1 ORDER BY name`)
    .all(tenantId)
    .map(rowToUser);
}

function getUserByEmail(tenantId, email) {
  const row = getConnection()
    .prepare(`SELECT * FROM users WHERE tenant_id = ? AND email = ? AND active = 1`)
    .get(tenantId, email.toLowerCase());
  return rowToUser(row);
}

function getUserById(tenantId, userId) {
  const row = getConnection()
    .prepare(`SELECT * FROM users WHERE tenant_id = ? AND id = ? AND active = 1`)
    .get(tenantId, userId);
  return rowToUser(row);
}

function createUser(tenantId, { name, email, passwordHash, role, commissionRate }) {
  const id = newId("u");
  getConnection().prepare(`
    INSERT INTO users (id, tenant_id, name, email, password_hash, role, commission_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, name, email.toLowerCase(), passwordHash, role, commissionRate);
  return getUserById(tenantId, id);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

function rowToService(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, price: row.price, duration: row.duration, active: Boolean(row.active) };
}

function listServices(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM services WHERE tenant_id = ? AND active = 1 ORDER BY name`)
    .all(tenantId)
    .map(rowToService);
}

function getServiceById(tenantId, id) {
  return rowToService(
    getConnection().prepare(`SELECT * FROM services WHERE tenant_id = ? AND id = ?`).get(tenantId, id)
  );
}

function createService(tenantId, { name, price, duration }) {
  const id = newId("s");
  getConnection()
    .prepare(`INSERT INTO services (id, tenant_id, name, price, duration) VALUES (?, ?, ?, ?, ?)`)
    .run(id, tenantId, name, price, duration);
  return getServiceById(tenantId, id);
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

function rowToAppointment(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientEmail: row.client_email,
    serviceId: row.service_id,
    barberId: row.barber_id,
    date: row.date,
    time: row.time,
    status: row.status,
    publicRequest: Boolean(row.public_request),
  };
}

function listAppointments(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM appointments WHERE tenant_id = ? ORDER BY date, time`)
    .all(tenantId)
    .map(rowToAppointment);
}

function listAppointmentsByDateBarber(tenantId, date, barberId) {
  return getConnection()
    .prepare(`
      SELECT * FROM appointments
      WHERE tenant_id = ? AND date = ? AND barber_id = ? AND status != 'cancelado'
    `)
    .all(tenantId, date, barberId)
    .map(rowToAppointment);
}

function createAppointment(tenantId, data) {
  const id = newId("a");
  getConnection().prepare(`
    INSERT INTO appointments
      (id, tenant_id, client_name, client_phone, client_email, service_id, barber_id, date, time, status, public_request)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, tenantId, data.clientName, data.clientPhone, data.clientEmail || "",
    data.serviceId, data.barberId, data.date, data.time,
    data.status || "agendado", data.publicRequest ? 1 : 0
  );
  return getAppointmentById(tenantId, id);
}

function getAppointmentById(tenantId, id) {
  return rowToAppointment(
    getConnection().prepare(`SELECT * FROM appointments WHERE tenant_id = ? AND id = ?`).get(tenantId, id)
  );
}

function updateAppointment(tenantId, id, patch) {
  const current = getAppointmentById(tenantId, id);
  if (!current) return null;
  const merged = { ...current, ...patch };

  getConnection().prepare(`
    UPDATE appointments SET
      client_name = ?, client_phone = ?, client_email = ?,
      service_id = ?, barber_id = ?, date = ?, time = ?, status = ?
    WHERE tenant_id = ? AND id = ?
  `).run(
    merged.clientName, merged.clientPhone, merged.clientEmail || "",
    merged.serviceId, merged.barberId, merged.date, merged.time, merged.status,
    tenantId, id
  );

  return getAppointmentById(tenantId, id);
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    barcode: row.barcode,
    quantity: row.quantity,
    minQuantity: row.min_quantity,
    unitCost: row.unit_cost,
    salePrice: row.sale_price,
  };
}

function listStock(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM stock WHERE tenant_id = ? ORDER BY name`)
    .all(tenantId)
    .map(rowToProduct);
}

function getProductById(tenantId, id) {
  return rowToProduct(
    getConnection().prepare(`SELECT * FROM stock WHERE tenant_id = ? AND id = ?`).get(tenantId, id)
  );
}

function getProductByBarcode(tenantId, barcode) {
  return rowToProduct(
    getConnection()
      .prepare(`SELECT * FROM stock WHERE tenant_id = ? AND barcode = ? AND barcode != ''`)
      .get(tenantId, barcode)
  );
}

function createProduct(tenantId, data) {
  const id = newId("p");
  getConnection().prepare(`
    INSERT INTO stock (id, tenant_id, name, barcode, quantity, min_quantity, unit_cost, sale_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, data.name, data.barcode || "", data.quantity, data.minQuantity, data.unitCost, data.salePrice);
  return getProductById(tenantId, id);
}

function updateProduct(tenantId, id, patch) {
  const current = getProductById(tenantId, id);
  if (!current) return null;
  const merged = { ...current, ...patch };

  getConnection().prepare(`
    UPDATE stock SET name = ?, barcode = ?, quantity = ?, min_quantity = ?, unit_cost = ?, sale_price = ?
    WHERE tenant_id = ? AND id = ?
  `).run(merged.name, merged.barcode || "", merged.quantity, merged.minQuantity, merged.unitCost, merged.salePrice, tenantId, id);

  return getProductById(tenantId, id);
}

function decrementStock(tenantId, id, quantity) {
  getConnection()
    .prepare(`UPDATE stock SET quantity = quantity - ? WHERE tenant_id = ? AND id = ?`)
    .run(quantity, tenantId, id);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

function createSale(tenantId, { date, clientName, barberId, paymentMethod, items }) {
  const conn = getConnection();
  const saleId = newId("v");
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const tx = conn.transaction(() => {
    conn.prepare(`
      INSERT INTO sales (id, tenant_id, date, client_name, barber_id, payment_method, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(saleId, tenantId, date, clientName, barberId, paymentMethod, total);

    const insertItem = conn.prepare(`
      INSERT INTO sale_items (id, sale_id, tenant_id, type, ref_id, name, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(newId("vi"), saleId, tenantId, item.type, item.refId, item.name, item.quantity, item.unitPrice);
      if (item.type === "product") {
        decrementStock(tenantId, item.refId, item.quantity);
      }
    }
  });

  tx();
  return getSaleById(tenantId, saleId);
}

function getSaleById(tenantId, id) {
  const conn = getConnection();
  const sale = conn.prepare(`SELECT * FROM sales WHERE tenant_id = ? AND id = ?`).get(tenantId, id);
  if (!sale) return null;
  const items = conn.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(id);
  return rowToSale(sale, items);
}

function rowToSale(row, items) {
  return {
    id: row.id,
    date: row.date,
    clientName: row.client_name,
    barberId: row.barber_id,
    paymentMethod: row.payment_method,
    total: row.total,
    items: items.map((i) => ({
      type: i.type, refId: i.ref_id, name: i.name, quantity: i.quantity, unitPrice: i.unit_price,
    })),
  };
}

function listSales(tenantId) {
  const conn = getConnection();
  const sales = conn.prepare(`SELECT * FROM sales WHERE tenant_id = ? ORDER BY date DESC, created_at DESC`).all(tenantId);
  const itemsBySale = conn.prepare(`SELECT * FROM sale_items WHERE tenant_id = ?`).all(tenantId)
    .reduce((acc, item) => {
      (acc[item.sale_id] ||= []).push(item);
      return acc;
    }, {});
  return sales.map((s) => rowToSale(s, itemsBySale[s.id] || []));
}

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------

function rowToPayable(row) {
  if (!row) return null;
  return { id: row.id, description: row.description, dueDate: row.due_date, amount: row.amount, status: row.status };
}

function listPayables(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM payables WHERE tenant_id = ? ORDER BY due_date`)
    .all(tenantId)
    .map(rowToPayable);
}

function createPayable(tenantId, data) {
  const id = newId("cp");
  getConnection().prepare(`
    INSERT INTO payables (id, tenant_id, description, due_date, amount, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, data.description, data.dueDate, data.amount, data.status || "pendente");
  return rowToPayable(getConnection().prepare(`SELECT * FROM payables WHERE id = ?`).get(id));
}

function updatePayable(tenantId, id, patch) {
  const current = getConnection().prepare(`SELECT * FROM payables WHERE tenant_id = ? AND id = ?`).get(tenantId, id);
  if (!current) return null;
  const merged = { ...rowToPayable(current), ...patch };

  getConnection().prepare(`
    UPDATE payables SET description = ?, due_date = ?, amount = ?, status = ? WHERE tenant_id = ? AND id = ?
  `).run(merged.description, merged.dueDate, merged.amount, merged.status, tenantId, id);

  return rowToPayable(getConnection().prepare(`SELECT * FROM payables WHERE id = ?`).get(id));
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

function rowToPayrollRecord(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, period: row.period,
    baseSalary: row.base_salary, commission: row.commission, status: row.status,
  };
}

function listPayroll(tenantId) {
  return getConnection()
    .prepare(`SELECT * FROM payroll WHERE tenant_id = ? ORDER BY period DESC`)
    .all(tenantId)
    .map(rowToPayrollRecord);
}

function upsertPayrollCommission(tenantId, userId, period, commission) {
  const conn = getConnection();
  const existing = conn
    .prepare(`SELECT * FROM payroll WHERE tenant_id = ? AND user_id = ? AND period = ?`)
    .get(tenantId, userId, period);

  if (existing) {
    conn.prepare(`UPDATE payroll SET commission = ? WHERE id = ?`).run(commission, existing.id);
    return rowToPayrollRecord({ ...existing, commission });
  }

  const id = newId("pg");
  conn.prepare(`
    INSERT INTO payroll (id, tenant_id, user_id, period, base_salary, commission, status)
    VALUES (?, ?, ?, ?, 0, ?, 'pendente')
  `).run(id, tenantId, userId, period, commission);
  return rowToPayrollRecord(conn.prepare(`SELECT * FROM payroll WHERE id = ?`).get(id));
}

function salesForCommission(tenantId, userId, period) {
  return getConnection()
    .prepare(`SELECT total FROM sales WHERE tenant_id = ? AND barber_id = ? AND date LIKE ?`)
    .all(tenantId, userId, `${period}%`);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function enqueueNotification(tenantId, { appointmentId, recipient, kind, subject, body, channel }) {
  if (!recipient) return null; // sem destinatário, não há o que enfileirar
  const id = newId("n");
  getConnection().prepare(`
    INSERT INTO notifications (id, tenant_id, appointment_id, channel, recipient, kind, subject, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, appointmentId || null, channel || "email", recipient, kind, subject || "", body);
  return id;
}

function listPendingNotifications(limit = 20) {
  return getConnection()
    .prepare(`SELECT * FROM notifications WHERE status = 'pendente' ORDER BY created_at LIMIT ?`)
    .all(limit);
}

function markNotificationSent(id) {
  getConnection()
    .prepare(`UPDATE notifications SET status = 'enviado', sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`)
    .run(id);
}

function markNotificationFailed(id) {
  getConnection()
    .prepare(`UPDATE notifications SET status = 'falhou', attempts = attempts + 1 WHERE id = ?`)
    .run(id);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function createSession(tenantId, userId, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  getConnection().prepare(`
    INSERT INTO sessions (token, tenant_id, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, tenantId, userId, now, now + ttlMs);
  return token;
}

function getSession(token) {
  const row = getConnection().prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  return { tenantId: row.tenant_id, userId: row.user_id };
}

function deleteSession(token) {
  getConnection().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

function purgeExpiredSessions() {
  getConnection().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
}

// ---------------------------------------------------------------------------
// Rate limiting de login
// ---------------------------------------------------------------------------

function recordLoginAttempt({ tenantId, email, ip, success }) {
  getConnection().prepare(`
    INSERT INTO login_attempts (tenant_id, email, ip, success, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId || null, email.toLowerCase(), ip, success ? 1 : 0, Date.now());
}

/**
 * Conta tentativas falhas recentes para um par email+ip.
 * Usado para bloquear força bruta no login.
 */
function recentFailedAttempts(email, ip, windowMs) {
  const since = Date.now() - windowMs;
  const row = getConnection()
    .prepare(`
      SELECT COUNT(*) AS count FROM login_attempts
      WHERE email = ? AND ip = ? AND success = 0 AND created_at > ?
    `)
    .get(email.toLowerCase(), ip, since);
  return row.count;
}

// ---------------------------------------------------------------------------
// Dashboard (agregações)
// ---------------------------------------------------------------------------

function dashboardData(tenantId) {
  const services = listServices(tenantId);
  const stock = listStock(tenantId);
  const sales = listSales(tenantId);
  const appointments = listAppointments(tenantId);
  const payables = listPayables(tenantId);
  const settings = getSettings(tenantId);

  return { services, stock, sales, appointments, payables, settings };
}

module.exports = {
  getConnection,
  applySchema,
  newId,
  // tenants
  createTenant,
  getTenantBySlug,
  getTenantById,
  slugExists,
  // settings
  getSettings,
  updateSettings,
  // users
  listUsers,
  getUserByEmail,
  getUserById,
  createUser,
  // services
  listServices,
  getServiceById,
  createService,
  // appointments
  listAppointments,
  listAppointmentsByDateBarber,
  createAppointment,
  getAppointmentById,
  updateAppointment,
  // stock
  listStock,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  // sales
  createSale,
  getSaleById,
  listSales,
  // payables
  listPayables,
  createPayable,
  updatePayable,
  // payroll
  listPayroll,
  upsertPayrollCommission,
  salesForCommission,
  // notifications
  enqueueNotification,
  listPendingNotifications,
  markNotificationSent,
  markNotificationFailed,
  // sessions
  createSession,
  getSession,
  deleteSession,
  purgeExpiredSessions,
  // login attempts
  recordLoginAttempt,
  recentFailedAttempts,
  // dashboard
  dashboardData,
};
