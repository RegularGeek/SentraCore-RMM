// Sends alert notifications. Webhook always works (plain HTTP POST).
// Email only activates if SMTP_HOST etc. are set - it's fully optional.

let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

let mailer = null;
if (nodemailer && process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[notify] webhook failed:", err.message);
  }
}

async function sendEmail(subject, text) {
  if (!mailer || !process.env.ALERT_EMAIL_TO) return;
  try {
    await mailer.sendMail({
      from: process.env.ALERT_EMAIL_FROM || "rmm@localhost",
      to: process.env.ALERT_EMAIL_TO,
      subject,
      text,
    });
  } catch (err) {
    console.error("[notify] email failed:", err.message);
  }
}

async function notifyAlert({ hostname, metric, value, threshold, comparator, webhookUrl }) {
  const message = `[RMM ALERT] ${hostname}: ${metric} ${comparator} ${threshold} (currently ${value})`;
  console.log(message);
  await Promise.all([
    sendWebhook(webhookUrl, { type: "alert", hostname, metric, value, threshold, comparator, message }),
    sendEmail(`RMM alert: ${hostname} — ${metric}`, message),
  ]);
}

module.exports = { notifyAlert };
