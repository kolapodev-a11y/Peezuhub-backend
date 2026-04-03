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
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const {
  PREMIUM_PRICE_KOBO,
  PREMIUM_PRICE_NAIRA,
  activatePremiumAccount,
  classifyPaymentStatus,
  createPremiumPendingNotifications,
  dispatchPremiumActivationSideEffects,
  getClientUrl,
  getPaystackSecret,
  hasActivePremium,
  reconcilePendingPremium,
  verifyPaystackReference,
  clearPendingPremium,
} = require('../utils/premiumPayments');

const router = express.Router();

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

    if (user.premiumStatus === 'pending' && user.premiumReference) {
      const reconciliation = await reconcilePendingPremium(user, paystackSecret);

      if (reconciliation.state === 'active') {
        return res.status(400).json({
          message:
            'Your previous premium payment has already been confirmed. Your seller premium is active now.',
        });
      }

      if (reconciliation.state === 'pending') {
        return res.status(409).json({
          message:
            'You already have a premium payment awaiting Paystack confirmation. Please complete it, or wait a moment and refresh your profile.',
        });
      }

      if (reconciliation.state === 'error') {
        const status = reconciliation.error?.response?.status;
        const message =
          status && status >= 400 && status < 500
            ? 'Unable to confirm the previous payment reference. Please contact support if this continues.'
            : 'We could not confirm your previous premium payment status right now. Please try again in a few moments.';

        return res.status(502).json({ message });
      }
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
          sourceApp: 'PeezuHub',
          sourceAppSlug: 'peezuhub',
          transactionKind: 'seller_premium_upgrade',
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
    user.premiumActivatedAt = null;
    user.premiumExpiresAt = null;
    user.premiumAmount = PREMIUM_PRICE_NAIRA;
    await user.save();

    await createPremiumPendingNotifications(user, reference);

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
    const payment = await verifyPaystackReference(reference, paystackSecret);
    const paymentState = classifyPaymentStatus(payment?.status);
    const user = await User.findOne({ _id: req.user._id, premiumReference: reference });

    if (!user) {
      return res.status(404).json({ message: 'Payment reference not found for your account.' });
    }

    if (paymentState === 'success') {
      const activation = await activatePremiumAccount(user, reference);
      await dispatchPremiumActivationSideEffects({
        user,
        reference,
        activatedAt: activation.activatedAt,
        expiresAt: activation.expiresAt,
      });
    } else if (paymentState === 'terminal') {
      await clearPendingPremium(user);
    }

    const listings = await Listing.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ payment, user, listings });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to verify payment.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

module.exports = router;
