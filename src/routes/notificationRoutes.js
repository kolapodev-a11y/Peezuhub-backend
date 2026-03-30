/**
 * notificationRoutes.js — PeezuHub
 *
 * IMPROVEMENTS:
 *  • GET /          — supports ?type= filter and higher limit (100)
 *  • PATCH /read-all — marks every unread notification as read in one call
 *  • PATCH /:id/read — unchanged (mark single notification read)
 *
 * Supported ?type values (maps to Notification.type field):
 *   report | submission | moderation | premium_upgrade_paid |
 *   premium_upgrade_pending | new_signup
 *   (omit / pass "all" to get everything)
 */

const express = require('express');
const Notification = require('../models/Notification');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

/* ─── GET all (with optional type filter) ───────────────────────────────── */

router.get('/', auth, adminOnly, async (req, res) => {
  const { type } = req.query;

  const query = type && type !== 'all' ? { type } : {};

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(100),
    Notification.countDocuments({ isRead: false }),
  ]);

  res.json({ notifications, unreadCount });
});

/* ─── PATCH mark-all-read ────────────────────────────────────────────────── */

router.patch('/read-all', auth, adminOnly, async (_req, res) => {
  await Notification.updateMany({ isRead: false }, { $set: { isRead: true } });
  res.json({ message: 'All notifications marked as read.' });
});

/* ─── PATCH single read ─────────────────────────────────────────────────── */

router.patch('/:id/read', auth, adminOnly, async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { $set: { isRead: true } },
    { new: true },
  );
  if (!notification) return res.status(404).json({ message: 'Notification not found' });
  res.json(notification);
});

module.exports = router;
