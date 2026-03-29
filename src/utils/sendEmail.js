'use strict';
/**
 * PeezuHub – sendEmail utility
 * ----------------------------
 * Wraps nodemailer.  Reads SMTP_* environment variables.
 * Silently returns false when SMTP is not configured (prevents boot crash).
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[PeezuHub] SMTP not fully configured – emails disabled.');
    return null;
  }

  const port   = Number(SMTP_PORT);
  const secure = port === 465; // SSL for 465, STARTTLS for 587

  _transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Helps with Gmail App Passwords
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Send an email.
 *
 * @param {object}          opts
 * @param {string|string[]} opts.to       – recipient address(es) or comma-separated string
 * @param {string}          opts.subject
 * @param {string}          opts.html     – HTML body
 * @param {string}         [opts.text]    – plain-text fallback (auto-stripped if omitted)
 * @returns {Promise<boolean>}            – true on success, false if skipped/failed
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || !html) {
    console.warn('[PeezuHub] sendEmail: missing required fields (to / subject / html).');
    return false;
  }

  const client = getTransporter();
  if (!client) return false;

  // Normalise recipients – accept array or comma-separated string
  const recipients = Array.isArray(to) ? to.join(', ') : to;

  const from =
    process.env.SMTP_FROM ||
    `${process.env.APP_NAME || 'PeezuHub'} <${process.env.SMTP_USER}>`;

  try {
    await client.sendMail({
      from,
      to: recipients,
      subject,
      html,
      // Strip HTML tags for a basic plain-text fallback when not supplied
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    });
    console.log(`[PeezuHub] Email sent → ${recipients} | Subject: ${subject}`);
    return true;
  } catch (err) {
    // Log but do NOT rethrow – a failed email must never crash the HTTP response
    console.error('[PeezuHub] sendEmail error:', err.message);
    return false;
  }
}

module.exports = { sendEmail };
