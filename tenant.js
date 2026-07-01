"use strict";

/**
 * tenant.js — resolve qual barbearia (tenant) está fazendo a requisição.
 *
 * Em produção: lê o subdomínio do header Host.
 *   barbearia-modelo.seusite.com  →  slug = "barbearia-modelo"
 *
 * Em desenvolvimento local, subdomínios não resolvem facilmente em
 * `localhost`, então aceitamos dois fallbacks (nesta ordem de prioridade):
 *   1. Header  X-Tenant-Slug: barbearia-modelo
 *   2. Query string  ?tenant=barbearia-modelo
 *
 * O domínio raiz (sem subdomínio, ex: "seusite.com" ou "localhost") é
 * tratado como a área de marketing/cadastro — não pertence a nenhum tenant.
 */

// Domínios raiz que nunca têm subdomínio de tenant
const ROOT_HOSTS = new Set(["localhost", "127.0.0.1"]);

// Domínios de plataforma onde o "subdomínio" é o nome da app, não o tenant.
// Nesses casos ignoramos o host e usamos os fallbacks (header ou query string).
const PLATFORM_DOMAINS = new Set(["fly.dev", "fly.io", "vercel.app", "netlify.app", "railway.app", "render.com"]);

function extractSlugFromHost(hostHeader) {
  if (!hostHeader) return null;

  const hostname = hostHeader.split(":")[0].toLowerCase();

  if (ROOT_HOSTS.has(hostname)) return null;

  const parts = hostname.split(".");

  // Verifica se o domínio base é uma plataforma de hospedagem.
  // ex: barbear.fly.dev → base = "fly.dev" → ignora, usa fallback
  // ex: barbearia-modelo.seusite.com → base = "seusite.com" → usa "barbearia-modelo"
  if (parts.length >= 2) {
    const baseDomain = parts.slice(-2).join(".");
    if (PLATFORM_DOMAINS.has(baseDomain)) return null;
  }

  // Domínio próprio com subdomínio real
  // ex: barbearia-modelo.seusite.com → ["barbearia-modelo", "seusite", "com"]
  if (parts.length >= 3) {
    const candidate = parts[0];
    if (candidate && candidate !== "www") return candidate;
  }

  return null;
}

/**
 * Resolve o slug do tenant a partir da requisição, usando subdomínio
 * como fonte principal e os fallbacks de desenvolvimento quando aplicável.
 */
function resolveTenantSlug(req, url) {
  const fromHost = extractSlugFromHost(req.headers.host);
  if (fromHost) return fromHost;

  const fromHeader = req.headers["x-tenant-slug"];
  if (fromHeader) return String(fromHeader).toLowerCase();

  const fromQuery = url.searchParams.get("tenant");
  if (fromQuery) return fromQuery.toLowerCase();

  return null;
}

/**
 * Valida formato de slug: minúsculas, números e hífen, 3-40 caracteres.
 * Usado tanto na resolução quanto no cadastro de novo tenant.
 */
function isValidSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug);
}

module.exports = { resolveTenantSlug, isValidSlug };
