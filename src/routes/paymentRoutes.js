const express = require('express');
const axios = require('axios');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/paystack/initialize', auth, async (req, res) => {
  const { listingId } = req.body;
  const listing = await Listing.findOne({ _id: listingId, user: req.user._id });
  if (!listing) return res.status(404).json({ message: 'Listing not found' });
  if (!process.env.PAYSTACK_SECRET_KEY) return res.status(400).json({ message: 'Paystack is not configured' });

  const reference = `PZH-${Date.now()}-${listing._id}`;
  const callbackUrl = `${process.env.CLIENT_URL}/payment/callback?reference=${reference}&listingId=${listing._id}`;

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
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  listing.premiumRequested = true;
  listing.premiumPaymentStatus = 'pending';
  listing.paystackReference = reference;
  await listing.save();

  res.json({ authorizationUrl: response.data.data.authorization_url, reference });
});

router.get('/paystack/verify/:reference', async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY) return res.status(400).json({ message: 'Paystack is not configured' });
  const { reference } = req.params;
  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });

  const data = response.data.data;
  const listing = await Listing.findOne({ paystackReference: reference });
  if (!listing) return res.status(404).json({ message: 'Listing payment reference not found' });

  if (data.status === 'success') {
    listing.premiumRequested = true;
    listing.premiumPaymentStatus = 'paid';
    listing.isFeatured = true;
    listing.isVerified = true;
    listing.featuredUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await listing.save();
  }

  res.json({ payment: data, listing });
});

module.exports = router;
