const express = require('express');
const axios = require('axios');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

const router = express.Router();

const getPaystackSecret = () =>
  process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || null;

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

    if (listing.saleStatus === 'sold') {
      return res.status(400).json({ message: 'Sold listings cannot be upgraded. Mark it as available first.' });
    }

    if (listing.isFeatured && listing.featuredUntil && listing.featuredUntil > new Date()) {
      return res.status(400).json({ message: 'This listing already has an active premium upgrade.' });
    }

    const reference = `PZH-${Date.now()}-${listing._id}`;
    const clientUrl = process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
    const callbackUrl = `${clientUrl}/payment/callback?reference=${reference}&listingId=${listing._id}`;

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user.email,
        amount: 500000,
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

router.get('/paystack/verify/:reference', auth, async (req, res, next) => {
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

    const listing = await Listing.findOne({ paystackReference: reference, user: req.user._id });
    if (!listing) {
      return res.status(404).json({ message: 'Payment reference not found for your listing.' });
    }

    if (data.status === 'success') {
      listing.premiumRequested = true;
      listing.premiumPaymentStatus = 'paid';
      listing.isFeatured = listing.saleStatus !== 'sold';
      listing.isVerified = listing.saleStatus !== 'sold';
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
