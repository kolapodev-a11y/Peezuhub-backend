'use strict';

const axios = require('axios');
const Listing = require('../models/Listing');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { queueEmail } = require('./sendEmail');
const {
  APP_NAME,
  buildAdminAlertEmail,
  buildPremiumConfirmEmail,
  formatDateTime,
  getAdminNotificationRecipients,
} = require('./emailTemplates');

const PREMIUM_PRICE_KOBO = 500_000;
const PREMIUM_PRICE_NAIRA = 5_000;
const PREMIUM_DURATION_DAYS = 30;

const TERMINAL_PAYMENT_STATUSES = new Set(['abandoned', 'failed', 'reversed', 'cancelled', 'canceled']);
const PENDING_PAYMENT_STATUSES = new Set(['pending', 'ongoing', 'processing', 'queued']);

function getPaystackSecret() {
  return process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || null;
}

function getClientUrl() {
  return (process.env.CLIENT_URL || '').split(',')[0].trim() || 'http://localhost:5173';
}

function hasActivePremium(user) {
  return Boolean(
    user?.premiumStatus === 'active' &&
      user?.premiumExpiresAt &&
      new Date(user.premiumExpiresAt) > new Date()
  );
}

function normalizePaymentStatus(status = '') {
  return String(status || '').trim().toLowerCase();
}

function classifyPaymentStatus(status = '') {
  const normalized = normalizePaymentStatus(status);
  if (normalized === 'success') return 'success';
  if (TERMINAL_PAYMENT_STATUSES.has(normalized)) return 'terminal';
  if (PENDING_PAYMENT_STATUSES.has(normalized)) return 'pending';
  return 'other';
}

async function syncAllUserListingsPremium(userId, premiumExpiresAt, reference) {
  const expiry = new Date(premiumExpiresAt);

  await Listing.updateMany(
    { user: userId },
    {
      $set: {
        premiumRequested: true,
        premiumPaymentStatus: 'paid',
        paystackReference: reference,
        featuredUntil: expiry,
      },
    }
  );

  await Listing.updateMany(
    { user: userId, saleStatus: 'available', status: 'approved' },
    { $set: { isFeatured: true, isVerified: true } }
  );

  await Listing.updateMany(
    { user: userId, $or: [{ saleStatus: 'sold' }, { status: { $ne: 'approved' } }] },
    { $set: { isFeatured: false, isVerified: false } }
  );
}

async function claimPremiumEmailDispatch(userId, reference) {
  const result = await User.updateOne(
    {
      _id: userId,
      $or: [
        { processedPremiumReference: { $exists: false } },
        { processedPremiumReference: null },
        { processedPremiumReference: '' },
        { processedPremiumReference: { $ne: reference } },
      ],
    },
    {
      $set: {
        processedPremiumReference: reference,
        premiumReceiptSentAt: new Date(),
      },
    }
  );

  return result.modifiedCount > 0;
}

async function upsertNotification({ notificationKey, user = null, type, title, message, meta = {} }) {
  if (!notificationKey) {
    return Notification.create({ user, type, title, message, meta });
  }

  return Notification.findOneAndUpdate(
    { notificationKey },
    {
      $setOnInsert: {
        user,
        type,
        title,
        message,
        meta,
        notificationKey,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function createPremiumPendingNotifications(user, reference) {
  await Promise.all([
    upsertNotification({
      notificationKey: `premium_upgrade_pending:${reference}:admin`,
      type: 'premium_upgrade_pending',
      title: 'Premium upgrade initiated',
      message: `${user.name} started a seller premium upgrade payment.`,
      meta: {
        userId: user._id.toString(),
        reference,
        actionUrl: '/admin?tab=notifications',
      },
    }),
    upsertNotification({
      notificationKey: `premium_upgrade_pending:${reference}:user:${user._id.toString()}`,
      user: user._id,
      type: 'premium_user_pending',
      title: 'Premium upgrade started',
      message: 'Your seller premium payment has started. We will activate it immediately after Paystack confirms the payment.',
      meta: {
        reference,
        actionUrl: '/profile?tab=notifications',
      },
    }),
  ]);
}

async function verifyPaystackReference(reference, paystackSecret) {
  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${paystackSecret}` },
    timeout: 10_000,
  });

  return response.data.data;
}

async function clearPendingPremium(user) {
  user.premiumPlan = 'none';
  user.premiumStatus = 'inactive';
  user.premiumReference = '';
  user.premiumActivatedAt = null;
  user.premiumExpiresAt = null;
  user.premiumAmount = 0;
  await user.save();
  return user;
}

async function activatePremiumAccount(user, reference) {
  const alreadyActivated = Boolean(
    user.premiumStatus === 'active' &&
      user.premiumReference === reference &&
      user.premiumExpiresAt &&
      new Date(user.premiumExpiresAt) > new Date()
  );

  const activatedAt =
    alreadyActivated && user.premiumActivatedAt
      ? new Date(user.premiumActivatedAt)
      : new Date();

  const expiresAt =
    alreadyActivated && user.premiumExpiresAt
      ? new Date(user.premiumExpiresAt)
      : new Date(Date.now() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1_000);

  user.premiumPlan = 'seller_premium';
  user.premiumStatus = 'active';
  user.premiumReference = reference;
  user.premiumActivatedAt = activatedAt;
  user.premiumExpiresAt = expiresAt;
  user.premiumAmount = PREMIUM_PRICE_NAIRA;
  await user.save();

  await syncAllUserListingsPremium(user._id, expiresAt, reference);

  return { alreadyActivated, activatedAt, expiresAt, user };
}

async function dispatchPremiumActivationSideEffects({ user, reference, activatedAt, expiresAt }) {
  const shouldDispatchEmails = await claimPremiumEmailDispatch(user._id, reference);
  if (!shouldDispatchEmails) return false;

  const adminEmail = buildAdminAlertEmail({
    title: 'Premium upgrade payment received',
    intro: `${user.name} completed a seller premium payment on ${APP_NAME}.`,
    fields: [
      { label: 'Member', value: user.name },
      { label: 'Email', value: user.email },
      { label: 'Reference', value: reference },
      { label: 'Amount', value: `₦${PREMIUM_PRICE_NAIRA.toLocaleString('en-NG')}` },
      { label: 'Plan', value: 'Seller premium (all current & future listings)' },
      { label: 'Activated', value: formatDateTime(activatedAt) },
      { label: 'Expires', value: formatDateTime(expiresAt) },
    ],
    actionLabel: 'Open admin dashboard',
    footerNote: `This alert is sent only once per successful ${APP_NAME} premium payment reference.`,
  });

  queueEmail({
    to: getAdminNotificationRecipients(),
    subject: `[${APP_NAME}] Premium upgrade paid – ${user.name}`,
    html: adminEmail.html,
    text: adminEmail.text,
  });

  const buyerEmail = buildPremiumConfirmEmail({
    userName: user.name,
    userEmail: user.email,
    reference,
    amountNaira: PREMIUM_PRICE_NAIRA,
    activatedAt,
    expiresAt,
  });

  queueEmail({
    to: user.email,
    subject: `✅ Your ${APP_NAME} Seller Premium is now active!`,
    html: buyerEmail.html,
    text: buyerEmail.text,
  });

  await Promise.all([
    upsertNotification({
      notificationKey: `premium_upgrade_paid:${reference}:admin`,
      type: 'premium_upgrade_paid',
      title: 'Seller premium activated',
      message: `${user.name} completed a premium upgrade. Listings will be featured until ${expiresAt.toLocaleDateString('en-NG')}.`,
      meta: {
        userId: user._id.toString(),
        reference,
        expiresAt: expiresAt.toISOString(),
        actionUrl: '/admin?tab=notifications',
      },
    }),
    upsertNotification({
      notificationKey: `premium_upgrade_paid:${reference}:user:${user._id.toString()}`,
      user: user._id,
      type: 'premium_active',
      title: 'Seller premium is active',
      message: `Your seller premium upgrade is now active until ${expiresAt.toLocaleDateString('en-NG')}.`,
      meta: {
        reference,
        expiresAt: expiresAt.toISOString(),
        actionUrl: '/profile?tab=notifications',
      },
    }),
  ]);

  return true;
}

async function reconcilePendingPremium(user, paystackSecret) {
  if (!user?.premiumReference || user?.premiumStatus !== 'pending') {
    return { state: 'no_pending', user, payment: null };
  }

  try {
    const payment = await verifyPaystackReference(user.premiumReference, paystackSecret);
    const paymentState = classifyPaymentStatus(payment?.status);

    if (paymentState === 'success') {
      const activation = await activatePremiumAccount(user, user.premiumReference);
      await dispatchPremiumActivationSideEffects({
        user,
        reference: user.premiumReference,
        activatedAt: activation.activatedAt,
        expiresAt: activation.expiresAt,
      });
      return { state: 'active', user, payment, ...activation };
    }

    if (paymentState === 'terminal') {
      await clearPendingPremium(user);
      return { state: 'cleared', user, payment };
    }

    return { state: 'pending', user, payment };
  } catch (error) {
    const statusCode = error.response?.status || 0;
    if (statusCode === 404 || statusCode === 400) {
      await clearPendingPremium(user);
      return { state: 'cleared', user, payment: null, reason: 'reference_not_found' };
    }

    return { state: 'error', user, payment: null, error };
  }
}

module.exports = {
  PREMIUM_PRICE_KOBO,
  PREMIUM_PRICE_NAIRA,
  PREMIUM_DURATION_DAYS,
  classifyPaymentStatus,
  createPremiumPendingNotifications,
  dispatchPremiumActivationSideEffects,
  getClientUrl,
  getPaystackSecret,
  hasActivePremium,
  reconcilePendingPremium,
  syncAllUserListingsPremium,
  upsertNotification,
  verifyPaystackReference,
  activatePremiumAccount,
  clearPendingPremium,
};
