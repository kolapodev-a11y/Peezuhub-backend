'use strict';
/**
 * PeezuHub – responsive email templates
 * ------------------------------------
 * Keeps the existing dark admin-alert look while hardening the markup for Gmail/mobile.
 */

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const APP_NAME = firstEnv('MAIL_APP_NAME', 'PEEZUHUB_APP_NAME', 'APP_NAME') || 'PeezuHub';
const CLIENT_URL =
  firstEnv('MAIL_CLIENT_URL', 'PEEZUHUB_CLIENT_URL') ||
  (process.env.CLIENT_URL || '').split(',')[0].trim() ||
  'https://peezu-hub-new.vercel.app';

const FALLBACK_SUPPORT_EMAIL = 'peezutech@gmail.com';
const PANEL_BG = '#11161F';
const PANEL_BORDER = '#2A3241';
const CARD_BG = '#161D27';
const BODY_TEXT = '#E5E7EB';
const MUTED_TEXT = '#AEB8C8';

function escHtml(str) {
  return String(str)
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

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Lagos',
  });
}

function getAdminNotificationRecipients() {
  const raw =
    firstEnv('ADMIN_EMAILS') ||
    firstEnv('MAIL_ADMIN_EMAILS') ||
    firstEnv('ADMIN_EMAIL') ||
    firstEnv('MAIL_ADMIN_EMAIL') ||
    FALLBACK_SUPPORT_EMAIL;

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

function getSupportEmail() {
  return (
    firstEnv('SUPPORT_EMAIL', 'MAIL_SUPPORT_EMAIL', 'ADMIN_EMAIL', 'MAIL_ADMIN_EMAIL') ||
    getAdminNotificationRecipients().split(',')[0] ||
    FALLBACK_SUPPORT_EMAIL
  );
}

function getProfileUrl() {
  return `${CLIENT_URL.replace(/\/$/, '')}/profile`;
}

function getAdminDashboardUrl() {
  return firstEnv('ADMIN_DASHBOARD_URL', 'MAIL_ADMIN_DASHBOARD_URL') || `${CLIENT_URL.replace(/\/$/, '')}/admin`;
}

function fieldsToText(fields = []) {
  return fields
    .filter((item) => item && item.label && item.value !== undefined && item.value !== null && item.value !== '')
    .map(({ label, value }) => `${label}: ${value}`)
    .join('\n');
}

function getAlertTheme(variant = 'listing_approval') {
  const themes = {
    listing_approval: {
      heroBg: '#2563EB',
      badgeBg: '#3B82F6',
      buttonBg: '#2563EB',
      buttonText: '#FFFFFF',
      accent: '#60A5FA',
      calloutBg: '#1C2533',
      calloutBorder: '#3B82F6',
      eyebrow: 'New listing submitted',
      buttonLabel: 'Open admin dashboard',
    },
    premium_upgrade: {
      heroBg: '#7C3AED',
      badgeBg: '#8B5CF6',
      buttonBg: '#7C3AED',
      buttonText: '#FFFFFF',
      accent: '#C4B5FD',
      calloutBg: '#1C2533',
      calloutBorder: '#A855F7',
      eyebrow: 'Premium upgrade paid',
      buttonLabel: 'Open admin dashboard',
    },
    listing_report: {
      heroBg: '#DC2626',
      badgeBg: '#EF4444',
      buttonBg: '#DC2626',
      buttonText: '#FFFFFF',
      accent: '#FCA5A5',
      calloutBg: '#1C2533',
      calloutBorder: '#EF4444',
      eyebrow: 'Listing reported',
      buttonLabel: 'Review admin dashboard',
    },
    default: {
      heroBg: '#2563EB',
      badgeBg: '#3B82F6',
      buttonBg: '#2563EB',
      buttonText: '#FFFFFF',
      accent: '#BFDBFE',
      calloutBg: '#1C2533',
      calloutBorder: '#3B82F6',
      eyebrow: 'Admin alert',
      buttonLabel: 'Open admin dashboard',
    },
  };

  return themes[variant] || themes.default;
}

function buildFieldRows(fields = []) {
  const filteredFields = fields.filter(
    (field) => field?.label && field?.value !== undefined && field?.value !== null && field?.value !== ''
  );

  return filteredFields
    .map(
      ({ label, value }, index) => `
        <tr>
          <td class="field-label" style="padding:12px 14px;width:34%;vertical-align:top;color:${MUTED_TEXT};font-size:14px;font-weight:600;border-bottom:${index === filteredFields.length - 1 ? '0' : `1px solid ${PANEL_BORDER}`};">
            ${escHtml(label)}
          </td>
          <td class="field-value" style="padding:12px 14px;vertical-align:top;color:#F8FAFC;font-size:15px;line-height:1.6;border-bottom:${index === filteredFields.length - 1 ? '0' : `1px solid ${PANEL_BORDER}`};">
            <span style="display:block;max-width:100%;word-break:break-word;overflow-wrap:anywhere;white-space:normal;hyphens:auto;">
              ${escHtml(String(value))}
            </span>
          </td>
        </tr>`
    )
    .join('');
}

function wrapLayout({ previewText, contentHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escHtml(APP_NAME)}</title>
    <style>
      body { margin:0; padding:0; background:#0A0F18; }
      table { border-spacing:0; border-collapse:collapse; }
      img { border:0; display:block; }
      a { text-decoration:none; }
      .outer { width:100%; background:#0A0F18; }
      .shell { width:100%; max-width:620px; }
      .fluid { width:100% !important; }
      .stack { display:block !important; width:100% !important; }
      .mobile-pad { padding-left:20px !important; padding-right:20px !important; }
      @media only screen and (max-width: 620px) {
        .shell { width:100% !important; }
        .mobile-pad { padding-left:18px !important; padding-right:18px !important; }
        .hero-title { font-size:28px !important; line-height:1.2 !important; }
        .body-copy { font-size:15px !important; }
        .field-label,
        .field-value { display:block !important; width:100% !important; }
        .button-full { display:block !important; width:100% !important; text-align:center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#0A0F18;">
    ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escHtml(previewText)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
    <table role="presentation" class="outer" width="100%" style="width:100%;background:#0A0F18;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          ${contentHtml}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildAdminAlertEmail({
  variant = 'listing_approval',
  eyebrow,
  title,
  intro,
  fields = [],
  actionLabel,
  actionUrl,
  footerNote,
  callout,
}) {
  const theme = getAlertTheme(variant);
  const adminUrl = actionUrl || getAdminDashboardUrl();
  const fieldRows = buildFieldRows(fields);
  const resolvedEyebrow = eyebrow || theme.eyebrow;
  const resolvedActionLabel = actionLabel || theme.buttonLabel;
  const supportEmail = getSupportEmail();

  const contentHtml = `
  <table role="presentation" class="shell" width="620" style="width:100%;max-width:620px;">
    <tr>
      <td style="background:${PANEL_BG};border:1px solid ${PANEL_BORDER};border-radius:24px;padding:0;overflow:hidden;box-shadow:0 24px 56px rgba(0,0,0,0.35);">
        <table role="presentation" width="100%" style="width:100%;">
          <tr>
            <td class="mobile-pad" style="padding:22px 26px;background:${theme.heroBg};">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#F8FAFC;">
                PEEZUHUB ADMIN ALERT
              </div>
              <div style="margin-top:12px;display:inline-block;background:${theme.badgeBg};border-radius:999px;padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:1.2;color:#FFFFFF;">
                ${escHtml(resolvedEyebrow)}
              </div>
              <div class="hero-title" style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.18;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;max-width:460px;">
                ${escHtml(title)}
              </div>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:28px 26px 30px;background:${PANEL_BG};font-family:Arial,Helvetica,sans-serif;color:${BODY_TEXT};">
              <div class="body-copy" style="font-size:15px;line-height:1.8;color:${BODY_TEXT};">
                ${escHtml(intro)}
              </div>

              ${fieldRows ? `
              <table role="presentation" width="100%" style="width:100%;margin-top:22px;background:${CARD_BG};border:1px solid ${PANEL_BORDER};border-radius:20px;overflow:hidden;">
                <tbody>${fieldRows}</tbody>
              </table>` : ''}

              ${callout ? `
              <table role="presentation" width="100%" style="width:100%;margin-top:20px;background:${theme.calloutBg};border:1px solid ${PANEL_BORDER};border-left:4px solid ${theme.calloutBorder};border-radius:16px;">
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#E2E8F0;word-break:break-word;overflow-wrap:anywhere;">
                    ${escHtml(callout)}
                  </td>
                </tr>
              </table>` : ''}

              ${resolvedActionLabel ? `
              <div style="margin-top:24px;">
                <a href="${escHtml(adminUrl)}" class="button-full" style="display:inline-block;background:${theme.buttonBg};color:${theme.buttonText};padding:14px 24px;border-radius:14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;line-height:1.2;">
                  ${escHtml(resolvedActionLabel)}
                </a>
              </div>` : ''}

              ${footerNote ? `
              <div style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.9;color:${MUTED_TEXT};word-break:break-word;overflow-wrap:anywhere;">
                ${escHtml(footerNote)}
              </div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;color:${MUTED_TEXT};text-align:center;word-break:break-word;overflow-wrap:anywhere;">
        Need help? <a href="mailto:${escHtml(supportEmail)}" style="color:${theme.accent};">${escHtml(supportEmail)}</a><br />
        &copy; ${new Date().getFullYear()} ${escHtml(APP_NAME)}. All rights reserved.
      </td>
    </tr>
  </table>`;

  const plainText = [
    `${APP_NAME} Admin Alert`,
    '='.repeat(40),
    title,
    '',
    intro,
    '',
    fieldsToText(fields),
    '',
    callout || '',
    '',
    resolvedActionLabel ? `${resolvedActionLabel}: ${adminUrl}` : '',
    footerNote || '',
  ]
    .join('\n')
    .trim();

  return {
    html: wrapLayout({ previewText: `${title} – ${intro}`, contentHtml }),
    text: plainText,
  };
}

function buildPremiumConfirmEmail({ userName, userEmail, reference, amountNaira, activatedAt, expiresAt }) {
  const expiryStr = formatDateTime(expiresAt);
  const activatedStr = formatDateTime(activatedAt);
  const dashboardUrl = getProfileUrl();
  const supportEmail = getSupportEmail();

  const contentHtml = `
  <table role="presentation" class="shell" width="620" style="width:100%;max-width:620px;">
    <tr>
      <td style="background:${PANEL_BG};border:1px solid ${PANEL_BORDER};border-radius:24px;padding:0;overflow:hidden;box-shadow:0 24px 56px rgba(0,0,0,0.35);">
        <table role="presentation" width="100%" style="width:100%;">
          <tr>
            <td class="mobile-pad" style="padding:26px;background:#7C3AED;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#F8FAFC;">
                PEEZUHUB PREMIUM
              </div>
              <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.18;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">
                Your Seller Premium is now active
              </div>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:28px 26px 30px;background:${PANEL_BG};font-family:Arial,Helvetica,sans-serif;color:${BODY_TEXT};">
              <div style="font-size:15px;line-height:1.8;color:${BODY_TEXT};">
                Hi <strong>${escHtml(userName)}</strong>, your payment was successful and your <strong>Seller Premium</strong> plan is now active.
                All your current listings are featured and verified, and future listings will automatically receive premium treatment until your plan expires.
              </div>

              <table role="presentation" width="100%" style="width:100%;margin-top:22px;background:${CARD_BG};border:1px solid ${PANEL_BORDER};border-radius:20px;overflow:hidden;">
                <tbody>
                  ${buildFieldRows([
                    { label: 'Reference', value: reference },
                    { label: 'Account email', value: userEmail },
                    { label: 'Amount paid', value: `₦${Number(amountNaira).toLocaleString('en-NG')}` },
                    { label: 'Plan', value: 'Seller Premium – All listings' },
                    { label: 'Activated', value: activatedStr },
                    { label: 'Expires', value: expiryStr },
                  ])}
                </tbody>
              </table>

              <table role="presentation" width="100%" style="width:100%;margin-top:20px;background:#1C2533;border:1px solid ${PANEL_BORDER};border-left:4px solid #A855F7;border-radius:16px;">
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#E2E8F0;word-break:break-word;overflow-wrap:anywhere;">
                    Premium benefits are now active on your account: featured badge, verified seller mark, stronger listing visibility and priority placement.
                  </td>
                </tr>
              </table>

              <div style="margin-top:24px;">
                <a href="${escHtml(dashboardUrl)}" class="button-full" style="display:inline-block;background:#7C3AED;color:#FFFFFF;padding:14px 24px;border-radius:14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;line-height:1.2;">
                  Go to My Dashboard
                </a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;color:${MUTED_TEXT};text-align:center;word-break:break-word;overflow-wrap:anywhere;">
        Need help? <a href="mailto:${escHtml(supportEmail)}" style="color:#C4B5FD;">${escHtml(supportEmail)}</a><br />
        &copy; ${new Date().getFullYear()} ${escHtml(APP_NAME)}. All rights reserved.
      </td>
    </tr>
  </table>`;

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
    `Visit your dashboard: ${dashboardUrl}`,
    '',
    `Need help? Email: ${supportEmail}`,
  ].join('\n');

  return {
    html: wrapLayout({ previewText: `Your ${APP_NAME} Seller Premium is now active!`, contentHtml }),
    text: plainText,
  };
}

module.exports = {
  APP_NAME,
  CLIENT_URL,
  formatDateTime,
  getAdminNotificationRecipients,
  getSupportEmail,
  getAdminDashboardUrl,
  buildAdminAlertEmail,
  buildPremiumConfirmEmail,
  stripHtml,
};
