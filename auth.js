"use strict";

const bcrypt = require("bcryptjs");
const db = require("./db");

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
const LOGIN_WINDOW_MS = 15 * 60 * 1000;    // janela de 15 minutos
const MAX_FAILED_ATTEMPTS = 5;             // bloqueia após 5 falhas na janela

const ROLE_PERMISSIONS = {
  admin: ["agenda", "caixa", "estoque", "financeiro", "comissoes", "usuarios", "relatorios"],
  gerente: ["agenda", "caixa", "estoque", "financeiro", "comissoes", "relatorios"],
  barbeiro: ["agenda", "caixa"],
};

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash: _hash, ...safe } = user;
  return { ...safe, permissions: ROLE_PERMISSIONS[user.role] || [] };
}

function canAccess(user, permission) {
  return Boolean(user && (ROLE_PERMISSIONS[user.role] || []).includes(permission));
}

/**
 * Verifica se o par email+ip está temporariamente bloqueado por excesso
 * de tentativas falhas — proteção simples contra força bruta no login.
 */
function isRateLimited(email, ip) {
  const failures = db.recentFailedAttempts(email, ip, LOGIN_WINDOW_MS);
  return failures >= MAX_FAILED_ATTEMPTS;
}

/**
 * Executa o fluxo completo de login: valida senha, registra tentativa,
 * aplica rate limiting e cria sessão em caso de sucesso.
 * Retorna { ok: true, token, user } ou { ok: false, status, message }.
 */
async function attemptLogin({ tenantId, email, password, ip }) {
  if (isRateLimited(email, ip)) {
    return { ok: false, status: 429, message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const user = db.getUserByEmail(tenantId, email);
  const validPassword = user ? await verifyPassword(password, user.passwordHash) : false;

  db.recordLoginAttempt({ tenantId, email, ip, success: validPassword });

  if (!user || !validPassword) {
    return { ok: false, status: 401, message: "E-mail ou senha invalidos." };
  }

  const token = db.createSession(tenantId, user.id, SESSION_TTL_MS);
  return { ok: true, token, user: sanitizeUser(user) };
}

function getSessionUser(token) {
  if (!token) return null;
  const session = db.getSession(token);
  if (!session) return null;
  return { ...db.getUserById(session.tenantId, session.userId), tenantId: session.tenantId };
}

module.exports = {
  hashPassword,
  verifyPassword,
  sanitizeUser,
  canAccess,
  attemptLogin,
  getSessionUser,
  ROLE_PERMISSIONS,
  SESSION_TTL_MS,
};
