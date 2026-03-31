'use strict';
/**
 * PeezuHub – resilient SMTP mailer for Render/Gmail
 * -------------------------------------------------
 * Creates a fresh transport per send, avoids stale pooled sockets,
 * and retries once on transient timeout / connection errors.
 */

const nodemailer = require('nodemailer');

function normalizeRecipients(value) {
  if (!value) return [];

  const items = Array.isArray(value)
    ? value
    : String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFromAddress() {
  if (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) {
    return process.env.SMTP_FROM.trim();
  }

  if (process.env.SMTP_USER && process.env.SMTP_USER.trim()) {
    return `${process.env.APP_NAME || 'PeezuHub'} <${process.env.SMTP_USER.trim()}>`;
  }

  return undefined;
}

function isGmailTransport({ service, host, user }) {
  const normalizedService = String(service || '').trim().toLowerCase();
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedUser = String(user || '').trim().toLowerCase();

  return (
    normalizedService === 'gmail' ||
    normalizedHost === 'smtp.gmail.com' ||
    normalizedHost.endsWith('.gmail.com') ||
    normalizedUser.endsWith('@gmail.com')
  );
}

function buildTransportConfig() {
  const SMTP_SERVICE = (process.env.SMTP_SERVICE || '').trim();
  const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
  const SMTP_USER = (process.env.SMTP_USER || '').trim();
  const SMTP_PASS = (process.env.SMTP_PASS || '').trim();

  if (!SMTP_USER || !SMTP_PASS || (!SMTP_SERVICE && !SMTP_HOST)) {
    return null;
  }

  const gmailMode = isGmailTransport({
    service: SMTP_SERVICE,
    host: SMTP_HOST,
    user: SMTP_USER,
  });

  const fallbackPort = gmailMode ? 465 : 587;
  const port = Number(process.env.SMTP_PORT || fallbackPort);
  const secure = String(process.env.SMTP_SECURE || '').trim()
    ? String(process.env.SMTP_SECURE).trim().toLowerCase() === 'true'
    : port === 465;

  const config = {
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    secure,
    pool: false,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    requireTLS: !secure,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
  };

  if (gmailMode) {
    config.service = 'gmail';
  } else if (SMTP_SERVICE) {
    config.service = SMTP_SERVICE;
  } else {
    config.host = SMTP_HOST;
    config.port = port;
    if (SMTP_HOST) {
      config.tls.servername = SMTP_HOST;
    }
  }

  if (!config.port && !config.service) {
    config.port = port;
  }

  return config;
}

function createTransporter() {
  const config = buildTransportConfig();
  if (!config) {
    console.warn('[PeezuHub] SMTP not fully configured - emails will be skipped.');
    return null;
  }

  return nodemailer.createTransport(config);
}

function shouldRetryMailError(error) {
  const code = String(error && error.code ? error.code : '').toUpperCase();
  const command = String(error && error.command ? error.command : '').toUpperCase();
  const message = String(error && error.message ? error.message : '').toLowerCase();

  return (
    ['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ESOCKET', 'EPIPE'].includes(code) ||
    command === 'CONN' ||
    message.includes('timeout') ||
    message.includes('connection reset') ||
    message.includes('greeting never received') ||
    message.includes('invalid greeting') ||
    message.includes('socket closed')
  );
}

async function deliverMail(client, mailOptions) {
  return client.sendMail(mailOptions);
}

async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!toList.length || !subject || !html) {
    console.warn('[PeezuHub] sendEmail skipped: missing recipient, subject or html body.');
    return false;
  }

  const client = createTransporter();
  if (!client) return false;

  const mailOptions = {
    from: getFromAddress(),
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    bcc: bccList.length ? bccList.join(', ') : undefined,
    replyTo: replyTo || undefined,
    subject,
    html,
    text: text || stripHtml(html),
  };

  try {
    await deliverMail(client, mailOptions);
    console.log(`[PeezuHub] Email sent -> ${toList.join(', ')} | ${subject}`);
    return true;
  } catch (error) {
    if (!shouldRetryMailError(error)) {
      console.error(`[PeezuHub] sendEmail error (${subject}):`, error.message);
      return false;
    }

    console.warn(`[PeezuHub] SMTP transient error, retrying once (${subject}): ${error.message}`);

    try {
      const retryClient = createTransporter();
      if (!retryClient) return false;
      await deliverMail(retryClient, mailOptions);
      console.log(`[PeezuHub] Email sent on retry -> ${toList.join(', ')} | ${subject}`);
      return true;
    } catch (retryError) {
      console.error(`[PeezuHub] sendEmail retry failed (${subject}):`, retryError.message);
      return false;
    }
  }
}

function queueEmail(payload) {
  setImmediate(() => {
    sendEmail(payload).catch((error) => {
      console.error('[PeezuHub] queueEmail error:', error.message);
    });
  });

  return true;
}

module.exports = {
  sendEmail,
  queueEmail,
  normalizeRecipients,
};
