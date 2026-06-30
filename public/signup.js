function setMessage(element, text, kind) {
  element.textContent = text;
  element.classList.remove("is-error", "is-success");
  if (kind) element.classList.add(kind === "error" ? "is-error" : "is-success");
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

const nameInput = document.getElementById("barbershopName");
const slugInput = document.getElementById("slugInput");
const slugPreview = document.getElementById("slugPreview");

let slugManuallyEdited = false;
let slugCheckTimer = null;

function renderSlugPreview(slug, status) {
  const statusHtml = status === "checking"
    ? `<span class="slug-status">verificando...</span>`
    : status === "ok"
      ? `<span class="slug-status ok">disponível</span>`
      : status === "taken"
        ? `<span class="slug-status taken">indisponível</span>`
        : "";

  slugPreview.innerHTML = `Seu endereço: <strong>${slug || "—"}.suabarbearia.app</strong> ${statusHtml}`;
}

async function checkSlugAvailability(slug) {
  if (!slug) {
    renderSlugPreview(slug, null);
    return;
  }
  renderSlugPreview(slug, "checking");

  try {
    const response = await apiFetch(`/api/signup/check-slug?slug=${encodeURIComponent(slug)}`);
    const data = await response.json();
    renderSlugPreview(slug, data.available ? "ok" : "taken");
  } catch {
    renderSlugPreview(slug, null);
  }
}

function scheduleSlugCheck(slug) {
  clearTimeout(slugCheckTimer);
  slugCheckTimer = setTimeout(() => checkSlugAvailability(slug), 400);
}

nameInput.addEventListener("input", () => {
  if (slugManuallyEdited) return;
  const slug = slugify(nameInput.value);
  slugInput.value = slug;
  scheduleSlugCheck(slug);
});

slugInput.addEventListener("input", () => {
  slugManuallyEdited = true;
  const cleaned = slugify(slugInput.value);
  if (cleaned !== slugInput.value) slugInput.value = cleaned;
  scheduleSlugCheck(cleaned);
});

document.getElementById("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("signupMessage");
  const payload = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector("button[type=submit]");

  submitButton.disabled = true;
  setMessage(message, "Criando sua conta...", null);

  try {
    const response = await apiFetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(message, data.error || "Nao foi possivel concluir o cadastro.", "error");
      submitButton.disabled = false;
      return;
    }

    setMessage(message, "Conta criada! Redirecionando para o login...", "success");
    setTimeout(() => {
      window.location.href = `/login.html?tenant=${encodeURIComponent(data.slug)}`;
    }, 1200);
  } catch {
    setMessage(message, "Erro de conexao. Tente novamente.", "error");
    submitButton.disabled = false;
  }
});
