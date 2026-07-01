/**
 * tenant-client.js — helper compartilhado pelo frontend.
 *
 * Estratégia de identificação do tenant (em ordem de prioridade):
 * 1. Subdomínio real (barbearia-modelo.seusite.com) — lido pelo backend via Host header
 * 2. Query string ?tenant=slug — fallback para qualquer ambiente sem subdomínio
 *    (inclui barbear.fly.dev, localhost, etc.)
 *
 * Este arquivo garante que o ?tenant= seja propagado automaticamente em toda
 * navegação interna e em todas as chamadas de API.
 */

function getTenantSlug() {
  // Tenta pegar do subdomínio primeiro
  const parts = window.location.hostname.split(".");
  if (parts.length >= 3) {
    const candidate = parts[0];
    if (candidate && candidate !== "www") return candidate;
  }
  // Fallback: query string
  return new URLSearchParams(window.location.search).get("tenant") || "";
}

function needsTenantParam() {
  // Só precisa propagar via query string se NÃO tiver subdomínio real
  const parts = window.location.hostname.split(".");
  return parts.length < 3 || parts[0] === "www";
}

/**
 * Propaga ?tenant= em todos os links internos da página.
 */
function propagateTenantInLinks() {
  const slug = getTenantSlug();
  if (!slug || !needsTenantParam()) return;

  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) return;
    try {
      const url = new URL(href, window.location.origin);
      if (!url.searchParams.has("tenant")) {
        url.searchParams.set("tenant", slug);
        link.setAttribute("href", url.pathname + url.search);
      }
    } catch {}
  });
}

/**
 * Wrapper de fetch que injeta o header X-Tenant-Slug quando não há subdomínio.
 */
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const slug = getTenantSlug();

  if (slug && needsTenantParam()) {
    headers["X-Tenant-Slug"] = slug;
  }

  return fetch(path, { ...options, headers });
}

/**
 * Retorna a URL de redirecionamento preservando o tenant.
 * Use no lugar de window.location.href = "/pagina.html"
 */
function tenantUrl(path) {
  const slug = getTenantSlug();
  if (!slug || !needsTenantParam()) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("tenant", slug);
  return url.pathname + url.search;
}

document.addEventListener("DOMContentLoaded", propagateTenantInLinks);
