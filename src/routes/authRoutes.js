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

async function resolveGoogleProfile({ credential, accessToken }) {
  if (accessToken) {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!data?.email || !data?.sub) {
      throw new Error('Unable to verify Google account');
    }

    if (data.email_verified === false) {
      throw new Error('Google email is not verified');
    }

    return {
      email: data.email.toLowerCase(),
      name: data.name || data.email.split('@')[0],
      googleId: data.sub,
      avatar: data.picture || '',
    };
  }

  if (credential && googleClient) {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload?.sub) {
      throw new Error('Unable to verify Google account');
    }

    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email.split('@')[0],
      googleId: payload.sub,
      avatar: payload.picture || '',
    };
  }

  throw new Error('Google credential missing');
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
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

  const token = signToken(user);
  res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !user.passwordHash) return res.status(400).json({ message: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ message: 'Invalid credentials' });
  user.role = adminRoleForEmail(user.email);
  await user.save();
  const token = signToken(user);
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
});

router.post('/google', async (req, res) => {
  try {
    const { credential, accessToken, mode = 'login' } = req.body;
    const authMode = mode === 'register' ? 'register' : 'login';
    const profile = await resolveGoogleProfile({ credential, accessToken });

    let user = await User.findOne({ email: profile.email });

    if (!user && authMode === 'login') {
      return res.status(404).json({
        message: 'No account exists for this Google email yet. Please sign up first.',
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
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (error) {
    return res.status(401).json({
      message: error.response?.data?.error_description || error.message || 'Google authentication failed',
    });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
