'use strict';

const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();
const APP_NAME = process.env.APP_NAME || 'PeezuHub';
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function signToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'peezutech@gmail.com';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function adminRoleForEmail(email = '') {
  return getAdminEmails().includes(String(email).toLowerCase()) ? 'admin' : 'user';
}

function serializeUser(user) {
  return {
    _id: user._id.toString(),
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    premiumPlan: user.premiumPlan,
    premiumStatus: user.premiumStatus,
    premiumReference: user.premiumReference,
    premiumActivatedAt: user.premiumActivatedAt,
    premiumExpiresAt: user.premiumExpiresAt,
    premiumAmount: user.premiumAmount,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLikelyJwt(token = '') {
  return typeof token === 'string' && token.split('.').length === 3;
}

function normalizeGooglePayload(body = {}) {
  const root = isPlainObject(body) ? body : {};
  const nestedCredential = isPlainObject(root.credential) ? root.credential : {};
  const tokenResponse = isPlainObject(root.tokenResponse) ? root.tokenResponse : {};
  const google = isPlainObject(root.google) ? root.google : {};

  const credential = firstNonEmptyString(
    root.credential,
    root.idToken,
    root.id_token,
    nestedCredential.credential,
    nestedCredential.idToken,
    nestedCredential.id_token,
    tokenResponse.credential,
    tokenResponse.idToken,
    tokenResponse.id_token,
    google.credential,
    google.idToken,
    google.id_token,
  );

  const accessToken = firstNonEmptyString(
    root.accessToken,
    root.access_token,
    root.token,
    nestedCredential.accessToken,
    nestedCredential.access_token,
    tokenResponse.accessToken,
    tokenResponse.access_token,
    tokenResponse.token,
    google.accessToken,
    google.access_token,
    google.token,
  );

  const modeCandidate = firstNonEmptyString(root.mode, nestedCredential.mode, tokenResponse.mode, google.mode);
  const mode = modeCandidate === 'register' ? 'register' : 'login';

  return { credential, accessToken, mode };
}

async function createSignupNotification(user, method) {
  try {
    await Notification.create({
      type: 'new_signup',
      title: 'New user signup',
      message: `${user.name} created a new ${APP_NAME} account via ${method}.`,
      meta: {
        userId: user._id.toString(),
        email: user.email,
        method,
      },
    });
  } catch (error) {
    console.error('[PeezuHub] Failed to create signup notification:', error.message);
  }
}

async function resolveGoogleProfile({ credential, accessToken }) {
  const safeAccessToken = cleanString(accessToken);
  const safeCredential = cleanString(credential);

  if (safeAccessToken) {
    let data;
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${safeAccessToken}` },
        timeout: 8000,
      });
      data = response.data;
    } catch (err) {
      const hint =
        err.response?.data?.error === 'invalid_token'
          ? 'Your Google session has expired. Please try signing in again.'
          : 'Could not verify your Google account. Check your internet connection and try again.';
      throw new Error(hint);
    }

    if (!data?.email || !data?.sub) {
      throw new Error('Google returned an incomplete profile. Please try again.');
    }
    if (data.email_verified === false) {
      throw new Error('Your Google email address is not verified.');
    }

    return {
      email: data.email.toLowerCase(),
      name: data.name || data.email.split('@')[0],
      googleId: data.sub,
      avatar: data.picture || '',
    };
  }

  if (safeCredential) {
    if (!isLikelyJwt(safeCredential)) {
      throw new Error('Google credential format is invalid. Please sign in again.');
    }

    if (!googleClient || !GOOGLE_CLIENT_ID) {
      throw new Error('Google sign-in is not configured on the server. Set GOOGLE_CLIENT_ID in Render.');
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: safeCredential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (error) {
      throw new Error('Google ID token verification failed. Please try again.');
    }

    if (!payload?.email || !payload?.sub) {
      throw new Error('Unable to verify your Google account.');
    }
    if (payload.email_verified === false) {
      throw new Error('Your Google email address is not verified.');
    }

    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email.split('@')[0],
      googleId: payload.sub,
      avatar: payload.picture || '',
    };
  }

  throw new Error('No valid Google credentials were provided. Please try the Google button again.');
}

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(400).json({ message: 'That email address is already in use.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role: adminRoleForEmail(normalizedEmail),
    });

    await createSignupNotification(user, 'email/password');

    const token = signToken(user);
    res.status(201).json({ token, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ message: 'Invalid email or password.' });

    user.role = adminRoleForEmail(user.email);
    await user.save();

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/google', async (req, res) => {
  try {
    const { credential, accessToken, mode = 'login' } = normalizeGooglePayload(req.body);
    const authMode = mode === 'register' ? 'register' : 'login';
    const profile = await resolveGoogleProfile({ credential, accessToken });

    let user = await User.findOne({ email: profile.email });
    let created = false;

    if (!user && authMode === 'login') {
      return res.status(404).json({
        message: 'No PeezuHub account found for this Google email. Please register first.',
      });
    }

    if (!user) {
      user = await User.create({
        name: profile.name,
        email: profile.email,
        googleId: profile.googleId,
        avatar: profile.avatar,
        role: adminRoleForEmail(profile.email),
      });
      created = true;
    } else {
      user.name = user.name || profile.name;
      user.googleId = profile.googleId;
      user.avatar = profile.avatar || user.avatar;
      user.role = adminRoleForEmail(profile.email);
      await user.save();
    }

    if (created) {
      await createSignupNotification(user, 'google');
    }

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || 'Google authentication failed.' });
  }
});

router.get('/me', auth, async (req, res) => {
  const freshUser = await User.findById(req.user._id).select('-passwordHash');
  res.json({ user: serializeUser(freshUser) });
});

router.get('/admin/users', auth, adminOnly, async (_req, res) => {
  const users = await User.find()
    .select('-passwordHash')
    .sort({ createdAt: -1 });

  const totalUsers = users.length;
  const premiumUsers = users.filter((user) => user.premiumStatus === 'active').length;
  const recentSignups = users.filter((user) => {
    const age = Date.now() - new Date(user.createdAt).getTime();
    return age <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  res.json({
    users: users.map(serializeUser),
    totalUsers,
    premiumUsers,
    recentSignups,
  });
});

module.exports = router;
