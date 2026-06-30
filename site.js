const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function getPublicData() {
  const response = await apiFetch("/api/public");
  if (!response.ok) throw new Error("Nao foi possivel carregar os dados da barbearia.");
  return response.json();
}

function fillSelect(select, items, getLabel) {
  select.innerHTML = "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = getLabel(item);
    select.appendChild(option);
  });
}

function setMessage(element, text, kind) {
  element.textContent = text;
  element.classList.remove("is-error", "is-success");
  if (kind) element.classList.add(kind === "error" ? "is-error" : "is-success");
}

async function initSite() {
  let data;
  try {
    data = await getPublicData();
  } catch (error) {
    document.body.innerHTML = `
      <main class="section">
        <h1>Barbearia nao encontrada</h1>
        <p>Verifique o endereco utilizado para acessar esta pagina.</p>
      </main>
    `;
    return;
  }

  document.title = data.company.name;
  document.getElementById("brandName").textContent = data.company.name;
  document.getElementById("footerBrand").textContent = data.company.name;
  document.getElementById("companySlogan").textContent = data.company.slogan || "Atendimento com hora marcada.";
  document.getElementById("companyAddress").textContent = data.company.address || "—";
  document.getElementById("companyPhone").textContent = data.company.phone || "—";
  document.getElementById("companyHours").textContent = data.company.openingHours || "—";

  const serviceGrid = document.getElementById("serviceGrid");
  serviceGrid.innerHTML = data.services.length
    ? data.services
        .map(
          (service) => `
            <article class="service-card">
              <h3>${service.name}</h3>
              <strong>${money.format(service.price)}</strong>
              <span>${service.duration} minutos</span>
            </article>
          `
        )
        .join("")
    : "<p class='hint'>Nenhum servico cadastrado ainda.</p>";

  fillSelect(document.getElementById("publicServiceSelect"), data.services, (s) => `${s.name} — ${money.format(s.price)}`);
  fillSelect(document.getElementById("publicBarberSelect"), data.barbers, (b) => b.name);
}

document.getElementById("publicBookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("publicMessage");
  const payload = Object.fromEntries(new FormData(form));

  const response = await apiFetch("/api/public/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    setMessage(message, error.error || "Nao foi possivel enviar o agendamento.", "error");
    return;
  }

  form.reset();
  setMessage(message, "Solicitacao enviada! A equipe vera este horario na agenda interna.", "success");
});

initSite();
