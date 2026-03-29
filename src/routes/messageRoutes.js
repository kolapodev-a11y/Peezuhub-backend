const express = require('express');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const Notification = require('../models/Notification');
const { auth, optionalAuth } = require('../middleware/auth');
const { queueEmail } = require('../utils/sendEmail');

const router = express.Router();

router.post('/contact/:listingId', optionalAuth, async (req, res) => {
  const { senderName, senderEmail, senderPhone, message } = req.body;
  if (!senderName || !message) return res.status(400).json({ message: 'Name and message are required' });

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
    type: 'contact',
    title: 'New contact request',
    message: `${senderName} contacted ${listing.title}`,
    meta: { listingId: listing._id.toString(), messageId: record._id.toString() },
  });

  if (listing.contact?.email) {
    queueEmail({
      to: listing.contact.email,
      subject: `PeezuHub enquiry for ${listing.title}`,
      html: `<p><strong>${senderName}</strong> sent an enquiry on PeezuHub.</p><p>${message}</p><p>Email: ${senderEmail || '-'}<br/>Phone: ${senderPhone || '-'}</p>`,
      replyTo: senderEmail || undefined,
    });
  }

  res.status(201).json({ message: 'Your enquiry has been sent.' });
});

router.get('/inbox', auth, async (req, res) => {
  const messages = await Message.find({ toUser: req.user._id }).populate('listing').sort({ createdAt: -1 });
  res.json(messages);
});

module.exports = router;
