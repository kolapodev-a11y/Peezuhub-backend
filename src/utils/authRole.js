const DEFAULT_ADMIN_EMAIL = 'peezutech@gmail.com';

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;

  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function adminRoleForEmail(email = '') {
  return getAdminEmails().includes(String(email).trim().toLowerCase()) ? 'admin' : 'user';
}

async function syncUserRoleFromAdminEmails(user) {
  if (!user) return null;

  const nextRole = adminRoleForEmail(user.email);
  if (user.role !== nextRole) {
    user.role = nextRole;
    await user.save();
  }

  return user;
}

module.exports = {
  getAdminEmails,
  adminRoleForEmail,
  syncUserRoleFromAdminEmails,
};
