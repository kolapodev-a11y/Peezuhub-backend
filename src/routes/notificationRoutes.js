const express = require('express');
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');

const router = express.Router();

function buildNotificationScope(user) {
  if (user?.role === 'admin') {
    return {
      $or: [
        { user: user._id },
        { user: null },
        { user: { $exists: false } },
      ],
    };
  }

  return { user: user._id };
}

router.get('/', auth, async (req, res) => {
  const scope = buildNotificationScope(req.user);
  const notifications = await Notification.find(scope).sort({ createdAt: -1 }).limit(100);
  const unreadCount = await Notification.countDocuments({ ...scope, isRead: false });
  res.json({ notifications, unreadCount });
});

router.patch('/read-all', auth, async (req, res) => {
  const scope = buildNotificationScope(req.user);
  await Notification.updateMany({ ...scope, isRead: false }, { $set: { isRead: true } });
  res.json({ ok: true });
});

router.patch('/:id/read', auth, async (req, res) => {
  const scope = buildNotificationScope(req.user);
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, ...scope },
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ message: 'Notification not found.' });
  }

  res.json(notification);
});

module.exports = router;
