/**
 * authRoutes.js — PeezuHub
 *
 * ADDITION: Fire a `new_signup` notification whenever a user registers
 *   (email/password or Google OAuth) so the admin can see new signups
 *   in the categorised notification centre.
 *
 * ADDITION: GET /admin/users  — returns all users for the admin dashboard
 *   Users tab (sorted newest first, password hash excluded).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function signToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function adminRoleForEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'peezutech@gmail.com').toLowerCase();
  return email.toLowerCase() === adminEmail ? 'admin' : 'user';
}

/* ─── Register ───────────────────────────────────────────────────────────── */

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: 'Name, email and password are required' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(400).json({ message: 'Email already in use' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: adminRoleForEmail(email),
  });

  // Notify admin of new signup
  await Notification.create({
    type: 'new_signup',
    title: 'New user registered',
    message: `${user.name} (${user.email}) just created an account via email/password.`,
    meta: { userId: user._id.toString(), method: 'email' },
  }).catch(() => {}); // non-blocking — don't fail registration if this errors

  const token = signToken(user);
  res.status(201).json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  });
});

/* ─── Login ──────────────────────────────────────────────────────────────── */

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !user.passwordHash)
    return res.status(400).json({ message: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ message: 'Invalid credentials' });
  user.role = adminRoleForEmail(user.email);
  await user.save();
  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  });
});

/* ─── Google OAuth ───────────────────────────────────────────────────────── */

router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential)
    return res.status(400).json({ message: 'Google credential missing' });

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  const email = payload.email.toLowerCase();

  let user = await User.findOne({ email });
  const isNewUser = !user;

  if (!user) {
    user = await User.create({
      name: payload.name || email.split('@')[0],
      email,
      googleId: payload.sub,
      avatar: payload.picture || '',
      role: adminRoleForEmail(email),
    });
  } else {
    user.googleId = payload.sub;
    user.avatar = payload.picture || user.avatar;
    user.role = adminRoleForEmail(email);
    await user.save();
  }

  // Only notify on first Google sign-up (not subsequent logins)
  if (isNewUser) {
    await Notification.create({
      type: 'new_signup',
      title: 'New user registered',
      message: `${user.name} (${user.email}) just created an account via Google OAuth.`,
      meta: { userId: user._id.toString(), method: 'google' },
    }).catch(() => {});
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  });
});

/* ─── Me ─────────────────────────────────────────────────────────────────── */

router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

/* ─── Admin: All Users ───────────────────────────────────────────────────── */

router.get('/admin/users', auth, adminOnly, async (_req, res) => {
  const users = await User.find()
    .select('-passwordHash')
    .sort({ createdAt: -1 });
  res.json({ users });
});

module.exports = router;
