/**
 * tenant-client.js — helper compartilhado pelo frontend.
 *
 * Em produção, o subdomínio (ex: barbearia-modelo.seusite.com) já identifica
 * o tenant sozinho — o backend lê isso do header Host, então o frontend não
 * precisa fazer nada além de chamar fetch() normalmente.
 *
 * Em desenvolvimento local (localhost), propagamos o parâmetro ?tenant=slug
 * por toda navegação e o repassamos como header X-Tenant-Slug em cada
 * chamada de API, para simular o comportamento de subdomínio sem precisar
 * configurar DNS local.
 */

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isDevHost() {
  return DEV_HOSTS.has(window.location.hostname);
}

function getDevTenantSlug() {
  return new URLSearchParams(window.location.search).get("tenant") || "";
}

/**
 * Garante que links internos da página carreguem o ?tenant=slug em dev,
 * para a navegação entre index/login/app preservar o contexto.
 */
function propagateTenantInLinks() {
  if (!isDevHost()) return;
  const slug = getDevTenantSlug();
  if (!slug) return;

  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) return;
    const url = new URL(href, window.location.origin);
    if (!url.searchParams.has("tenant")) {
      url.searchParams.set("tenant", slug);
      link.setAttribute("href", url.pathname + url.search);
    }
  });
}

/**
 * Wrapper de fetch que injeta o header de tenant em desenvolvimento local.
 * Use no lugar de fetch() direto em todo o frontend.
 */
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (isDevHost()) {
    const slug = getDevTenantSlug();
    if (slug) headers["X-Tenant-Slug"] = slug;
  }

  return fetch(path, { ...options, headers });
}

document.addEventListener("DOMContentLoaded", propagateTenantInLinks);
