'use strict';
/**
 * PeezuHub – resilient SMTP mailer for Render/Gmail
 * -------------------------------------------------
 * Fix included in this version:
 * - If SMTP_USER is missing in production, the mailer now derives it from
 *   SMTP_FROM, COURIER_FROM_EMAIL, COURIER_REPLY_TO, or ADMIN_EMAIL.
 * - This prevents false "SMTP not fully configured" warnings when Gmail
 *   credentials are otherwise present.
 *
 * Safety improvement:
 * - Nodemailer is loaded lazily so a missing dependency never crashes boot.
 * - If SMTP/nodemailer is unavailable, the API keeps running and logs a warning.
 */

let nodemailerInstance = null;
let nodemailerLoadAttempted = false;

function getNodemailer() {
  if (nodemailerLoadAttempted) {
    return nodemailerInstance;
  }

  nodemailerLoadAttempted = true;

  try {
    // eslint-disable-next-line global-require
    nodemailerInstance = require('nodemailer');
  } catch (error) {
    nodemailerInstance = null;
    console.error('[PeezuHub] nodemailer is not installed or could not be loaded:', error.message);
  }

  return nodemailerInstance;
}

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

function extractEmailAddress(value) {
  if (!value) return '';

  const raw = String(value).trim();
  const angleMatch = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch && angleMatch[1]) {
    return angleMatch[1].trim();
  }

  const plainMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch ? plainMatch[0].trim() : '';
}

function getFirstNonEmpty(values = []) {
  for (const value of values) {
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

function getSmtpUser() {
  return getFirstNonEmpty([
    process.env.SMTP_USER,
    process.env.SMTP_EMAIL,
    extractEmailAddress(process.env.SMTP_FROM),
    process.env.COURIER_FROM_EMAIL,
    process.env.COURIER_REPLY_TO,
    extractEmailAddress(process.env.COURIER_FROM),
    process.env.ADMIN_EMAIL,
  ]);
}

function getReplyToAddress() {
  return getFirstNonEmpty([
    process.env.SMTP_REPLY_TO,
    process.env.COURIER_REPLY_TO,
    process.env.ADMIN_EMAIL,
    getSmtpUser(),
  ]);
}

function getFromAddress() {
  if (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) {
    return process.env.SMTP_FROM.trim();
  }

  if (process.env.COURIER_FROM && process.env.COURIER_FROM.trim()) {
    return process.env.COURIER_FROM.trim();
  }

  const smtpUser = getSmtpUser();
  if (smtpUser) {
    return `${process.env.APP_NAME || 'PeezuHub'} <${smtpUser}>`;
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

function getMissingSmtpFields({ service, host, user, pass }) {
  const missing = [];

  if (!service && !host) missing.push('SMTP_SERVICE/SMTP_HOST');
  if (!user) missing.push('SMTP_USER (or SMTP_FROM/ADMIN_EMAIL fallback)');
  if (!pass) missing.push('SMTP_PASS');

  return missing;
}

function buildTransportConfig() {
  const SMTP_SERVICE = (process.env.SMTP_SERVICE || '').trim();
  const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
  const SMTP_USER = getSmtpUser();
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
  const nodemailer = getNodemailer();
  if (!nodemailer) {
    console.warn('[PeezuHub] Email transport unavailable because nodemailer could not be loaded.');
    return null;
  }

  const config = buildTransportConfig();
  if (!config) {
    const missing = getMissingSmtpFields({
      service: (process.env.SMTP_SERVICE || '').trim(),
      host: (process.env.SMTP_HOST || '').trim(),
      user: getSmtpUser(),
      pass: (process.env.SMTP_PASS || '').trim(),
    });

    console.warn(`[PeezuHub] SMTP not fully configured - missing: ${missing.join(', ')}. Emails will be skipped.`);
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

  if (!toList.length || !subject || (!html && !text)) {
    console.warn('[PeezuHub] sendEmail skipped: missing recipient, subject or body.');
    return false;
  }

  const client = createTransporter();
  if (!client) return false;

  const resolvedHtml = html || `<pre style="font-family:inherit;white-space:pre-wrap;">${String(text || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</pre>`;
  const resolvedText = text || stripHtml(resolvedHtml);

  const mailOptions = {
    from: getFromAddress(),
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    bcc: bccList.length ? bccList.join(', ') : undefined,
    replyTo: replyTo || getReplyToAddress() || undefined,
    subject,
    html: resolvedHtml,
    text: resolvedText,
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
