'use strict';
/**
 * PeezuHub – One-time test-data cleanup script
 * =============================================
 * Deletes ALL test data created during your testing workflow:
 *   ✔ All contact messages / message requests
 *   ✔ All listings (+ orphaned reports & notifications for deleted listings)
 *   ✔ All reports
 *   ✔ All notifications (admin + user)
 *   ✔ Premium upgrade data on all non-admin users
 *   ✔ Non-admin test user accounts   ← optional (see KEEP_ADMIN_USERS below)
 *
 * HOW TO RUN (from the backend root directory):
 *   node scripts/clearTestData.js
 *
 * OPTIONS (set as env vars before running):
 *   DELETE_USERS=true   – also delete all non-admin user accounts (default: false)
 *   DRY_RUN=true        – preview what would be deleted without touching the DB
 *
 * Examples:
 *   node scripts/clearTestData.js
 *   DELETE_USERS=true node scripts/clearTestData.js
 *   DRY_RUN=true node scripts/clearTestData.js
 *
 * ⚠  This is irreversible. Back up your database first if in doubt.
 *    MongoDB Atlas: Clusters → … → Load Sample Dataset / point-in-time restore
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ─── Config ──────────────────────────────────────────────────────────────────

const DELETE_USERS = String(process.env.DELETE_USERS || '').toLowerCase() === 'true';
const DRY_RUN     = String(process.env.DRY_RUN      || '').toLowerCase() === 'true';

if (DRY_RUN) {
  console.log('\n⚠  DRY RUN – nothing will actually be deleted.\n');
}

// ─── Inline minimal schemas (so this script is self-contained) ───────────────

const listingSchema = new mongoose.Schema({}, { strict: false });
const messageSchema = new mongoose.Schema({}, { strict: false });
const notifSchema   = new mongoose.Schema({}, { strict: false });
const reportSchema  = new mongoose.Schema({}, { strict: false });
const userSchema    = new mongoose.Schema({
  email: String,
  role:  { type: String, default: 'user' },
  premiumPlan:            { type: String },
  premiumStatus:          { type: String },
  premiumReference:       { type: String },
  premiumActivatedAt:     { type: Date },
  premiumExpiresAt:       { type: Date },
  premiumAmount:          { type: Number },
  processedPremiumReference: { type: String },
  premiumReceiptSentAt:   { type: Date },
}, { strict: false });

const Listing      = mongoose.model('Listing',      listingSchema);
const Message      = mongoose.model('Message',      messageSchema);
const Notification = mongoose.model('Notification', notifSchema);
const Report       = mongoose.model('Report',       reportSchema);
const User         = mongoose.model('User',         userSchema);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function count(Model, filter = {}) {
  return Model.countDocuments(filter);
}

async function doDelete(Model, filter = {}, label = '') {
  const n = await count(Model, filter);
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete ${n} ${label}`);
    return n;
  }
  if (n === 0) {
    console.log(`  ✓ No ${label} to delete`);
    return 0;
  }
  const result = await Model.deleteMany(filter);
  console.log(`  ✓ Deleted ${result.deletedCount} ${label}`);
  return result.deletedCount;
}

async function doUpdate(Model, filter = {}, update = {}, label = '') {
  const n = await count(Model, filter);
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would update ${n} ${label}`);
    return n;
  }
  if (n === 0) {
    console.log(`  ✓ No ${label} to update`);
    return 0;
  }
  const result = await Model.updateMany(filter, update);
  console.log(`  ✓ Updated ${result.modifiedCount} ${label}`);
  return result.modifiedCount;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI is not set in your .env file. Aborting.');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('✅  Connected.\n');

  // ── 1. Contact messages ──────────────────────────────────────────────────
  console.log('📨  Contact messages / message requests:');
  await doDelete(Message, {}, 'contact messages');

  // ── 2. Listings ───────────────────────────────────────────────────────────
  console.log('\n📋  Listings:');
  await doDelete(Listing, {}, 'listings');

  // ── 3. Reports ────────────────────────────────────────────────────────────
  console.log('\n🚩  Reports:');
  await doDelete(Report, {}, 'listing reports');

  // ── 4. Notifications ──────────────────────────────────────────────────────
  console.log('\n🔔  Notifications (all types – admin + user):');
  await doDelete(Notification, {}, 'notifications');

  // ── 5. Premium data on all users ─────────────────────────────────────────
  console.log('\n💳  Premium upgrade data (reset all users to free plan):');
  await doUpdate(
    User,
    {}, // all users
    {
      $set: {
        premiumPlan:               'none',
        premiumStatus:             'inactive',
        premiumReference:          '',
        premiumActivatedAt:        null,
        premiumExpiresAt:          null,
        premiumAmount:             0,
        processedPremiumReference: '',
        premiumReceiptSentAt:      null,
      },
    },
    'user premium records'
  );

  // ── 6. Optionally delete test user accounts ───────────────────────────────
  if (DELETE_USERS) {
    console.log('\n👤  Non-admin user accounts (DELETE_USERS=true):');
    await doDelete(User, { role: { $ne: 'admin' } }, 'non-admin user accounts');
  } else {
    console.log('\n👤  User accounts: skipped (set DELETE_USERS=true to also remove them)');
  }

  console.log('\n✅  Cleanup complete!\n');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Cleanup failed:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
