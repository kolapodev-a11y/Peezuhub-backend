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

function toMinuteStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setSeconds(0, 0);
  return date.toISOString();
}

function buildLegacyDedupKey(item) {
  return [
    item?.user ? String(item.user) : 'broadcast',
    item?.type || '',
    item?.title || '',
    item?.message || '',
    item?.meta?.reference || '',
    item?.meta?.expiresAt || '',
    item?.meta?.listingId || '',
    item?.meta?.actionUrl || item?.meta?.path || '',
    toMinuteStamp(item?.createdAt),
  ].join('|');
}

function dedupeNotifications(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.notificationKey || buildLegacyDedupKey(item);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.get('/', auth, async (req, res) => {
  const scope = buildNotificationScope(req.user);
  const notifications = await Notification.find(scope).sort({ createdAt: -1 }).limit(200);
  const uniqueNotifications = dedupeNotifications(notifications).slice(0, 100);
  const unreadCount = uniqueNotifications.filter((item) => !item.isRead).length;
  res.json({ notifications: uniqueNotifications, unreadCount });
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
