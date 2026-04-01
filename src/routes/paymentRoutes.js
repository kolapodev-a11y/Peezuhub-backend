'use strict';
/**
 * PeezuHub – Payment Routes
 * -------------------------
 * POST /api/payments/paystack/initialize   – create a Paystack transaction
 * GET  /api/payments/paystack/verify/:ref  – verify & activate premium
 */

const express = require('express');
const axios = require('axios');
const Listing = require('../models/Listing');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { queueEmail } = require('../utils/sendEmail');
const {
  APP_NAME,
  buildAdminAlertEmail,
  buildPremiumConfirmEmail,
  formatDateTime,
  getAdminNotificationRecipients,
} = require('../utils/emailTemplates');

const router = express.Router();

const PREMIUM_PRICE_KOBO = 500_000;
const PREMIUM_PRICE_NAIRA = 5_000;
const PREMIUM_DURATION_DAYS = 30;

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

router.post('/paystack/initialize', auth, async (req, res, next) => {
  try {
    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return res.status(400).json({ message: 'Paystack is not configured. Contact the admin.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User account not found.' });

    if (hasActivePremium(user)) {
      return res.status(400).json({
        message:
          'Your seller premium is already active. All current and future listings are already eligible for premium visibility.',
      });
    }

    const reference = `PZH-PREM-${Date.now()}-${user._id}`;
    const callbackUrl = `${getClientUrl()}/payment/callback?reference=${reference}`;

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: user.email,
        amount: PREMIUM_PRICE_KOBO,
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: {
          userId: user._id.toString(),
          plan: 'seller_premium',
          appliesTo: 'all_current_and_future_listings',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );

    user.premiumPlan = 'seller_premium';
    user.premiumStatus = 'pending';
    user.premiumReference = reference;
    user.premiumAmount = PREMIUM_PRICE_NAIRA;
    await user.save();

    await Promise.all([
      Notification.create({
        type: 'premium_upgrade_pending',
        title: 'Premium upgrade initiated',
        message: `${user.name} started a seller premium upgrade payment.`,
        meta: { userId: user._id.toString(), reference, path: '/admin?tab=notifications&filter=premium' },
      }),
      Notification.create({
        user: user._id,
        type: 'premium_user_pending',
        title: 'Premium upgrade started',
        message: 'Your seller premium payment has started. We will activate it immediately after Paystack confirms the payment.',
        meta: { reference, path: '/profile?tab=notifications' },
      }),
    ]);

    res.json({ authorizationUrl: response.data.data.authorization_url, reference });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to initialise payment.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

router.get('/paystack/verify/:reference', auth, async (req, res, next) => {
  try {
    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return res.status(400).json({ message: 'Paystack is not configured. Contact the admin.' });
    }

    const { reference } = req.params;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
      timeout: 10_000,
    });

    const payment = response.data.data;
    const user = await User.findOne({ _id: req.user._id, premiumReference: reference });

    if (!user) {
      return res.status(404).json({ message: 'Payment reference not found for your account.' });
    }

    if (payment.status === 'success') {
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
      user.premiumActivatedAt = activatedAt;
      user.premiumExpiresAt = expiresAt;
      user.premiumAmount = PREMIUM_PRICE_NAIRA;
      await user.save();

      await syncAllUserListingsPremium(user._id, expiresAt, reference);

      const shouldDispatchEmails = await claimPremiumEmailDispatch(user._id, reference);

      if (shouldDispatchEmails) {
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
          Notification.create({
            type: 'premium_upgrade_paid',
            title: 'Seller premium activated',
            message: `${user.name} completed a premium upgrade. Listings will be featured until ${expiresAt.toLocaleDateString('en-NG')}.`,
            meta: {
              userId: user._id.toString(),
              reference,
              expiresAt: expiresAt.toISOString(),
              path: '/admin?tab=notifications&filter=premium',
            },
          }),
          Notification.create({
            user: user._id,
            type: 'premium_user_active',
            title: 'Seller premium is active',
            message: `Your seller premium is active until ${expiresAt.toLocaleDateString('en-NG')}. Current and future listings can now receive premium treatment.`,
            meta: {
              reference,
              expiresAt: expiresAt.toISOString(),
              path: '/profile?tab=notifications',
            },
          }),
        ]);
      }
    }

    const listings = await Listing.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ payment, user, listings });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to verify payment.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

module.exports = router;
