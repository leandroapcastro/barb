function setMessage(element, text, kind) {
  element.textContent = text;
  element.classList.remove("is-error", "is-success");
  if (kind) element.classList.add(kind === "error" ? "is-error" : "is-success");
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("loginMessage");
  const payload = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector("button[type=submit]");

  submitButton.disabled = true;
  setMessage(message, "Entrando...", null);

  try {
    const response = await apiFetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      setMessage(message, error.error || "Nao foi possivel entrar.", "error");
      submitButton.disabled = false;
      return;
    }

    window.location.href = tenantUrl("/app.html");
  } catch {
    setMessage(message, "Erro de conexao. Tente novamente.", "error");
    submitButton.disabled = false;
  }
});
