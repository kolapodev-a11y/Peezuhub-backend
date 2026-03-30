/**
 * sendEmail.js — PeezuHub
 *
 * FIX: Email overflow for long values (e.g. long Gmail addresses).
 *   – Added `word-break: break-all; overflow-wrap: anywhere` to the value <td>
 *   – Added `max-width: 1px` trick so table cells respect container width
 *   – Table now uses `table-layout: fixed` for stable column widths
 */

const axios = require('axios');

const DEFAULT_ADMIN_EMAIL = 'peezutech@gmail.com';
const DEFAULT_BRAND_COLOR = '#2563eb';
const APP_NAME = 'PeezuHub';

function getCourierApiKey() {
  return process.env.COURIER_API_KEY || '';
}

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
}

function getClientUrl(path = '') {
  const base =
    process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function normalizeLine(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * renderRows — renders label/value pairs as HTML table rows.
 *
 * FIX: value <td> now has:
 *   • word-break: break-all        – breaks long email addresses & references
 *   • overflow-wrap: anywhere      – modern equivalent (better browser support)
 *   • max-width: 1px               – forces table-layout: fixed to honour width
 *
 * The surrounding <table> also gets table-layout: fixed so columns
 * respect declared widths and long values can never blow out the card.
 */
function renderRows(rows = []) {
  return rows
    .map(
      (row) => `
        <tr>
          <td style="
            padding: 0 8px 12px 0;
            vertical-align: top;
            width: 36%;
            color: #64748b;
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
          ">${escapeHtml(row.label)}</td>
          <td style="
            padding: 0 0 12px;
            vertical-align: top;
            color: #0f172a;
            font-size: 14px;
            line-height: 1.6;
            word-break: break-all;
            overflow-wrap: anywhere;
            max-width: 1px;
            ${
              row.mono
                ? 'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;'
                : ''
            }
          ">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join('');
}

function buildEmailTemplate({
  badge,
  title,
  intro,
  rows = [],
  alert = '',
  ctaLabel = '',
  ctaUrl = '',
  accentColor = DEFAULT_BRAND_COLOR,
  footer =
    'You are receiving this because you are the PeezuHub admin contact for operational notifications.',
}) {
  const textRows = rows.map((row) => `${row.label}: ${row.value}`).join('\n');
  const text = [
    badge,
    title,
    normalizeLine(intro),
    textRows,
    alert,
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : '',
    footer,
  ]
    .filter(Boolean)
    .join('\n\n');

  const html = `
    <div style="margin:0; padding:24px; background:#f8fafc; font-family:Inter,Arial,sans-serif; color:#0f172a;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:24px; overflow:hidden; box-shadow:0 12px 40px rgba(15,23,42,0.08);">

        <!-- Header -->
        <div style="background:${accentColor}; padding:20px 24px; color:#ffffff;">
          <div style="font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; opacity:0.85;">${escapeHtml(APP_NAME)} Admin Alert</div>
          <div style="margin-top:10px; display:inline-block; background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.22); border-radius:999px; padding:5px 12px; font-size:11px; font-weight:700;">${escapeHtml(badge)}</div>
          <h1 style="margin:14px 0 0; font-size:26px; line-height:1.25; font-weight:800; color:#ffffff;">${escapeHtml(title)}</h1>
        </div>

        <!-- Body -->
        <div style="padding:24px;">
          <p style="margin:0 0 18px; font-size:15px; line-height:1.8; color:#334155;">${escapeHtml(intro)}</p>

          <!-- Detail card — table-layout:fixed ensures columns honour widths -->
          <div style="border:1px solid #e2e8f0; border-radius:16px; padding:18px 18px 6px; background:#f8fafc; overflow:hidden;">
            <table
              role="presentation"
              width="100%"
              cellspacing="0"
              cellpadding="0"
              border="0"
              style="table-layout:fixed; width:100%; border-collapse:collapse;"
            >
              ${renderRows(rows)}
            </table>
          </div>

          ${
            alert
              ? `<div style="margin-top:18px; border-left:4px solid ${accentColor}; background:#eff6ff; padding:14px 16px; border-radius:12px; color:#1e3a8a; font-size:14px; line-height:1.7;">${escapeHtml(alert)}</div>`
              : ''
          }

          ${
            ctaLabel && ctaUrl
              ? `<div style="margin-top:24px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block; background:${accentColor}; color:#ffffff; text-decoration:none; padding:13px 20px; border-radius:12px; font-weight:700; font-size:14px;">${escapeHtml(ctaLabel)}</a>
                </div>`
              : ''
          }

          <div style="margin-top:24px; padding-top:18px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:12px; line-height:1.8;">
            ${escapeHtml(footer)}
          </div>
        </div>
      </div>
    </div>
  `;

  return { html, text };
}

async function sendCourierEmail({ to, subject, html, text }) {
  const apiKey = getCourierApiKey();
  if (!apiKey || !to) return false;

  const emailOverride = {
    subject,
    html,
    text,
    tracking: { open: true },
  };

  if (process.env.COURIER_FROM_EMAIL) {
    emailOverride.from = process.env.COURIER_FROM_EMAIL;
  }

  if (process.env.COURIER_REPLY_TO) {
    emailOverride.reply_to = process.env.COURIER_REPLY_TO;
  }

  try {
    await axios.post(
      'https://api.courier.com/send',
      {
        message: {
          to: { email: to },
          routing: { method: 'single', channels: ['email'] },
          content: { title: subject, body: text },
          channels: { email: { override: emailOverride } },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
    return true;
  } catch (error) {
    console.error('[Courier Email Error]', error.response?.data || error.message);
    return false;
  }
}

async function sendAdminListingSubmittedEmail({ listing, ownerName, ownerEmail }) {
  const subject = `PeezuHub admin review needed: ${listing.title}`;
  const { html, text } = buildEmailTemplate({
    badge: 'New listing submitted',
    title: 'A new listing needs moderation',
    intro:
      'A user just submitted a listing on PeezuHub. Review it in the admin dashboard and decide whether to approve or reject it.',
    rows: [
      { label: 'Listing title', value: listing.title },
      { label: 'Category', value: listing.category },
      { label: 'Location', value: `${listing.city}, ${listing.state}` },
      {
        label: 'Price',
        value: `₦${Number(listing.startingPrice || 0).toLocaleString('en-NG')}`,
      },
      { label: 'Seller', value: ownerName || 'Unknown user' },
      { label: 'Seller email', value: ownerEmail || 'Not provided' },
      { label: 'Moderation status', value: listing.status || 'pending' },
      { label: 'Submitted at', value: formatDateTime(listing.createdAt || new Date()) },
    ],
    alert:
      'Open the admin dashboard to verify the content, inspect the photos and take moderation action quickly.',
    ctaLabel: 'Open admin dashboard',
    ctaUrl: getClientUrl('/admin'),
  });
  return sendCourierEmail({ to: getAdminEmail(), subject, html, text });
}

async function sendAdminListingReportedEmail({
  listing,
  reporterName,
  reporterEmail,
  reason,
}) {
  const subject = `PeezuHub report alert: ${listing.title}`;
  const { html, text } = buildEmailTemplate({
    badge: 'Listing reported',
    title: 'A listing was reported by a user',
    intro:
      'A visitor flagged a listing for admin attention. Please inspect the listing details and decide whether additional moderation is required.',
    rows: [
      { label: 'Listing title', value: listing.title },
      { label: 'Category', value: listing.category || '—' },
      {
        label: 'Listing owner ID',
        value: listing.user?.toString?.() || listing.user || '—',
        mono: true,
      },
      { label: 'Reporter', value: reporterName },
      { label: 'Reporter email', value: reporterEmail || 'Not provided' },
      { label: 'Reason', value: reason },
      { label: 'Reported at', value: formatDateTime(new Date()) },
    ],
    alert:
      'Reports can indicate fraud, spam, duplicate content or unsafe buyer/seller behaviour. Review promptly.',
    ctaLabel: 'Review admin dashboard',
    ctaUrl: getClientUrl('/admin'),
    accentColor: '#dc2626',
  });
  return sendCourierEmail({ to: getAdminEmail(), subject, html, text });
}

async function sendAdminPremiumUpgradeEmail({ user, reference, expiresAt }) {
  const subject = `PeezuHub premium upgrade paid: ${user.name}`;
  const { html, text } = buildEmailTemplate({
    badge: 'Premium upgrade paid',
    title: 'A seller premium payment was completed',
    intro:
      'A user successfully completed a premium upgrade. Their current and future listings should now receive premium treatment until the expiry date.',
    rows: [
      { label: 'User name', value: user.name },
      { label: 'User email', value: user.email },
      { label: 'Plan', value: 'Seller premium (all current and future listings)' },
      { label: 'Reference', value: reference, mono: true },
      { label: 'Expires', value: formatDateTime(expiresAt) },
      { label: 'Paid at', value: formatDateTime(new Date()) },
    ],
    alert:
      'You can verify the account status in the admin dashboard and confirm that listing badges/top placement are active.',
    ctaLabel: 'Open admin dashboard',
    ctaUrl: getClientUrl('/admin'),
    accentColor: '#7c3aed',
  });
  return sendCourierEmail({ to: getAdminEmail(), subject, html, text });
}

module.exports = {
  sendCourierEmail,
  sendAdminListingSubmittedEmail,
  sendAdminListingReportedEmail,
  sendAdminPremiumUpgradeEmail,
};
