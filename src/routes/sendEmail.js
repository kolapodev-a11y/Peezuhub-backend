const nodemailer = require('nodemailer');
const { APP_NAME, stripHtml } = require('./emailTemplates');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  return transporter;
}

function normalizeRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  }

  return [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))];
}

function getFromAddress() {
  if (process.env.SMTP_FROM?.trim()) return process.env.SMTP_FROM.trim();
  if (process.env.SMTP_USER?.trim()) return `${APP_NAME} <${process.env.SMTP_USER.trim()}>`;
  return undefined;
}

async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const client = getTransporter();
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!client || !toList.length) return false;

  await client.sendMail({
    from: getFromAddress(),
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    bcc: bccList.length ? bccList.join(', ') : undefined,
    replyTo: replyTo || undefined,
    subject,
    html,
    text: text || stripHtml(html || ''),
  });

  return true;
}

module.exports = { sendEmail, normalizeRecipients };
