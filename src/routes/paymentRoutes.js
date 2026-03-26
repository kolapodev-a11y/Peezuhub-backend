const express = require('express');
const axios = require('axios');
const Listing = require('../models/Listing');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { sendEmail } = require('../utils/sendEmail');

const router = express.Router();

const PREMIUM_PRICE_KOBO = 500000;
const PREMIUM_PRICE_NAIRA = 5000;
const PREMIUM_DURATION_DAYS = 30;

const getPaystackSecret = () => process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || null;

function getClientUrl() {
  return process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
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
    { user: userId, saleStatus: 'available' },
    {
      $set: {
        isFeatured: true,
        isVerified: true,
      },
    }
  );

  await Listing.updateMany(
    { user: userId, saleStatus: 'sold' },
    {
      $set: {
        isFeatured: false,
        isVerified: false,
      },
    }
  );
}

router.post('/paystack/initialize', auth, async (req, res, next) => {
  try {
    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return res.status(400).json({ message: 'Paystack is not configured. Contact the admin.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User account not found.' });
    }

    if (hasActivePremium(user)) {
      return res.status(400).json({
        message: 'Your seller premium is already active. All current and future listings are already eligible for premium visibility.',
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
        timeout: 10000,
      }
    );

    user.premiumPlan = 'seller_premium';
    user.premiumStatus = 'pending';
    user.premiumReference = reference;
    user.premiumAmount = PREMIUM_PRICE_NAIRA;
    await user.save();

    await Notification.create({
      type: 'premium_upgrade_pending',
      title: 'Premium upgrade initiated',
      message: `${user.name} started a seller premium upgrade payment.`,
      meta: { userId: user._id.toString(), reference },
    });

    res.json({
      authorizationUrl: response.data.data.authorization_url,
      reference,
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to initialise payment. Please try again.';
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
      timeout: 10000,
    });

    const payment = response.data.data;
    const user = await User.findOne({ _id: req.user._id, premiumReference: reference });

    if (!user) {
      return res.status(404).json({ message: 'Payment reference not found for your account.' });
    }

    if (payment.status === 'success') {
      const activatedAt = new Date();
      const expiresAt = new Date(Date.now() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000);

      user.premiumPlan = 'seller_premium';
      user.premiumStatus = 'active';
      user.premiumActivatedAt = activatedAt;
      user.premiumExpiresAt = expiresAt;
      user.premiumAmount = PREMIUM_PRICE_NAIRA;
      await user.save();

      await syncAllUserListingsPremium(user._id, expiresAt, reference);

      await Notification.create({
        type: 'premium_upgrade_paid',
        title: 'Seller premium activated',
        message: `${user.name} completed a premium upgrade. All current and future listings should receive premium treatment until ${expiresAt.toLocaleDateString()}.`,
        meta: { userId: user._id.toString(), reference, expiresAt: expiresAt.toISOString() },
      });

      await sendEmail({
        to: process.env.ADMIN_EMAIL || 'peezutech@gmail.com',
        subject: `PeezuHub premium upgrade paid: ${user.name}`,
        html: `<p><strong>${user.name}</strong> successfully paid for seller premium.</p><p>Email: ${user.email}</p><p>Coverage: all current and future listings</p><p>Expires: ${expiresAt.toLocaleString()}</p>`,
      });
    }

    const listings = await Listing.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ payment, user, listings });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to verify payment. Please try again.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

module.exports = router;
