// FIX #1 – Payment route fixes:
//  • Env-var name normalised: reads PAYSTACK_SECRET_KEY first, then falls back
//    to PAYSTACK_SECRET (matches the Railway env var shown in your dashboard).
//  • Every async operation is wrapped in try/catch with next(err) so errors
//    are forwarded to the global handler instead of crashing silently.
//  • Added timeout on Paystack API calls to avoid hanging requests.

const express = require('express');
const axios = require('axios');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Accept either PAYSTACK_SECRET_KEY or PAYSTACK_SECRET (Railway naming)
const getPaystackSecret = () =>
  process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || null;

// ── POST /api/payments/paystack/initialize ────────────────────────────────────
router.post('/paystack/initialize', auth, async (req, res, next) => {
  try {
    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return res.status(400).json({ message: 'Paystack is not configured. Contact the admin.' });
    }

    const { listingId } = req.body;
    if (!listingId) {
      return res.status(400).json({ message: 'listingId is required.' });
    }

    const listing = await Listing.findOne({ _id: listingId, user: req.user._id });
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found or does not belong to you.' });
    }

    const reference = `PZH-${Date.now()}-${listing._id}`;
    const clientUrl = process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
    const callbackUrl = `${clientUrl}/payment/callback?reference=${reference}&listingId=${listing._id}`;

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user.email,
        amount: 500000, // ₦5,000 in kobo
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: {
          listingId: listing._id.toString(),
          plan: 'featured_listing',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    listing.premiumRequested = true;
    listing.premiumPaymentStatus = 'pending';
    listing.paystackReference = reference;
    await listing.save();

    res.json({
      authorizationUrl: response.data.data.authorization_url,
      reference,
    });
  } catch (err) {
    const msg =
      err.response?.data?.message ||
      err.message ||
      'Failed to initialise payment. Please try again.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

// ── GET /api/payments/paystack/verify/:reference ──────────────────────────────
router.get('/paystack/verify/:reference', async (req, res, next) => {
  try {
    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      return res.status(400).json({ message: 'Paystack is not configured. Contact the admin.' });
    }

    const { reference } = req.params;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${paystackSecret}` },
        timeout: 10000,
      },
    );

    const data = response.data.data;

    const listing = await Listing.findOne({ paystackReference: reference });
    if (!listing) {
      return res.status(404).json({ message: 'Payment reference not found for any listing.' });
    }

    if (data.status === 'success') {
      listing.premiumRequested = true;
      listing.premiumPaymentStatus = 'paid';
      listing.isFeatured = true;
      listing.isVerified = true;
      listing.featuredUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await listing.save();
    }

    res.json({ payment: data, listing });
  } catch (err) {
    const msg =
      err.response?.data?.message ||
      err.message ||
      'Failed to verify payment. Please try again.';
    next(Object.assign(new Error(msg), { status: err.response?.status || 500 }));
  }
});

module.exports = router;
