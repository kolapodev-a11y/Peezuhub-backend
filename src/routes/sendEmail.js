'use strict';
/**
 * PeezuHub – email delivery via Courier
 * =====================================
 * Restores the original Courier-first delivery flow and keeps the existing
 * sendEmail / queueEmail interface unchanged so the current email templates
 * and calling code continue to work without modification.
 *
 * Required env vars:
 *   COURIER_API_KEY      - Courier production API key
 *
 * Optional env vars:
 *   COURIER_FROM_EMAIL   - full From address, e.g. "PeezuHub <peezutech@gmail.com>"
 *   COURIER_REPLY_TO     - reply-to address
 *   MAIL_APP_NAME        - brand name used in logs (fallbacks: PEEZUHUB_APP_NAME, APP_NAME)
 *   APP_NAME             - app name fallback
 *
 * Exports (interface preserved):
 *   sendEmail({ to, cc, bcc, subject, html, text, replyTo }) -> Promise<boolean>
 *   queueEmail(payload)                                      -> true
 *   normalizeRecipients(value)                               -> string[]
 */

const axios = require('axios');

const COURIER_SEND_URL = 'https://api.courier.com/send';

function getMailBrandName() {
  return (
    process.env.MAIL_APP_NAME?.trim() ||
    process.env.PEEZUHUB_APP_NAME?.trim() ||
    process.env.APP_NAME?.trim() ||
    'PeezuHub'
  );
}

function normalizeRecipients(value) {
  if (!value) return [];

  const items = Array.isArray(value)
    ? value
    : String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  return [...new Set(items.map((s) => String(s).trim()).filter(Boolean))];
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFromAddress() {
  return (
    process.env.COURIER_FROM_EMAIL?.trim() ||
    `${getMailBrandName()} <no-reply@peezuhub.local>`
  );
}

function getReplyTo(overrideValue = '') {
  const resolved =
    String(overrideValue || '').trim() ||
    String(process.env.COURIER_REPLY_TO || '').trim();
  return resolved || undefined;
}

function getCourierApiKey() {
  const apiKey = String(process.env.COURIER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      '[PeezuHub] COURIER_API_KEY is not configured. Add it to your Render environment variables.'
    );
  }
  return apiKey;
}

async function sendCourierMessage({ recipient, ccList, bccList, subject, html, text, replyTo }) {
  const apiKey = getCourierApiKey();

  const override = {
    subject,
    html,
    text: text || stripHtml(html),
    from: getFromAddress(),
  };

  const resolvedReplyTo = getReplyTo(replyTo);
  if (resolvedReplyTo) override.reply_to = resolvedReplyTo;
  if (ccList.length) override.cc = ccList.join(',');
  if (bccList.length) override.bcc = bccList.join(',');

  const payload = {
    message: {
      to: { email: recipient },
      content: {
        title: subject,
        body: override.text,
      },
      channels: {
        email: {
          override,
        },
      },
    },
  };

  const response = await axios.post(COURIER_SEND_URL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  return response?.data?.requestId;
}

async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!toList.length || !subject || !html) {
    console.warn('[PeezuHub] sendEmail skipped: missing recipient, subject or html body.');
    return false;
  }

  try {
    const results = await Promise.all(
      toList.map((recipient) =>
        sendCourierMessage({
          recipient,
          ccList,
          bccList,
          subject,
          html,
          text,
          replyTo,
        })
      )
    );

    console.log(
      `[PeezuHub] Email sent via Courier -> ${toList.join(', ')} | ${subject} | requestIds=${results.join(', ')}`
    );
    return true;
  } catch (err) {
    const status = err?.response?.status;
    const details = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[PeezuHub] Courier delivery failed (${subject})${status ? ` [${status}]` : ''}: ${details}`);
    return false;
  }
}

function queueEmail(payload) {
  setImmediate(() => {
    sendEmail(payload).catch((err) => {
      console.error('[PeezuHub] queueEmail error:', err.message);
    });
  });
  return true;
}

module.exports = {
  sendEmail,
  queueEmail,
  normalizeRecipients,
};
