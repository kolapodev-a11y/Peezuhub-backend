const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

function signToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function adminRoleForEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'peezutech@gmail.com').toLowerCase();
  return email.toLowerCase() === adminEmail ? 'admin' : 'user';
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

async function resolveGoogleProfile({ credential, accessToken }) {
  if (accessToken) {
    let data;
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
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

  if (credential && googleClient) {
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new Error('Google ID token verification failed. Please try again.');
    }

    if (!payload?.email || !payload?.sub) {
      throw new Error('Unable to verify your Google account.');
    }

    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email.split('@')[0],
      googleId: payload.sub,
      avatar: payload.picture || '',
    };
  }

  throw new Error('No Google credentials were provided. Please try the Google button again.');
}

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(400).json({ message: 'That email address is already in use.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role: adminRoleForEmail(normalizedEmail),
    });

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

    const normalizedEmail = email.toLowerCase();
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
    const { credential, accessToken, mode = 'login' } = req.body;
    const authMode = mode === 'register' ? 'register' : 'login';
    const profile = await resolveGoogleProfile({ credential, accessToken });

    let user = await User.findOne({ email: profile.email });

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
    } else {
      user.name = user.name || profile.name;
      user.googleId = profile.googleId;
      user.avatar = profile.avatar || user.avatar;
      user.role = adminRoleForEmail(profile.email);
      await user.save();
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

module.exports = router;
