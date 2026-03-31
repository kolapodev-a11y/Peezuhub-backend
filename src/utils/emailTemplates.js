'use strict';
/**
 * PeezuHub – Email Templates & Helpers
 * ------------------------------------
 * This is the ONLY email-template source for PeezuHub.
 * It deliberately has zero run-time dependencies beyond Node built-ins
 * so it can never cause a MODULE_NOT_FOUND crash.
 *
 * Exports
 *   APP_NAME                       – brand string read from APP_NAME env
 *   CLIENT_URL                     – frontend URL
 *   formatDateTime(date)           – "28 Mar 2026, 20:17" helper
 *   getAdminNotificationRecipients()– returns ADMIN_EMAILS env list
 *   buildAdminAlertEmail(opts)     – generic admin-alert template
 *   buildPremiumConfirmEmail(opts) – member premium-activation receipt
 */

// ─── Brand constants ──────────────────────────────────────────────────────────
const APP_NAME = process.env.APP_NAME || 'PeezuHub';
const CLIENT_URL =
  (process.env.CLIENT_URL || '').split(',')[0].trim() || 'https://peezu-hub-new.vercel.app';

// Brand colours – purple palette matching the PeezuHub UI
const BRAND_PRIMARY   = '#7C3AED'; // violet-600
const BRAND_DARK      = '#5B21B6'; // violet-700
const BRAND_LIGHT_BG  = '#F5F3FF'; // violet-50
const BRAND_TEXT      = '#1E1B4B'; // indigo-950
const MUTED_TEXT      = '#6B7280'; // gray-500
const BORDER_COLOR    = '#E5E7EB'; // gray-200
const SUCCESS_GREEN   = '#16A34A';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable date-time string, e.g. "28 Mar 2026, 20:17"
 * @param {Date|string} date
 */
function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleString('en-NG', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Lagos',
  });
}

/**
 * Returns the list of admin e-mail addresses from env.
 * Reads ADMIN_EMAILS (comma-separated) or falls back to ADMIN_EMAIL.
 * Default: peezutech@gmail.com
 */
function getAdminNotificationRecipients() {
  const raw =
    process.env.ADMIN_EMAILS ||
    process.env.ADMIN_EMAIL  ||
    'peezutech@gmail.com';

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

/**
 * Wraps `bodyHtml` in the standard PeezuHub email shell.
 * @param {string} bodyHtml   – inner HTML content
 * @param {string} [previewText] – short text visible in inbox preview
 */
function wrapLayout(bodyHtml, previewText = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body { margin:0; padding:0; background:#F9FAFB; font-family:'Segoe UI',Arial,sans-serif; }
    table { border-spacing:0; }
    td { padding:0; }
    img { border:0; display:block; }
    a { color:${BRAND_PRIMARY}; text-decoration:none; }
    .wrapper { width:100%; background:#F9FAFB; padding:40px 16px; }
    .card    { max-width:600px; margin:0 auto; background:#ffffff;
               border-radius:12px; overflow:hidden;
               border:1px solid ${BORDER_COLOR}; }
    .header  { background:${BRAND_PRIMARY}; padding:32px 40px; text-align:center; }
    .header h1 { margin:0; font-size:26px; font-weight:700;
                 color:#ffffff; letter-spacing:-0.5px; }
    .header p  { margin:6px 0 0; font-size:14px; color:rgba(255,255,255,0.85); }
    .body    { padding:32px 40px; }
    .body p  { margin:0 0 16px; font-size:15px; line-height:1.6; color:${BRAND_TEXT}; }
    .fields  { width:100%; border-collapse:collapse; margin:20px 0; table-layout:fixed; }
    .fields td { padding:10px 14px; font-size:14px; border-bottom:1px solid ${BORDER_COLOR}; vertical-align:top; }
    .fields tr:last-child td { border-bottom:none; }
    .fields .label { color:${MUTED_TEXT}; font-weight:600; width:34%; }
    .fields .value { color:${BRAND_TEXT}; word-break:break-word; overflow-wrap:anywhere; white-space:normal; }
    .fields tr:nth-child(even) td { background:${BRAND_LIGHT_BG}; }
    .btn-wrap { text-align:center; margin:28px 0 8px; }
    .btn  { display:inline-block; padding:13px 32px; background:${BRAND_PRIMARY};
            color:#ffffff !important; font-size:15px; font-weight:600;
            border-radius:8px; text-decoration:none; }
    .btn:hover { background:${BRAND_DARK}; }
    .badge { display:inline-block; padding:4px 12px; border-radius:20px;
             font-size:13px; font-weight:600; }
    .badge-success { background:#DCFCE7; color:${SUCCESS_GREEN}; }
    .footer  { background:#F3F4F6; padding:20px 40px; text-align:center;
               border-top:1px solid ${BORDER_COLOR}; }
    .footer p { margin:0 0 6px; font-size:12px; color:${MUTED_TEXT}; }
    .footer a { color:${BRAND_PRIMARY}; }
    @media (max-width:600px) {
      .body   { padding:24px 20px; }
      .header { padding:24px 20px; }
      .footer { padding:16px 20px; }
      .fields .label { width:35%; }
    }
  </style>
</head>
<body>
${previewText ? `<div style="display:none;max-height:0;overflow:hidden;color:#F9FAFB;font-size:1px;">${previewText}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ''}
<div class="wrapper">
  <table width="100%"><tr><td>
    <div class="card">
      <!-- HEADER -->
      <div class="header">
        <h1>🏠 ${APP_NAME}</h1>
        <p>Nigeria's Trusted Marketplace</p>
      </div>
      <!-- BODY -->
      <div class="body">
        ${bodyHtml}
      </div>
      <!-- FOOTER -->
      <div class="footer">
        <p>Need help? <a href="mailto:${getAdminNotificationRecipients().split(',')[0]}">Contact support</a></p>
        <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
        <p><a href="${CLIENT_URL}">${CLIENT_URL}</a></p>
      </div>
    </div>
  </td></tr></table>
</div>
</body>
</html>`;
}

// ─── Plain-text fallback helper ───────────────────────────────────────────────

function fieldsToText(fields = []) {
  return fields.map(({ label, value }) => `${label}: ${value}`).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildAdminAlertEmail
//  Used for: premium upgrade alert, new listing alert, report alert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.title       – card heading e.g. "New listing submitted"
 * @param {string}   opts.intro       – one-line intro sentence
 * @param {Array}    opts.fields      – [{label, value}, …]
 * @param {string}  [opts.actionLabel]– CTA button text
 * @param {string}  [opts.actionUrl]  – CTA button URL (defaults to admin dashboard)
 * @param {string}  [opts.footerNote] – small grey note at the bottom of the card
 * @returns {{ html:string, text:string }}
 */
function buildAdminAlertEmail({ title, intro, fields = [], actionLabel, actionUrl, footerNote }) {
  const adminUrl = actionUrl || `${CLIENT_URL}/admin`;

  const fieldRows = fields
    .map(
      ({ label, value }) =>
        `<tr><td class="label">${escHtml(label)}</td><td class="value">${escHtml(String(value))}</td></tr>`,
    )
    .join('');

  const bodyHtml = `
    <p style="font-size:20px;font-weight:700;margin:0 0 12px;color:${BRAND_TEXT};">${escHtml(title)}</p>
    <p>${escHtml(intro)}</p>
    ${fieldRows.length ? `<table class="fields"><tbody>${fieldRows}</tbody></table>` : ''}
    ${
      actionLabel
        ? `<div class="btn-wrap"><a class="btn" href="${escHtml(adminUrl)}">${escHtml(actionLabel)} →</a></div>`
        : ''
    }
    ${footerNote ? `<p style="font-size:13px;color:${MUTED_TEXT};margin-top:24px;border-top:1px solid ${BORDER_COLOR};padding-top:16px;">${escHtml(footerNote)}</p>` : ''}
  `;

  const previewText = `${title} – ${intro}`;

  const plainText = [
    `${APP_NAME} Admin Notification`,
    '='.repeat(40),
    title,
    '',
    intro,
    '',
    fieldsToText(fields),
    '',
    actionLabel ? `${actionLabel}: ${adminUrl}` : '',
    footerNote ? `\n${footerNote}` : '',
  ]
    .join('\n')
    .trim();

  return { html: wrapLayout(bodyHtml, previewText), text: plainText };
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildPremiumConfirmEmail
//  Sent to the BUYER when their seller-premium is activated
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.userName
 * @param {string} opts.userEmail
 * @param {string} opts.reference
 * @param {number} opts.amountNaira
 * @param {Date}   opts.activatedAt
 * @param {Date}   opts.expiresAt
 * @returns {{ html:string, text:string }}
 */
function buildPremiumConfirmEmail({ userName, userEmail, reference, amountNaira, activatedAt, expiresAt }) {
  const expiryStr  = formatDateTime(expiresAt);
  const activatedStr = formatDateTime(activatedAt);
  const dashboardUrl = `${CLIENT_URL}/profile`;

  const bodyHtml = `
    <!-- success badge -->
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:52px;">⭐</span>
      <p style="font-size:22px;font-weight:700;color:${BRAND_TEXT};margin:8px 0 4px;">
        Premium Activated!
      </p>
      <p style="font-size:15px;color:${MUTED_TEXT};margin:0;">
        Welcome to <strong>${APP_NAME} Seller Premium</strong>
      </p>
    </div>

    <p>Hi <strong>${escHtml(userName)}</strong>,</p>
    <p>
      Your payment was successful and your <strong>Seller Premium</strong> plan is now
      <span class="badge badge-success">ACTIVE</span>.
      All your current listings are now featured &amp; verified, and any new listings
      you post will automatically receive premium visibility until your plan expires.
    </p>

    <table class="fields"><tbody>
      <tr><td class="label">Reference</td><td class="value">${escHtml(reference)}</td></tr>
      <tr><td class="label">Account email</td><td class="value">${escHtml(userEmail)}</td></tr>
      <tr><td class="label">Amount paid</td><td class="value">₦${Number(amountNaira).toLocaleString('en-NG')}</td></tr>
      <tr><td class="label">Plan</td><td class="value">Seller Premium – All listings</td></tr>
      <tr><td class="label">Activated</td><td class="value">${escHtml(activatedStr)}</td></tr>
      <tr><td class="label">Expires</td><td class="value">${escHtml(expiryStr)}</td></tr>
    </tbody></table>

    <div style="margin:16px 0 20px;padding:14px 16px;border:1px solid ${BORDER_COLOR};border-radius:12px;background:#fff;word-break:break-word;overflow-wrap:anywhere;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED_TEXT};">Premium account email</p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:${BRAND_TEXT};word-break:break-word;overflow-wrap:anywhere;">${escHtml(userEmail)}</p>
    </div>

    <p style="background:${BRAND_LIGHT_BG};border-left:4px solid ${BRAND_PRIMARY};
              padding:14px 16px;border-radius:0 8px 8px 0;font-size:14px;color:${BRAND_TEXT};">
      🎉 <strong>What you get:</strong> Featured badge on all listings, verified seller tick,
      priority placement in search results, and premium visibility across the platform.
    </p>

    <div class="btn-wrap">
      <a class="btn" href="${escHtml(dashboardUrl)}">Go to My Dashboard →</a>
    </div>

    <p style="font-size:13px;color:${MUTED_TEXT};margin-top:24px;
              border-top:1px solid ${BORDER_COLOR};padding-top:16px;">
      If you have any questions, reply to this email or contact us at
      <a href="mailto:${getAdminNotificationRecipients().split(',')[0]}">${getAdminNotificationRecipients().split(',')[0]}</a>.
    </p>
  `;

  const plainText = [
    `${APP_NAME} – Premium Activated`,
    '='.repeat(40),
    `Hi ${userName},`,
    '',
    'Your Seller Premium plan is now ACTIVE.',
    '',
    `Reference : ${reference}`,
    `Email     : ${userEmail}`,
    `Amount    : ₦${Number(amountNaira).toLocaleString('en-NG')}`,
    `Plan      : Seller Premium (all listings)`,
    `Activated : ${activatedStr}`,
    `Expires   : ${expiryStr}`,
    '',
    'All your current listings are now featured & verified.',
    '',
    `Visit your dashboard: ${dashboardUrl}`,
    '',
    `Need help? Email: ${getAdminNotificationRecipients().split(',')[0]}`,
  ].join('\n');

  return { html: wrapLayout(bodyHtml, `Your ${APP_NAME} Seller Premium is now active!`), text: plainText };
}

// ─── Tiny HTML-escape helper (prevents XSS in dynamic values) ────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  APP_NAME,
  CLIENT_URL,
  formatDateTime,
  getAdminNotificationRecipients,
  buildAdminAlertEmail,
  buildPremiumConfirmEmail,
};
