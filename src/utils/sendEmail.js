'use strict';
/**
 * PeezuHub – email delivery via Resend
 * =====================================
 * Single, clean transport: Resend API (https://resend.com)
 *
 * Required env var:
 *   RESEND_API_KEY       – your Resend secret key (re_xxxxxxxxxxxxxxxx)
 *
 * Optional env vars:
 *   RESEND_FROM_EMAIL    – full "From" address, e.g. "PeezuHub <hello@yourdomain.com>"
 *                          If omitted the Resend test sender is used (good for dev only).
 *   RESEND_REPLY_TO      – reply-to address, e.g. "support@yourdomain.com"
 *   MAIL_APP_NAME        – brand name used in log messages (falls back to APP_NAME)
 *   APP_NAME             – application name (default "PeezuHub")
 *
 * Exports (interface unchanged – all callers work without modification):
 *   sendEmail({ to, cc, bcc, subject, html, text, replyTo }) → Promise<boolean>
 *   queueEmail(payload)                                       → true  (fire-and-forget)
 *   normalizeRecipients(value)                                → string[]
 *
 * Email templates (src/utils/emailTemplates.js) are NOT touched – they remain
 * exactly as they were.
 */

const { Resend } = require('resend');

// ─── helpers ─────────────────────────────────────────────────────────────────

function getMailBrandName() {
  return (
    process.env.MAIL_APP_NAME?.trim() ||
    process.env.PEEZUHUB_APP_NAME?.trim() ||
    process.env.APP_NAME?.trim() ||
    'PeezuHub'
  );
}

/**
 * Accepts a comma-separated string, a single email address, or an array.
 * Returns a de-duplicated array of trimmed address strings.
 */
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

/** Strip HTML tags to produce a plain-text fallback. */
function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve the "from" address.
 * In production set RESEND_FROM_EMAIL to a verified domain sender, e.g.:
 *   RESEND_FROM_EMAIL=PeezuHub <noreply@peezuhub.name.ng>
 */
function getFromAddress() {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    `${getMailBrandName()} <onboarding@resend.dev>`
  );
}

function getReplyTo(overrideValue = '') {
  const resolved =
    String(overrideValue || '').trim() ||
    String(process.env.RESEND_REPLY_TO || '').trim();
  return resolved || undefined;
}

/** Create and return a Resend client, throwing if the key is missing. */
function createResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      '[PeezuHub] RESEND_API_KEY is not configured. ' +
        'Add it to your .env / Render environment variables.'
    );
  }
  return new Resend(apiKey);
}

// ─── core send function ───────────────────────────────────────────────────────

/**
 * Send a single email through Resend.
 *
 * @param {{ to, cc, bcc, subject, html, text, replyTo }} options
 * @returns {Promise<boolean>} true on success, false on any failure
 */
async function sendEmail({ to, cc, bcc, subject, html, text, replyTo }) {
  const toList  = normalizeRecipients(to);
  const ccList  = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  if (!toList.length || !subject || !html) {
    console.warn(
      '[PeezuHub] sendEmail skipped: missing recipient, subject or html body.'
    );
    return false;
  }

  let resend;
  try {
    resend = createResendClient();
  } catch (err) {
    console.error(err.message);
    return false;
  }

  /** @type {import('resend').CreateEmailOptions} */
  const payload = {
    from:    getFromAddress(),
    to:      toList,
    subject,
    html,
    text:    text || stripHtml(html),
  };

  if (ccList.length)  payload.cc  = ccList;
  if (bccList.length) payload.bcc = bccList;

  const resolvedReplyTo = getReplyTo(replyTo);
  if (resolvedReplyTo) payload.reply_to = resolvedReplyTo;

  try {
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error(
        `[PeezuHub] Resend delivery failed (${subject}): ${JSON.stringify(error)}`
      );
      return false;
    }

    console.log(
      `[PeezuHub] Email sent via Resend -> ${toList.join(', ')} | ${subject} | id=${data?.id}`
    );
    return true;
  } catch (err) {
    console.error(`[PeezuHub] Resend exception (${subject}): ${err.message}`);
    return false;
  }
}

// ─── fire-and-forget wrapper ──────────────────────────────────────────────────

/**
 * Queue an email to be sent asynchronously (non-blocking).
 * Equivalent to the old queueEmail – all call-sites work unchanged.
 *
 * @param {{ to, cc, bcc, subject, html, text, replyTo }} payload
 * @returns {true}
 */
function queueEmail(payload) {
  setImmediate(() => {
    sendEmail(payload).catch((err) => {
      console.error('[PeezuHub] queueEmail error:', err.message);
    });
  });
  return true;
}

// ─── exports ─────────────────────────────────────────────────────────────────

module.exports = {
  sendEmail,
  queueEmail,
  normalizeRecipients,
};
