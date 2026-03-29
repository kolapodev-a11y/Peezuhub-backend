'use strict';
/**
 * PeezuHub – sendEmail utility
 * ----------------------------
 * Wraps nodemailer and keeps outbound email from blocking core user flows.
 * Supports standard SMTP_* variables and optional SMTP_SERVICE (e.g. gmail).
 */

const nodemailer = require('nodemailer');

let transporter = null;

function normalizeRecipients(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  }

  return [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))];
}

function getFromAddress() {
  if (process.env.SMTP_FROM?.trim()) return process.env.SMTP_FROM.trim();
  if (process.env.SMTP_USER?.trim()) return `${process.env.APP_NAME || 'PeezuHub'} <${process.env.SMTP_USER.trim()}>`;
  return undefined;
}

function getTransporter() {
  if (transporter) return transporter;

  const {
    SMTP_SERVICE,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_USER || !SMTP_PASS || (!SMTP_SERVICE && !SMTP_HOST)) {
    console.warn('[PeezuHub] SMTP not fully configured - emails will be skipped.');
    return null;
  }

  const port = Number(SMTP_PORT || 587);
  const secure = port === 465;

  const transportConfig = {
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    secure,
    pool: true,
    maxConnections: 1,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    dnsTimeout: 10_000,
    tls: { rejectUnauthorized: false },
  };

  if (SMTP_SERVICE?.trim()) {
    transportConfig.service = SMTP_SERVICE.trim();
  } else {
    transportConfig.host = SMTP_HOST;
    transportConfig.port = port;
  }

  transporter = nodemailer.createTransport(transportConfig);
  return transporter;
}

async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const client = getTransporter();
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!subject || !html || !toList.length) {
    console.warn('[PeezuHub] sendEmail skipped: missing recipient, subject or html body.');
    return false;
  }

  if (!client) return false;

  try {
    await client.sendMail({
      from: getFromAddress(),
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      bcc: bccList.length ? bccList.join(', ') : undefined,
      replyTo: replyTo || undefined,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    });

    console.log(`[PeezuHub] Email sent -> ${toList.join(', ')} | ${subject}`);
    return true;
  } catch (error) {
    console.error(`[PeezuHub] sendEmail error (${subject}):`, error.message);
    return false;
  }
}

function queueEmail(payload) {
  Promise.resolve()
    .then(() => sendEmail(payload))
    .catch((error) => {
      console.error('[PeezuHub] queueEmail error:', error.message);
    });

  return true;
}

module.exports = {
  sendEmail,
  queueEmail,
  normalizeRecipients,
};
