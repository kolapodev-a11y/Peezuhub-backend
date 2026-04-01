'use strict';
/**
 * PeezuHub – email delivery with Courier restored as the default transport.
 * ----------------------------------------------------------------------
 * Delivery priority:
 * 1) Courier Send API (when COURIER_API_KEY is present)
 * 2) Gmail API (only when Courier is not configured and Google OAuth vars exist)
 * 3) SMTP via Nodemailer (only when Courier is not configured and SMTP vars exist)
 *
 * This restores the older Render-friendly setup where admin emails can be sent
 * through Courier without requiring direct SMTP connectivity from Render.
 */

const axios = require('axios');

let nodemailerInstance = null;
let nodemailerLoadAttempted = false;
const gmailTokenCache = {
  accessToken: '',
  expiresAt: 0,
};

function getNodemailer() {
  if (nodemailerLoadAttempted) return nodemailerInstance;

  nodemailerLoadAttempted = true;

  try {
    // eslint-disable-next-line global-require
    nodemailerInstance = require('nodemailer');
  } catch (error) {
    nodemailerInstance = null;
    console.error('[PeezuHub] nodemailer could not be loaded:', error.message);
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

function getMailBrandName() {
  return (
    process.env.MAIL_APP_NAME?.trim() ||
    process.env.PEEZUHUB_APP_NAME?.trim() ||
    process.env.APP_NAME?.trim() ||
    'PeezuHub'
  );
}

function extractEmailAddress(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const match = trimmed.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return trimmed;
}

function getSenderEmail() {
  return (
    extractEmailAddress(process.env.COURIER_FROM_EMAIL) ||
    extractEmailAddress(process.env.GMAIL_SENDER_EMAIL) ||
    extractEmailAddress(process.env.SMTP_FROM) ||
    extractEmailAddress(process.env.SMTP_USER)
  );
}

function getFromAddress() {
  const explicitFrom = String(process.env.COURIER_FROM_EMAIL || '').trim();
  if (explicitFrom) return explicitFrom;

  const senderEmail = getSenderEmail();
  if (!senderEmail) return undefined;
  return `${getMailBrandName()} <${senderEmail}>`;
}

function getReplyToAddress(overrideValue = '') {
  return (
    String(overrideValue || '').trim() ||
    String(process.env.COURIER_REPLY_TO || '').trim() ||
    String(process.env.MAIL_REPLY_TO || '').trim() ||
    undefined
  );
}

function isLikelyGmailAddress(value = '') {
  return String(value).trim().toLowerCase().endsWith('@gmail.com');
}

function getDeliveryMode() {
  return String(process.env.EMAIL_DELIVERY_MODE || process.env.MAIL_DELIVERY_MODE || 'auto')
    .trim()
    .toLowerCase();
}

function hasCourierConfig() {
  return Boolean(String(process.env.COURIER_API_KEY || '').trim());
}

function shouldUseCourier() {
  const mode = getDeliveryMode();
  if (mode === 'courier') return hasCourierConfig();
  if (mode === 'gmail_api' || mode === 'smtp') return false;
  return hasCourierConfig();
}

function shouldUseGmailApi() {
  const mode = getDeliveryMode();

  const hasOauthConfig = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_REFRESH_TOKEN?.trim() &&
      getSenderEmail()
  );

  if (mode === 'courier') return false;
  if (mode === 'gmail_api') return hasOauthConfig;
  if (mode === 'smtp') return false;
  if (hasCourierConfig()) return false;
  return hasOauthConfig;
}

function encodeHeader(value = '') {
  const safe = String(value || '');
  return /[^\x00-\x7F]/.test(safe)
    ? `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`
    : safe;
}

function chunkBase64(value = '') {
  return String(value).replace(/.{1,76}/g, '$&\r\n').trim();
}

function toBase64Url(value = '') {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildMimeMessage({ from, to, cc, bcc, replyTo, subject, html, text }) {
  const boundary = `peezuhub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plainText = text || stripHtml(html);

  const lines = [
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${normalizeRecipients(to).join(', ')}`,
    cc ? `Cc: ${normalizeRecipients(cc).join(', ')}` : '',
    bcc ? `Bcc: ${normalizeRecipients(bcc).join(', ')}` : '',
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: ${encodeHeader(subject)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunkBase64(Buffer.from(String(plainText), 'utf8').toString('base64')),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunkBase64(Buffer.from(String(html), 'utf8').toString('base64')),
    '',
    `--${boundary}--`,
    '',
  ].filter(Boolean);

  return lines.join('\r\n');
}

async function sendViaCourier(mailOptions) {
  const apiKey = String(process.env.COURIER_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[PeezuHub] Courier not configured - COURIER_API_KEY is missing.');
    return false;
  }

  const toList = normalizeRecipients(mailOptions.to);
  const ccList = normalizeRecipients(mailOptions.cc);
  const bccList = normalizeRecipients(mailOptions.bcc);
  const from = mailOptions.from || getFromAddress();
  const replyTo = getReplyToAddress(mailOptions.replyTo);
  const text = mailOptions.text || stripHtml(mailOptions.html || '');

  if (!toList.length) {
    console.warn('[PeezuHub] Courier send skipped: no recipient.');
    return false;
  }

  const payload = {
    message: {
      to: toList.length === 1 ? { email: toList[0] } : toList.map((email) => ({ email })),
      routing: {
        method: 'single',
        channels: ['email'],
      },
      content: {
        title: mailOptions.subject,
        body: text || mailOptions.subject,
      },
      channels: {
        email: {
          override: {
            subject: mailOptions.subject,
            html: mailOptions.html,
            text,
            ...(from ? { from } : {}),
            ...(replyTo ? { reply_to: replyTo } : {}),
            ...(ccList.length ? { cc: ccList.join(', ') } : {}),
            ...(bccList.length ? { bcc: bccList.join(', ') } : {}),
          },
        },
      },
    },
  };

  const response = await axios.post('https://api.courier.com/send', payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 20_000,
  });

  const requestId = response?.data?.requestId || response?.data?.messageId || 'unknown-request-id';
  console.log(`[PeezuHub] Email sent via Courier -> ${toList.join(', ')} | ${mailOptions.subject} | requestId=${requestId}`);
  return true;
}

async function getGmailApiAccessToken() {
  if (gmailTokenCache.accessToken && gmailTokenCache.expiresAt - Date.now() > 60_000) {
    return gmailTokenCache.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN for Gmail API delivery.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20_000,
  });

  gmailTokenCache.accessToken = response.data.access_token;
  gmailTokenCache.expiresAt = Date.now() + Number(response.data.expires_in || 3600) * 1000;
  return gmailTokenCache.accessToken;
}

async function sendViaGmailApi(mailOptions) {
  const senderEmail = getSenderEmail();
  if (!senderEmail) {
    throw new Error('A sender email is required for Gmail API delivery.');
  }

  const accessToken = await getGmailApiAccessToken();
  const raw = toBase64Url(
    buildMimeMessage({
      ...mailOptions,
      from: mailOptions.from || `${getMailBrandName()} <${senderEmail}>`,
    })
  );

  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 20_000,
    }
  );
}

function buildSmtpTransportConfigs() {
  const SMTP_SERVICE = (process.env.SMTP_SERVICE || '').trim();
  const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
  const SMTP_USER = (process.env.SMTP_USER || '').trim();
  const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
  const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
  const secureOverride = String(process.env.SMTP_SECURE || '').trim().toLowerCase();

  if (!SMTP_USER || !SMTP_PASS) return [];

  const gmailLike =
    String(SMTP_SERVICE).trim().toLowerCase() === 'gmail' ||
    String(SMTP_HOST).trim().toLowerCase() === 'smtp.gmail.com' ||
    isLikelyGmailAddress(SMTP_USER);

  const configs = [];

  if (SMTP_HOST) {
    const port = SMTP_PORT || (secureOverride === 'true' ? 465 : gmailLike ? 465 : 587);
    const secure = secureOverride ? secureOverride === 'true' : port === 465;

    configs.push({
      host: SMTP_HOST,
      port,
      secure,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 45_000,
      tls: {
        minVersion: 'TLSv1.2',
        servername: SMTP_HOST,
      },
    });

    if (gmailLike && !SMTP_PORT && !secureOverride) {
      configs.push({
        host: SMTP_HOST,
        port: 587,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 45_000,
        requireTLS: true,
        tls: {
          minVersion: 'TLSv1.2',
          servername: SMTP_HOST,
        },
      });
    }

    return configs;
  }

  if (gmailLike) {
    configs.push(
      {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 45_000,
        tls: {
          minVersion: 'TLSv1.2',
          servername: 'smtp.gmail.com',
        },
      },
      {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 45_000,
        requireTLS: true,
        tls: {
          minVersion: 'TLSv1.2',
          servername: 'smtp.gmail.com',
        },
      }
    );

    return configs;
  }

  if (!SMTP_SERVICE) return [];

  const secure = secureOverride === 'true';
  configs.push({
    service: SMTP_SERVICE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    secure,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
    tls: {
      minVersion: 'TLSv1.2',
    },
  });

  return configs;
}

function shouldRetryMailError(error) {
  const code = String(error?.code || '').toUpperCase();
  const command = String(error?.command || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

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

function explainPossibleRenderBlock(error) {
  const isRender = String(process.env.RENDER || '').trim().toLowerCase() === 'true';
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  if (!isRender) return '';
  if (!['ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(code) && !message.includes('timeout')) return '';

  return ' Render commonly blocks outbound SMTP on free web services; prefer Courier with COURIER_API_KEY / COURIER_FROM_EMAIL / COURIER_REPLY_TO or use Gmail API OAuth instead of raw SMTP.';
}

async function sendViaSmtp(mailOptions) {
  const nodemailer = getNodemailer();
  if (!nodemailer) {
    console.warn('[PeezuHub] Email transport unavailable because nodemailer could not be loaded.');
    return false;
  }

  const configs = buildSmtpTransportConfigs();
  if (!configs.length) {
    console.warn('[PeezuHub] SMTP not fully configured - emails will be skipped.');
    return false;
  }

  let lastError = null;

  for (const config of configs) {
    const target = config.service || `${config.host}:${config.port}`;

    try {
      const client = nodemailer.createTransport(config);
      await client.sendMail(mailOptions);
      console.log(`[PeezuHub] Email sent via SMTP (${target}) -> ${mailOptions.to} | ${mailOptions.subject}`);
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`[PeezuHub] SMTP delivery failed via ${target}: ${error.message}`);

      if (!shouldRetryMailError(error)) break;
    }
  }

  if (lastError) {
    console.error(`[PeezuHub] SMTP delivery exhausted (${mailOptions.subject}): ${lastError.message}.${explainPossibleRenderBlock(lastError)}`);
  }

  return false;
}

async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!toList.length || !subject || !html) {
    console.warn('[PeezuHub] sendEmail skipped: missing recipient, subject or html body.');
    return false;
  }

  const mailOptions = {
    from: getFromAddress(),
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    bcc: bccList.length ? bccList.join(', ') : undefined,
    replyTo: getReplyToAddress(replyTo),
    subject,
    html,
    text: text || stripHtml(html),
  };

  if (shouldUseCourier()) {
    try {
      return await sendViaCourier(mailOptions);
    } catch (error) {
      console.error(`[PeezuHub] Courier delivery failed (${subject}): ${error.message}`);
      return false;
    }
  }

  if (shouldUseGmailApi()) {
    try {
      await sendViaGmailApi(mailOptions);
      console.log(`[PeezuHub] Email sent via Gmail API -> ${toList.join(', ')} | ${subject}`);
      return true;
    } catch (error) {
      console.error(`[PeezuHub] Gmail API delivery failed (${subject}): ${error.message}`);
      return false;
    }
  }

  return sendViaSmtp(mailOptions);
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
