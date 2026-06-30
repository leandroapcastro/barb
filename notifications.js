"use strict";

/**
 * notifications.js — geração de conteúdo e processamento da fila de envio.
 *
 * O envio real (SMTP, SendGrid, etc.) fica isolado em `sendViaProvider`.
 * Por padrão usamos um provider "console" que apenas loga a mensagem —
 * isso deixa o sistema funcional e auditável sem prender você a um
 * provedor de e-mail específico. Troque `sendViaProvider` quando tiver
 * a conta de envio escolhida (Resend, SendGrid, SMTP próprio, etc.).
 */

const db = require("./db");

function formatDateBR(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function buildConfirmationMessage({ tenant, appointment, serviceName, barberName }) {
  const subject = `Agendamento confirmado — ${tenant.name}`;
  const body = [
    `Ola, ${appointment.clientName}!`,
    ``,
    `Seu horario foi confirmado:`,
    `Servico: ${serviceName}`,
    `Profissional: ${barberName}`,
    `Data: ${formatDateBR(appointment.date)} as ${appointment.time}`,
    ``,
    `Endereco: ${tenant.address || "a confirmar"}`,
    `Duvidas: ${tenant.phone || ""}`,
    ``,
    `${tenant.name}`,
  ].join("\n");
  return { subject, body };
}

function buildReminderMessage({ tenant, appointment, serviceName, barberName }) {
  const subject = `Lembrete: seu horario e amanha — ${tenant.name}`;
  const body = [
    `Ola, ${appointment.clientName}!`,
    ``,
    `Lembrete do seu agendamento:`,
    `Servico: ${serviceName}`,
    `Profissional: ${barberName}`,
    `Data: ${formatDateBR(appointment.date)} as ${appointment.time}`,
    ``,
    `Ate breve!`,
    `${tenant.name}`,
  ].join("\n");
  return { subject, body };
}

function buildCancellationMessage({ tenant, appointment }) {
  const subject = `Agendamento cancelado — ${tenant.name}`;
  const body = [
    `Ola, ${appointment.clientName}.`,
    ``,
    `Seu horario do dia ${formatDateBR(appointment.date)} as ${appointment.time} foi cancelado.`,
    `Entre em contato para reagendar: ${tenant.phone || ""}`,
    ``,
    `${tenant.name}`,
  ].join("\n");
  return { subject, body };
}

/**
 * Enfileira a notificação de confirmação para um agendamento recém-criado.
 * Não lança erro se o cliente não informou e-mail — apenas não enfileira.
 */
function queueAppointmentConfirmation(tenantId, appointment) {
  if (!appointment.clientEmail) return;

  const tenant = db.getTenantById(tenantId);
  const service = db.getServiceById(tenantId, appointment.serviceId);
  const barber = db.getUserById(tenantId, appointment.barberId);

  const { subject, body } = buildConfirmationMessage({
    tenant,
    appointment,
    serviceName: service ? service.name : "Servico",
    barberName: barber ? barber.name : "Profissional",
  });

  db.enqueueNotification(tenantId, {
    appointmentId: appointment.id,
    recipient: appointment.clientEmail,
    kind: "confirmacao",
    subject,
    body,
    channel: "email",
  });
}

function queueAppointmentCancellation(tenantId, appointment) {
  if (!appointment.clientEmail) return;
  const tenant = db.getTenantById(tenantId);
  const { subject, body } = buildCancellationMessage({ tenant, appointment });

  db.enqueueNotification(tenantId, {
    appointmentId: appointment.id,
    recipient: appointment.clientEmail,
    kind: "cancelamento",
    subject,
    body,
    channel: "email",
  });
}

/**
 * Provider "console": loga a mensagem como se tivesse enviado.
 * Troque esta função por uma chamada real (SMTP/API) quando for para produção.
 */
async function sendViaProvider({ recipient, subject, body }) {
  console.log("─────────────────────────────────────────");
  console.log(`[NOTIFICACAO] Para: ${recipient}`);
  console.log(`Assunto: ${subject}`);
  console.log(body);
  console.log("─────────────────────────────────────────");
  return true;
}

/**
 * Processa um lote da fila de notificações pendentes.
 * Chame periodicamente (setInterval) a partir do server.js.
 */
async function processQueue(limit = 20) {
  const pending = db.listPendingNotifications(limit);

  for (const notification of pending) {
    try {
      await sendViaProvider({
        recipient: notification.recipient,
        subject: notification.subject,
        body: notification.body,
      });
      db.markNotificationSent(notification.id);
    } catch (err) {
      console.error(`[NOTIFICACAO] Falha ao enviar ${notification.id}:`, err.message);
      db.markNotificationFailed(notification.id);
    }
  }

  return pending.length;
}

module.exports = {
  queueAppointmentConfirmation,
  queueAppointmentCancellation,
  buildReminderMessage,
  processQueue,
};
