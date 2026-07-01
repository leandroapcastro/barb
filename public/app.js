const state = {
  user: null,
  data: null,
  dashboard: null,
  activeModule: "dashboard",
  cart: [],
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function can(permission) {
  return state.user && state.user.permissions.includes(permission);
}

function showToast(message, kind) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("is-error");
  if (kind === "error") toast.classList.add("is-error");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    redirectToLogin();
    return null;
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Erro na requisicao.");
  return payload;
}

function redirectToLogin() {
  window.location.href = tenantUrl("/login.html");
}

function getServiceName(id) {
  return state.data.services.find((service) => service.id === id)?.name || "Servico removido";
}

function getUserName(id) {
  return state.data.users.find((user) => user.id === id)?.name || "Usuario removido";
}

function getBarbers() {
  return state.data.users.filter((user) => user.role === "barbeiro");
}

function fillSelect(id, items, getLabel, includeEmpty = false) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = includeEmpty ? "<option value=''>Nenhum</option>" : "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = getLabel(item);
    select.appendChild(option);
  });
}

function renderNavigation() {
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.style.display = can(element.dataset.permission) ? "" : "none";
  });

  document.querySelectorAll("#moduleNav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.module === state.activeModule);
  });
}

function openModule(moduleName) {
  state.activeModule = moduleName;
  document.querySelectorAll(".module").forEach((module) => module.classList.remove("active"));
  document.getElementById(`module-${moduleName}`).classList.add("active");
  document.getElementById("pageTitle").textContent =
    document.querySelector(`[data-module="${moduleName}"]`)?.textContent || "Painel";
  renderNavigation();
}

function renderChart(id, rows, labelKey) {
  const element = document.getElementById(id);
  const max = Math.max(...rows.map((row) => Number(row.total || 0)), 1);
  element.innerHTML = rows.length
    ? rows
        .map((row) => {
          const width = Math.max((Number(row.total || 0) / max) * 100, 2);
          return `
            <div class="chart-row">
              <div class="chart-label"><span>${row[labelKey]}</span><strong>${money.format(row.total)}</strong></div>
              <div class="chart-track"><div class="chart-fill" style="width:${width}%"></div></div>
            </div>
          `;
        })
        .join("")
    : "<p class='hint'>Nao ha dados suficientes para o grafico.</p>";
}

function renderDashboard() {
  const dashboard = state.dashboard;
  document.getElementById("metricGrid").innerHTML = `
    <article class="metric-card"><span>Vendas totais</span><strong>${money.format(dashboard.salesTotal)}</strong></article>
    <article class="metric-card"><span>Contas abertas</span><strong>${money.format(dashboard.openPayables)}</strong></article>
    <article class="metric-card"><span>Itens em alerta</span><strong>${dashboard.lowStockCount}</strong></article>
    <article class="metric-card"><span>Agendamentos</span><strong>${dashboard.appointmentCount}</strong></article>
  `;

  const alerts = dashboard.upcomingPayables || [];
  document.getElementById("panelAlerts").innerHTML = alerts.length && (can("financeiro") || can("relatorios"))
    ? alerts
        .map((item) => `<div class="alert-card">Conta a vencer em ${item.dueDate}: ${item.description} (${money.format(item.amount)})</div>`)
        .join("")
    : "";

  renderChart("salesChart", dashboard.salesByDay || [], "date");
  renderChart("paymentChart", dashboard.paymentMethods || [], "method");

  document.getElementById("todayAppointments").innerHTML = dashboard.todayAppointments.length
    ? dashboard.todayAppointments.map((item) => `<p>${item.time} - ${item.clientName}</p>`).join("")
    : "<p class='hint'>Nenhum agendamento para hoje.</p>";

  document.getElementById("lowStock").innerHTML = dashboard.lowStock.length
    ? dashboard.lowStock.map((item) => `<p>${item.name}: ${item.quantity} unidades</p>`).join("")
    : "<p class='hint'>Sem alertas de estoque.</p>";
}

async function loadAvailability() {
  const form = document.getElementById("appointmentForm");
  const date = form.elements.date.value;
  const barberId = form.elements.barberId.value;
  const grid = document.getElementById("timeGrid");
  document.getElementById("appointmentTime").value = "";

  if (!date || !barberId) {
    grid.innerHTML = "<p class='hint'>Escolha data e profissional para ver horarios livres.</p>";
    return;
  }

  const data = await api(`/api/appointments/availability?date=${encodeURIComponent(date)}&barberId=${encodeURIComponent(barberId)}`);
  if (!data) return;
  grid.innerHTML = data.slots
    .map((slot) => {
      if (!slot.available) return `<button type="button" class="busy-slot" disabled>${slot.time}</button>`;
      return `<button type="button" data-time="${slot.time}">${slot.time}</button>`;
    })
    .join("");
}

const APPOINTMENT_STATUS_LABEL = {
  solicitado: "solicitado",
  agendado: "agendado",
  confirmado: "confirmado",
  concluido: "concluido",
  cancelado: "cancelado",
};

function appointmentStatusClass(status) {
  if (status === "cancelado") return "status-danger";
  if (status === "confirmado" || status === "concluido") return "status-ok";
  return "status-warn";
}

function renderAgenda() {
  const rows = state.data.appointments
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((appointment) => {
      const isCancelled = appointment.status === "cancelado";
      const actions = isCancelled
        ? "<span class='hint'>—</span>"
        : `
          <button class="button button-sm" data-confirm-appointment="${appointment.id}">Confirmar</button>
          <button class="button button-sm button-ghost" data-cancel-appointment="${appointment.id}">Cancelar</button>
        `;
      return `
        <tr>
          <td>${appointment.date}</td>
          <td>${appointment.time}</td>
          <td>${appointment.clientName}<br><small>${getServiceName(appointment.serviceId)} com ${getUserName(appointment.barberId)}</small></td>
          <td><span class="status ${appointmentStatusClass(appointment.status)}">${APPOINTMENT_STATUS_LABEL[appointment.status] || appointment.status}</span></td>
          <td style="display:flex; gap:6px; flex-wrap:wrap;">${actions}</td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("appointmentRows").innerHTML = rows || "<tr><td colspan='5'>Nenhum horario cadastrado.</td></tr>";
}

function addToCart(item) {
  const existing = state.cart.find((cartItem) => cartItem.type === item.type && cartItem.refId === item.refId);
  if (existing) existing.quantity += 1;
  else state.cart.push({ ...item, quantity: 1 });
  renderCart();
}

function removeFromCart(index) {
  state.cart.splice(index, 1);
  renderCart();
}

function renderCashierCards() {
  document.getElementById("serviceCards").innerHTML = state.data.services
    .map(
      (service) => `
        <button class="sale-card" type="button" data-cart-type="service" data-cart-id="${service.id}">
          <strong>${service.name}</strong>
          <span>${service.duration} min</span>
          <b>${money.format(service.price)}</b>
        </button>
      `
    )
    .join("");

  document.getElementById("productCards").innerHTML = (state.data.stock || [])
    .filter((product) => Number(product.salePrice) > 0)
    .map(
      (product) => `
        <button class="sale-card" type="button" data-cart-type="product" data-cart-id="${product.id}">
          <strong>${product.name}</strong>
          <span>${product.barcode || "Sem codigo"} | ${product.quantity} un.</span>
          <b>${money.format(product.salePrice)}</b>
        </button>
      `
    )
    .join("");
}

function renderCart() {
  const total = state.cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  document.getElementById("cartTotal").textContent = money.format(total);
  document.getElementById("cartList").innerHTML = state.cart.length
    ? state.cart
        .map(
          (item, index) => `
            <div class="cart-item">
              <span>${item.quantity}x ${item.name}<br><small>${money.format(item.unitPrice)} cada</small></span>
              <button type="button" data-remove-cart="${index}">Remover</button>
            </div>
          `
        )
        .join("")
    : "<p class='hint'>Nenhum item no carrinho.</p>";
}

function printReceipt(sale) {
  const settings = state.data.settings?.printer || {};
  const width = settings.paperWidth || "80mm";
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Cupom nao fiscal</title>
        <style>
          body { font-family: monospace; margin: 0; padding: 10px; width: ${width}; }
          h1 { font-size: 16px; margin: 0 0 8px; text-align: center; }
          .line { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; }
          .total { font-size: 15px; font-weight: bold; }
          small { display: block; text-align: center; }
        </style>
      </head>
      <body>
        <h1>${state.data.company.name}</h1>
        <small>CUPOM NAO FISCAL</small>
        <div class="line"></div>
        <div>Venda: ${sale.id}</div>
        <div>Data: ${sale.date}</div>
        <div>Cliente: ${sale.clientName}</div>
        <div>Profissional: ${sale.barberName}</div>
        <div class="line"></div>
        ${sale.items.map((item) => `<div class="row"><span>${item.quantity}x ${item.name}</span><span>${money.format(item.quantity * item.unitPrice)}</span></div>`).join("")}
        <div class="line"></div>
        <div class="row total"><span>Total</span><span>${money.format(sale.total)}</span></div>
        <div>Pagamento: ${sale.paymentMethod}</div>
        <div class="line"></div>
        <small>${settings.receiptFooter || "Obrigado pela preferencia!"}</small>
        <script>window.print();<\/script>
      </body>
    </html>
  `;
  const popup = window.open("", "cupom", "width=420,height=640");
  popup.document.write(html);
  popup.document.close();
}

async function finishSale() {
  if (!state.cart.length) {
    showToast("Adicione itens ao carrinho antes de finalizar.", "error");
    return;
  }

  try {
    const sale = await api("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        clientName: document.getElementById("saleClientName").value,
        barberId: document.getElementById("saleBarber").value,
        paymentMethod: document.getElementById("salePaymentMethod").value,
        items: state.cart.map((item) => ({ type: item.type, refId: item.refId, quantity: item.quantity })),
      }),
    });

    if (document.getElementById("printReceipt").checked) printReceipt(sale);
    state.cart = [];
    document.getElementById("saleClientName").value = "";
    await refresh();
    showToast("Venda finalizada.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderSales() {
  const rows = state.data.sales
    .slice()
    .reverse()
    .map(
      (sale) => `
        <tr>
          <td>${sale.date}</td>
          <td>${sale.clientName}</td>
          <td>${sale.barberName}</td>
          <td>${money.format(sale.total)}</td>
        </tr>
      `
    )
    .join("");
  document.getElementById("saleRows").innerHTML = rows || "<tr><td colspan='4'>Nenhuma venda cadastrada.</td></tr>";
}

function renderStock() {
  if (!state.data.stock) return;
  const rows = state.data.stock
    .map((item) => {
      const statusClass = Number(item.quantity) <= Number(item.minQuantity) ? "status-danger" : "status-ok";
      return `
        <tr>
          <td>${item.name}</td>
          <td>${item.barcode || "-"}</td>
          <td><span class="status ${statusClass}">${item.quantity}</span></td>
          <td>${item.minQuantity}</td>
          <td>${money.format(item.salePrice)}</td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("stockRows").innerHTML = rows || "<tr><td colspan='5'>Nenhum produto cadastrado.</td></tr>";
}

function renderPayables() {
  if (!can("financeiro")) return;
  const rows = (state.data.payables || [])
    .map((item) => {
      const isPaid = item.status === "pago";
      return `
        <tr>
          <td>${item.dueDate}</td>
          <td>${item.description}</td>
          <td>${money.format(item.amount)}</td>
          <td><span class="status ${isPaid ? "status-ok" : "status-warn"}">${item.status}</span></td>
          <td>${isPaid ? "<span class='hint'>—</span>" : `<button class="button button-sm" data-pay-payable="${item.id}">Marcar como pago</button>`}</td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("payableRows").innerHTML = rows || "<tr><td colspan='5'>Nenhuma conta cadastrada.</td></tr>";
}

function renderPayroll() {
  if (!can("comissoes")) return;
  const rows = (state.data.payroll || [])
    .map(
      (item) => `
        <tr>
          <td>${getUserName(item.userId)}</td>
          <td>${item.period}</td>
          <td>${money.format(item.baseSalary)}</td>
          <td>${money.format(item.commission)}</td>
          <td><span class="status status-warn">${item.status}</span></td>
        </tr>
      `
    )
    .join("");
  document.getElementById("payrollRows").innerHTML = rows || "<tr><td colspan='5'>Nenhum pagamento cadastrado.</td></tr>";
}

function renderUsers() {
  if (!can("usuarios")) return;
  document.getElementById("userRows").innerHTML = state.data.users
    .map(
      (user) => `
        <tr>
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td>${user.role}</td>
          <td>${Math.round(Number(user.commissionRate || 0) * 100)}%</td>
        </tr>
      `
    )
    .join("");
}

function renderForms() {
  const barbers = getBarbers();
  fillSelect("appointmentService", state.data.services, (service) => service.name);
  fillSelect("appointmentBarber", barbers, (barber) => barber.name);
  fillSelect("saleBarber", barbers, (barber) => barber.name);

  const settings = state.data.settings || {};
  document.getElementById("printerName").value = settings.printer?.name || "";
  document.getElementById("printerPaperWidth").value = settings.printer?.paperWidth || "80mm";
  document.getElementById("printerCopies").value = settings.printer?.copies || 1;
  document.getElementById("receiptFooter").value = settings.printer?.receiptFooter || "";
  document.getElementById("payableAlertDays").value = settings.dashboard?.payableAlertDays || 7;
  document.getElementById("agendaStartTime").value = settings.agenda?.startTime || "09:00";
  document.getElementById("agendaEndTime").value = settings.agenda?.endTime || "20:00";
  document.getElementById("agendaSlotMinutes").value = settings.agenda?.slotMinutes || 30;
  document.getElementById("payrollPeriod").value = new Date().toISOString().slice(0, 7);
  renderCashierCards();
  renderCart();
}

async function loadAll() {
  const [me, data, dashboard] = await Promise.all([api("/api/me"), api("/api/data"), api("/api/dashboard")]);
  if (!me || !data || !dashboard) return;
  state.user = me.user;
  state.data = data;
  state.dashboard = dashboard;
  document.getElementById("userPill").innerHTML = `<strong>${state.user.name}</strong> · ${state.user.role}`;
  renderNavigation();
  renderForms();
  renderDashboard();
  renderAgenda();
  renderSales();
  renderStock();
  renderPayables();
  renderPayroll();
  renderUsers();
  loadAvailability();

  if ((dashboard.upcomingPayables || []).length && can("financeiro")) {
    showToast(`Voce tem ${dashboard.upcomingPayables.length} conta(s) a vencer.`);
  }
}

async function refresh() {
  state.data = await api("/api/data");
  state.dashboard = await api("/api/dashboard");
  if (!state.data || !state.dashboard) return;
  renderForms();
  renderDashboard();
  renderAgenda();
  renderSales();
  renderStock();
  renderPayables();
  renderPayroll();
  renderUsers();
  loadAvailability();
}

function bindForm(id, path, afterMessage, mapPayload) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = mapPayload ? mapPayload(form) : Object.fromEntries(new FormData(form));
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await refresh();
      showToast(afterMessage);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

document.getElementById("moduleNav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-module]");
  if (!button) return;
  const permission = button.dataset.permission;
  if (permission && !can(permission)) return;
  openModule(button.dataset.module);
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  redirectToLogin();
});

document.getElementById("appointmentForm").addEventListener("change", (event) => {
  if (["date", "barberId"].includes(event.target.name)) loadAvailability();
});

document.getElementById("timeGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-time]");
  if (!button) return;
  document.querySelectorAll("#timeGrid button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  document.getElementById("appointmentTime").value = button.dataset.time;
});

document.getElementById("appointmentRows").addEventListener("click", async (event) => {
  const confirmButton = event.target.closest("[data-confirm-appointment]");
  const cancelButton = event.target.closest("[data-cancel-appointment]");

  if (confirmButton) {
    try {
      await api(`/api/appointments/${confirmButton.dataset.confirmAppointment}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmado" }),
      });
      await refresh();
      showToast("Agendamento confirmado.");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (cancelButton) {
    if (!window.confirm("Cancelar este agendamento? O cliente sera notificado, se tiver informado e-mail.")) return;
    try {
      await api(`/api/appointments/${cancelButton.dataset.cancelAppointment}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelado" }),
      });
      await refresh();
      showToast("Agendamento cancelado.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});

document.getElementById("payableRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-pay-payable]");
  if (!button) return;
  try {
    await api(`/api/payables/${button.dataset.payPayable}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pago" }),
    });
    await refresh();
    showToast("Conta marcada como paga.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.getElementById("serviceCards").addEventListener("click", (event) => {
  const card = event.target.closest("[data-cart-id]");
  if (!card) return;
  const service = state.data.services.find((item) => item.id === card.dataset.cartId);
  addToCart({ type: "service", refId: service.id, name: service.name, unitPrice: Number(service.price) });
});

document.getElementById("productCards").addEventListener("click", (event) => {
  const card = event.target.closest("[data-cart-id]");
  if (!card) return;
  const product = state.data.stock.find((item) => item.id === card.dataset.cartId);
  addToCart({ type: "product", refId: product.id, name: product.name, unitPrice: Number(product.salePrice) });
});

document.getElementById("cartList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-cart]");
  if (!button) return;
  removeFromCart(Number(button.dataset.removeCart));
});

document.getElementById("addBarcodeProduct").addEventListener("click", async () => {
  const input = document.getElementById("barcodeInput");
  const barcode = input.value.trim();
  if (!barcode) return;
  try {
    const product = await api(`/api/stock/barcode/${encodeURIComponent(barcode)}`);
    addToCart({ type: "product", refId: product.id, name: product.name, unitPrice: Number(product.salePrice) });
    input.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.getElementById("barcodeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("addBarcodeProduct").click();
  }
});

document.getElementById("finishSale").addEventListener("click", finishSale);

document.getElementById("recalculatePayroll").addEventListener("click", async () => {
  try {
    await api("/api/payroll/recalculate", {
      method: "POST",
      body: JSON.stringify({ period: document.getElementById("payrollPeriod").value }),
    });
    await refresh();
    showToast("Comissoes recalculadas.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        printer: {
          name: document.getElementById("printerName").value,
          paperWidth: document.getElementById("printerPaperWidth").value,
          copies: Number(document.getElementById("printerCopies").value || 1),
          receiptFooter: document.getElementById("receiptFooter").value,
        },
        dashboard: {
          payableAlertDays: Number(document.getElementById("payableAlertDays").value || 7),
        },
        agenda: {
          startTime: document.getElementById("agendaStartTime").value,
          endTime: document.getElementById("agendaEndTime").value,
          slotMinutes: Number(document.getElementById("agendaSlotMinutes").value || 30),
        },
      }),
    });
    await refresh();
    showToast("Configuracoes salvas.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

bindForm("appointmentForm", "/api/appointments", "Agendamento salvo.", (form) => {
  const payload = Object.fromEntries(new FormData(form));
  if (!payload.time) {
    throw new Error("Escolha um horario livre antes de salvar.");
  }
  return payload;
});
bindForm("stockForm", "/api/stock", "Produto adicionado.");
bindForm("payableForm", "/api/payables", "Conta adicionada.");
bindForm("userForm", "/api/users", "Usuario criado.");

loadAll().catch(() => {
  redirectToLogin();
});
