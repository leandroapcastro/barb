/**
 * tenant-client.js — helper compartilhado pelo frontend.
 *
 * Estratégia de identificação do tenant (em ordem de prioridade):
 * 1. Subdomínio real (barbearia-modelo.seusite.com) — lido pelo backend via Host header
 * 2. Query string ?tenant=slug — fallback para qualquer ambiente sem subdomínio próprio
 *    (inclui barbear.fly.dev, localhost, etc.)
 */

// Domínios de plataforma onde o "subdomínio" é o nome da app, não o tenant.
const PLATFORM_DOMAINS = new Set(["fly.dev", "fly.io", "vercel.app", "netlify.app", "railway.app", "render.com"]);

function getTenantSlug() {
  const hostname = window.location.hostname;
  const parts = hostname.split(".");

  // Subdomínio real só vale se NÃO for domínio de plataforma
  if (parts.length >= 3) {
    const baseDomain = parts.slice(-2).join(".");
    if (!PLATFORM_DOMAINS.has(baseDomain)) {
      const candidate = parts[0];
      if (candidate && candidate !== "www") return candidate;
    }
  }

  // Fallback: query string
  return new URLSearchParams(window.location.search).get("tenant") || "";
}

function needsTenantParam() {
  const hostname = window.location.hostname;
  const parts = hostname.split(".");

  // Tem subdomínio real (não de plataforma) → backend lê pelo Host, não precisa de param
  if (parts.length >= 3) {
    const baseDomain = parts.slice(-2).join(".");
    if (!PLATFORM_DOMAINS.has(baseDomain) && parts[0] !== "www") return false;
  }

  // Qualquer outro caso (localhost, fly.dev, etc.) → precisa de ?tenant= ou header
  return true;
}

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

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const slug = getTenantSlug();

  if (slug && needsTenantParam()) {
    headers["X-Tenant-Slug"] = slug;
  }

  return fetch(path, { ...options, headers });
}

function tenantUrl(path) {
  const slug = getTenantSlug();
  if (!slug || !needsTenantParam()) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("tenant", slug);
  return url.pathname + url.search;
}

document.addEventListener("DOMContentLoaded", propagateTenantInLinks);
