const APP_NAME = process.env.APP_NAME?.trim() || 'PeezuHub';
const FALLBACK_SUPPORT_EMAIL = 'peezutech@gmail.com';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSupportEmail() {
  return (process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || FALLBACK_SUPPORT_EMAIL).trim();
}

function getClientUrl() {
  return process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
}

function getAdminDashboardUrl() {
  return process.env.ADMIN_DASHBOARD_URL?.trim() || `${getClientUrl().replace(/\/$/, '')}/admin`;
}

function getAdminNotificationRecipients() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || FALLBACK_SUPPORT_EMAIL;
  return raw
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function renderFieldRows(fields = []) {
  return fields
    .filter((field) => field?.label && field?.value !== undefined && field?.value !== null && field?.value !== '')
    .map(
      (field) => `
        <tr>
          <td style="padding:12px 0;color:#94a3b8;font-size:13px;vertical-align:top;width:150px;">${escapeHtml(field.label)}</td>
          <td style="padding:12px 0;color:#e2e8f0;font-size:14px;line-height:1.6;vertical-align:top;">${escapeHtml(field.value)}</td>
        </tr>
      `
    )
    .join('');
}

function buildAdminAlertEmail({
  title,
  intro,
  fields = [],
  actionLabel = 'Open admin dashboard',
  actionUrl = getAdminDashboardUrl(),
  bodyHtml = '',
  footerNote = '',
}) {
  const supportEmail = getSupportEmail();
  const safeTitle = escapeHtml(title || `${APP_NAME} admin alert`);
  const safeIntro = escapeHtml(intro || 'An admin action needs your attention.');
  const rows = renderFieldRows(fields);
  const safeFooterNote = footerNote ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">${escapeHtml(footerNote)}</p>` : '';
  const cta = actionUrl
    ? `
      <div style="margin-top:24px;">
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;font-size:14px;">${escapeHtml(actionLabel)}</a>
      </div>
    `
    : '';

  const html = `
    <div style="margin:0;padding:24px;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
      <div style="max-width:680px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:20px;overflow:hidden;box-shadow:0 20px 45px rgba(0,0,0,0.35);">
        <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#4f46e5,#7c3aed);">
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.18);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(APP_NAME)}</div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.2;color:#ffffff;">${safeTitle}</h1>
          <p style="margin:0;font-size:15px;line-height:1.7;color:#e9d5ff;">${safeIntro}</p>
        </div>

        <div style="padding:28px;">
          ${rows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#0b1120;border:1px solid #1f2937;border-radius:16px;padding:0 18px;"><tbody>${rows}</tbody></table>` : ''}
          ${bodyHtml ? `<div style="margin-top:${rows ? '24px' : '0'};color:#cbd5e1;font-size:14px;line-height:1.8;">${bodyHtml}</div>` : ''}
          ${cta}
          <p style="margin:26px 0 0;color:#94a3b8;font-size:12px;line-height:1.7;">This alert was sent by ${escapeHtml(APP_NAME)}. Support contact: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#c4b5fd;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>
          ${safeFooterNote}
        </div>
      </div>
    </div>
  `;

  return { html, text: stripHtml(html) };
}

module.exports = {
  APP_NAME,
  escapeHtml,
  stripHtml,
  getSupportEmail,
  getAdminDashboardUrl,
  getAdminNotificationRecipients,
  formatDateTime,
  buildAdminAlertEmail,
};
