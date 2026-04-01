const express = require('express');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const Notification = require('../models/Notification');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasValidPhone(phone = '') {
  return clean(phone).replace(/\D/g, '').length >= 10;
}

router.post('/contact/:listingId', optionalAuth, async (req, res) => {
  const senderName = clean(req.body.senderName);
  const senderEmail = clean(req.body.senderEmail).toLowerCase();
  const senderPhone = clean(req.body.senderPhone);
  const message = clean(req.body.message);

  if (!senderName || !senderPhone || !message) {
    return res.status(400).json({ message: 'Name, phone number and message are required.' });
  }

  if (!hasValidPhone(senderPhone)) {
    return res.status(400).json({ message: 'Please enter a valid phone number.' });
  }

  const listing = await Listing.findById(req.params.listingId).populate('user');
  if (!listing) return res.status(404).json({ message: 'Listing not found' });

  if (req.user && listing.user?._id?.toString() === req.user._id.toString()) {
    return res.status(400).json({ message: 'You cannot contact yourself about your own listing.' });
  }

  const record = await Message.create({
    listing: listing._id,
    toUser: listing.user._id,
    fromUser: req.user?._id,
    senderName,
    senderEmail,
    senderPhone,
    message,
  });

  await Notification.create({
    user: listing.user._id,
    type: 'contact',
    title: 'New contact request',
    message: `${senderName} contacted you about ${listing.title}`,
    meta: {
      listingId: listing._id.toString(),
      messageId: record._id.toString(),
      fromUserId: req.user?._id?.toString() || '',
      senderName,
      actionUrl: '/profile',
    },
  });

  res.status(201).json({ message: 'Your enquiry has been sent.' });
});

router.get('/inbox', auth, async (req, res) => {
  const messages = await Message.find({ toUser: req.user._id })
    .populate('listing', 'title photos')
    .populate('fromUser', 'name email avatar role createdAt')
    .sort({ createdAt: -1 });

  res.json(messages);
});

module.exports = router;
