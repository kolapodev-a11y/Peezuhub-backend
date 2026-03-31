'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const listingRoutes = require('./src/routes/listingRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const messageRoutes = require('./src/routes/messageRoutes');

const app = express();
connectDB();

function parseEnvOrigins(raw = '') {
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const explicitOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  ...parseEnvOrigins(process.env.CLIENT_URL),
  ...parseEnvOrigins(process.env.ADMIN_DASHBOARD_URL),
]);

const dynamicOriginMatchers = [
  /^https:\/\/peezu-hub[\w-]*\.vercel\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)?peezuhub\.name\.ng$/i,
  /^https:\/\/([a-z0-9-]+\.)?peezuhub\.name\.ng$/i,
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (explicitOrigins.has(origin)) {
        return callback(null, true);
      }

      const allowedByPattern = dynamicOriginMatchers.some((matcher) => matcher.test(origin));
      if (allowedByPattern) {
        return callback(null, true);
      }

      return callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'PeezuHub API', now: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/messages', messageRoutes);

app.use((err, _req, res, _next) => {
  console.error('[PeezuHub Error]', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`PeezuHub API running on port ${PORT}`));
