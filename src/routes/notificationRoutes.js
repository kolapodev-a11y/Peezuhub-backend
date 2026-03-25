const express = require('express');
const Notification = require('../models/Notification');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, adminOnly, async (_req, res) => {
  const notifications = await Notification.find().sort({ createdAt: -1 }).limit(30);
  const unreadCount = await Notification.countDocuments({ isRead: false });
  res.json({ notifications, unreadCount });
});

router.patch('/:id/read', auth, adminOnly, async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true });
  res.json(notification);
});

module.exports = router;
