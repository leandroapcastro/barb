"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const db = require("./db");
const auth = require("./auth");
const notifications = require("./notifications");
const { resolveTenantSlug, isValidSlug } = require("./tenant");

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const NOTIFICATION_POLL_MS = 30 * 1000; // processa fila a cada 30s

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const MAX_BYTES = 1_000_000;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BYTES) req.destroy(new Error("Payload muito grande."));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON invalido no corpo da requisicao."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  return (req.headers.cookie || "").split(";").reduce((acc, part) => {
    const [key, ...val] = part.trim().split("=");
    if (key) acc[key] = decodeURIComponent(val.join("="));
    return acc;
  }, {});
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// Tenant + autenticação — middlewares funcionais
// ---------------------------------------------------------------------------

/**
 * Resolve o tenant da requisição. Retorna null e já responde com erro
 * se nenhum tenant válido foi identificado.
 */
function requireTenant(req, res, url) {
  const slug = resolveTenantSlug(req, url);
  if (!slug) {
    sendError(res, 400, "Barbearia nao identificada. Acesse pelo endereco correto (ex: suabarbearia.dominio.com).");
    return null;
  }

  const tenant = db.getTenantBySlug(slug);
  if (!tenant) {
    sendError(res, 404, "Barbearia nao encontrada.");
    return null;
  }

  if (tenant.status !== "active") {
    sendError(res, 403, "Esta conta esta temporariamente indisponivel. Entre em contato com o suporte.");
    return null;
  }

  return tenant;
}

function requireAuth(req, res, tenant) {
  const token = parseCookies(req).sessionId;
  const user = auth.getSessionUser(token);

  if (!user || user.tenantId !== tenant.id) {
    sendError(res, 401, "Voce precisa estar logado.");
    return null;
  }
  return user;
}

function requirePermission(req, res, tenant, permission) {
  const user = requireAuth(req, res, tenant);
  if (!user) return null;
  if (!auth.canAccess(user, permission)) {
    sendError(res, 403, "Seu nivel de acesso nao permite esta acao.");
    return null;
  }
  return user;
}

// ---------------------------------------------------------------------------
// Utilitários de domínio
// ---------------------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildSlots(startTime, endTime, slotMinutes) {
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const slots = [];
  for (let m = start; m < end; m += slotMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

function enrichSale(tenantId, sale) {
  const barber = db.getUserById(tenantId, sale.barberId);
  return { ...sale, barberName: barber ? barber.name : "Sem barbeiro" };
}

function calculateCommissionTotal(tenantId, userId, period) {
  const user = db.getUserById(tenantId, userId);
  if (!user) return 0;
  const rate = Number(user.commissionRate || 0);
  const sales = db.salesForCommission(tenantId, userId, period);
  return sales.reduce((sum, s) => sum + Number(s.total || 0) * rate, 0);
}

function formatDashboard(tenantId) {
  const { services, stock, sales, appointments, payables, settings } = db.dashboardData(tenantId);
  const today = todayIso();
  const alertDays = Number(settings?.dashboard?.payableAlertDays || 7);
  const alertLimit = new Date();
  alertLimit.setDate(alertLimit.getDate() + alertDays);
  const alertLimitDate = alertLimit.toISOString().slice(0, 10);

  const salesTotal = sales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const openPayables = payables
    .filter((p) => p.status !== "pago")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const lowStock = stock.filter((i) => Number(i.quantity) <= Number(i.minQuantity));
  const todayAppointments = appointments.filter((a) => a.date === today);
  const upcomingPayables = payables
    .filter((p) => p.status !== "pago" && p.dueDate >= today && p.dueDate <= alertLimitDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const salesByDay = {};
  const paymentMethods = {};
  for (const sale of sales) {
    salesByDay[sale.date] = (salesByDay[sale.date] || 0) + Number(sale.total || 0);
    paymentMethods[sale.paymentMethod] = (paymentMethods[sale.paymentMethod] || 0) + Number(sale.total || 0);
  }

  return {
    salesTotal,
    openPayables,
    lowStockCount: lowStock.length,
    appointmentCount: appointments.length,
    todayAppointments,
    lowStock,
    upcomingPayables,
    salesByDay: Object.entries(salesByDay).map(([date, total]) => ({ date, total })),
    paymentMethods: Object.entries(paymentMethods).map(([method, total]) => ({ method, total })),
    settings: settings.dashboard,
  };
}

// ---------------------------------------------------------------------------
// Roteador da API
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname, url) {
  try {
    // ---- Cadastro de novo tenant (signup) — não exige tenant resolvido ----

    if (req.method === "POST" && pathname === "/api/signup") {
      const body = await readBody(req);
      const required = ["barbershopName", "slug", "adminName", "adminEmail", "adminPassword"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length) {
        return sendError(res, 400, "Preencha todos os campos do cadastro.");
      }

      const slug = String(body.slug).toLowerCase().trim();
      if (!isValidSlug(slug)) {
        return sendError(res, 400, "Endereco invalido. Use apenas letras minusculas, numeros e hifen.");
      }
      if (db.slugExists(slug)) {
        return sendError(res, 409, "Esse endereco ja esta em uso. Escolha outro.");
      }
      if (String(body.adminPassword).length < 8) {
        return sendError(res, 400, "A senha deve ter pelo menos 8 caracteres.");
      }

      const tenant = db.createTenant({
        name: body.barbershopName,
        slug,
        notifyEmail: body.adminEmail,
      });

      const passwordHash = await auth.hashPassword(body.adminPassword);
      db.createUser(tenant.id, {
        name: body.adminName,
        email: body.adminEmail,
        passwordHash,
        role: "admin",
        commissionRate: 0,
      });

      return sendJson(res, 201, {
        ok: true,
        slug: tenant.slug,
        message: "Barbearia criada com sucesso. Acesse pelo seu endereco para fazer login.",
      });
    }

    if (req.method === "GET" && pathname === "/api/signup/check-slug") {
      const slug = String(url.searchParams.get("slug") || "").toLowerCase();
      if (!isValidSlug(slug)) return sendJson(res, 200, { available: false, reason: "formato_invalido" });
      return sendJson(res, 200, { available: !db.slugExists(slug) });
    }

    // ---- Daqui em diante, toda rota pertence a um tenant especifico -------

    const tenant = requireTenant(req, res, url);
    if (!tenant) return;

    // ---- Rotas públicas do tenant (sem autenticação) -----------------------

    if (req.method === "GET" && pathname === "/api/public") {
      const services = db.listServices(tenant.id);
      const barbers = db.listUsers(tenant.id).filter((u) => u.role === "barbeiro").map(auth.sanitizeUser);
      return sendJson(res, 200, {
        company: {
          name: tenant.name,
          slogan: tenant.slogan,
          phone: tenant.phone,
          address: tenant.address,
          openingHours: tenant.opening_hours,
        },
        services,
        barbers,
      });
    }

    if (req.method === "GET" && pathname === "/api/appointments/availability") {
      const date = url.searchParams.get("date");
      const barberId = url.searchParams.get("barberId");
      if (!date || !barberId) return sendError(res, 400, "Informe data e barbeiro.");

      const settings = db.getSettings(tenant.id);
      const busy = new Set(db.listAppointmentsByDateBarber(tenant.id, date, barberId).map((a) => a.time));
      const slots = buildSlots(settings.agenda.startTime, settings.agenda.endTime, Number(settings.agenda.slotMinutes || 30))
        .map((time) => ({ time, available: !busy.has(time) }));

      return sendJson(res, 200, { date, barberId, slots });
    }

    if (req.method === "POST" && pathname === "/api/public/appointments") {
      const body = await readBody(req);
      const required = ["clientName", "clientPhone", "serviceId", "barberId", "date", "time"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length) return sendError(res, 400, "Preencha todos os campos do agendamento.");

      const appointment = db.createAppointment(tenant.id, {
        clientName: body.clientName,
        clientPhone: body.clientPhone,
        clientEmail: body.clientEmail || "",
        serviceId: body.serviceId,
        barberId: body.barberId,
        date: body.date,
        time: body.time,
        status: "solicitado",
        publicRequest: true,
      });

      notifications.queueAppointmentConfirmation(tenant.id, appointment);
      return sendJson(res, 201, appointment);
    }

    // ---- Autenticação --------------------------------------------------------

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readBody(req);
      if (!body.email || !body.password) {
        return sendError(res, 400, "Informe e-mail e senha.");
      }

      const result = await auth.attemptLogin({
        tenantId: tenant.id,
        email: body.email,
        password: body.password,
        ip: clientIp(req),
      });

      if (!result.ok) return sendError(res, result.status, result.message);

      return sendJson(
        res, 200, { user: result.user },
        { "Set-Cookie": `sessionId=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${auth.SESSION_TTL_MS / 1000}` }
      );
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const token = parseCookies(req).sessionId;
      if (token) db.deleteSession(token);
      return sendJson(
        res, 200, { ok: true },
        { "Set-Cookie": "sessionId=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" }
      );
    }

    // ---- Rotas autenticadas ---------------------------------------------------

    if (req.method === "GET" && pathname === "/api/me") {
      const user = requireAuth(req, res, tenant);
      if (!user) return;
      return sendJson(res, 200, { user: auth.sanitizeUser(user) });
    }

    if (req.method === "GET" && pathname === "/api/dashboard") {
      if (!requireAuth(req, res, tenant)) return;
      return sendJson(res, 200, formatDashboard(tenant.id));
    }

    if (req.method === "GET" && pathname === "/api/data") {
      const user = requireAuth(req, res, tenant);
      if (!user) return;

      const data = {
        company: { name: tenant.name, slogan: tenant.slogan, phone: tenant.phone, address: tenant.address, openingHours: tenant.opening_hours },
        currentUser: auth.sanitizeUser(user),
        services: db.listServices(tenant.id),
        users: db.listUsers(tenant.id).map(auth.sanitizeUser),
        appointments: db.listAppointments(tenant.id),
        sales: db.listSales(tenant.id).map((s) => enrichSale(tenant.id, s)),
        settings: db.getSettings(tenant.id),
      };

      if (auth.canAccess(user, "caixa") || auth.canAccess(user, "estoque")) data.stock = db.listStock(tenant.id);
      if (auth.canAccess(user, "financeiro")) data.payables = db.listPayables(tenant.id);
      if (auth.canAccess(user, "comissoes")) data.payroll = db.listPayroll(tenant.id);

      return sendJson(res, 200, data);
    }

    // ---- Agenda ----------------------------------------------------------------

    if (req.method === "POST" && pathname === "/api/appointments") {
      const user = requirePermission(req, res, tenant, "agenda");
      if (!user) return;

      const body = await readBody(req);
      const appointment = db.createAppointment(tenant.id, {
        clientName: body.clientName,
        clientPhone: body.clientPhone,
        clientEmail: body.clientEmail || "",
        serviceId: body.serviceId,
        barberId: body.barberId,
        date: body.date,
        time: body.time,
        status: body.status || "agendado",
        publicRequest: false,
      });

      notifications.queueAppointmentConfirmation(tenant.id, appointment);
      return sendJson(res, 201, appointment);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/appointments/")) {
      const user = requirePermission(req, res, tenant, "agenda");
      if (!user) return;

      const id = pathname.split("/").pop();
      const body = await readBody(req);
      const previous = db.getAppointmentById(tenant.id, id);
      if (!previous) return sendError(res, 404, "Agendamento nao encontrado.");

      const updated = db.updateAppointment(tenant.id, id, body);

      if (body.status === "cancelado" && previous.status !== "cancelado") {
        notifications.queueAppointmentCancellation(tenant.id, updated);
      }

      return sendJson(res, 200, updated);
    }

    // ---- Caixa (vendas) ----------------------------------------------------------

    if (req.method === "POST" && pathname === "/api/sales") {
      const user = requirePermission(req, res, tenant, "caixa");
      if (!user) return;

      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendError(res, 400, "Informe pelo menos um item para vender.");

      const saleItems = items.map((item) => {
        const qty = Number(item.quantity || 1);

        if (item.type === "service") {
          const service = db.getServiceById(tenant.id, item.refId);
          if (!service) throw new Error("Servico invalido.");
          return { type: "service", refId: service.id, name: service.name, quantity: qty, unitPrice: Number(service.price) };
        }

        const product = db.getProductById(tenant.id, item.refId);
        if (!product) throw new Error("Produto invalido.");
        if (Number(product.quantity) < qty) throw new Error(`Estoque insuficiente para ${product.name}.`);
        return { type: "product", refId: product.id, name: product.name, quantity: qty, unitPrice: Number(product.salePrice) };
      });

      const sale = db.createSale(tenant.id, {
        date: body.date || todayIso(),
        clientName: body.clientName || "Cliente Balcao",
        barberId: body.barberId || user.id,
        paymentMethod: body.paymentMethod || "dinheiro",
        items: saleItems,
      });

      return sendJson(res, 201, enrichSale(tenant.id, sale));
    }

    // ---- Estoque ----------------------------------------------------------------

    if (req.method === "GET" && pathname.startsWith("/api/stock/barcode/")) {
      if (!requirePermission(req, res, tenant, "caixa")) return;
      const barcode = pathname.split("/").pop();
      const product = db.getProductByBarcode(tenant.id, barcode);
      if (!product) return sendError(res, 404, "Produto nao encontrado para este codigo de barras.");
      return sendJson(res, 200, product);
    }

    if (req.method === "POST" && pathname === "/api/stock") {
      if (!requirePermission(req, res, tenant, "estoque")) return;
      const body = await readBody(req);
      const product = db.createProduct(tenant.id, {
        name: body.name,
        barcode: body.barcode || "",
        quantity: Number(body.quantity || 0),
        minQuantity: Number(body.minQuantity || 0),
        unitCost: Number(body.unitCost || 0),
        salePrice: Number(body.salePrice || 0),
      });
      return sendJson(res, 201, product);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/stock/")) {
      if (!requirePermission(req, res, tenant, "estoque")) return;
      const id = pathname.split("/").pop();
      const body = await readBody(req);
      const current = db.getProductById(tenant.id, id);
      if (!current) return sendError(res, 404, "Produto nao encontrado.");

      const updated = db.updateProduct(tenant.id, id, {
        ...body,
        quantity: body.quantity === undefined ? current.quantity : Number(body.quantity),
        minQuantity: body.minQuantity === undefined ? current.minQuantity : Number(body.minQuantity),
        unitCost: body.unitCost === undefined ? current.unitCost : Number(body.unitCost),
        salePrice: body.salePrice === undefined ? current.salePrice : Number(body.salePrice),
      });
      return sendJson(res, 200, updated);
    }

    // ---- Configurações ------------------------------------------------------------

    if (req.method === "PATCH" && pathname === "/api/settings") {
      if (!requirePermission(req, res, tenant, "financeiro")) return;
      const body = await readBody(req);
      const updated = db.updateSettings(tenant.id, body);
      return sendJson(res, 200, updated);
    }

    // ---- Financeiro — contas a pagar -----------------------------------------------

    if (req.method === "POST" && pathname === "/api/payables") {
      if (!requirePermission(req, res, tenant, "financeiro")) return;
      const body = await readBody(req);
      const payable = db.createPayable(tenant.id, {
        description: body.description,
        dueDate: body.dueDate,
        amount: Number(body.amount || 0),
        status: body.status || "pendente",
      });
      return sendJson(res, 201, payable);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/payables/")) {
      if (!requirePermission(req, res, tenant, "financeiro")) return;
      const id = pathname.split("/").pop();
      const body = await readBody(req);
      const updated = db.updatePayable(tenant.id, id, {
        ...body,
        amount: body.amount === undefined ? undefined : Number(body.amount),
      });
      if (!updated) return sendError(res, 404, "Conta nao encontrada.");
      return sendJson(res, 200, updated);
    }

    // ---- Folha de pagamento / comissões ---------------------------------------------

    if (req.method === "POST" && pathname === "/api/payroll/recalculate") {
      if (!requirePermission(req, res, tenant, "comissoes")) return;
      const body = await readBody(req);
      const period = body.period || new Date().toISOString().slice(0, 7);

      const employees = db.listUsers(tenant.id).filter((u) => u.role !== "admin");
      for (const employee of employees) {
        const commission = Number(calculateCommissionTotal(tenant.id, employee.id, period).toFixed(2));
        db.upsertPayrollCommission(tenant.id, employee.id, period, commission);
      }

      return sendJson(res, 200, db.listPayroll(tenant.id));
    }

    // ---- Usuários -----------------------------------------------------------------

    if (req.method === "POST" && pathname === "/api/users") {
      if (!requirePermission(req, res, tenant, "usuarios")) return;
      const body = await readBody(req);

      if (db.getUserByEmail(tenant.id, body.email || "")) {
        return sendError(res, 409, "Ja existe usuario com este e-mail.");
      }
      if (String(body.password || "").length < 8) {
        return sendError(res, 400, "A senha deve ter pelo menos 8 caracteres.");
      }

      const passwordHash = await auth.hashPassword(body.password);
      const newUser = db.createUser(tenant.id, {
        name: body.name,
        email: body.email,
        passwordHash,
        role: body.role || "barbeiro",
        commissionRate: Number(body.commissionRate || 0),
      });

      return sendJson(res, 201, auth.sanitizeUser(newUser));
    }

    sendError(res, 404, "Rota nao encontrada.");
  } catch (err) {
    console.error("[API ERROR]", err);
    sendError(res, 400, err.message || "Erro ao processar requisicao.");
  }
}

// ---------------------------------------------------------------------------
// Servidor de arquivos estáticos
// ---------------------------------------------------------------------------

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, "Acesso negado.");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

db.applySchema();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname, url);
  } else {
    serveStatic(req, res, pathname);
  }
});

// Processa a fila de notificações periodicamente
setInterval(() => {
  notifications.processQueue().catch((err) => console.error("[FILA NOTIFICACOES]", err));
}, NOTIFICATION_POLL_MS);

// Limpa sessões expiradas a cada hora
setInterval(() => db.purgeExpiredSessions(), 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Sistema multi-tenant rodando em http://localhost:${PORT}`);
  console.log(`Dica de desenvolvimento: use ?tenant=SLUG ou o header X-Tenant-Slug para identificar a barbearia.`);
});
