// FIX #1 – CORS: accept both the exact CLIENT_URL *and* any *.vercel.app
//           preview deployments so Google OAuth callbacks never hit a CORS wall.

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

// Build the allowed-origin list from CLIENT_URL (comma-separated in Railway).
// Also allow localhost:5173 for local dev.
const explicitOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  ...explicitOrigins,
]);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (e.g. server-to-server, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.has(origin)) return callback(null, true);

      // Allow any Vercel preview deployment for this project
      if (/^https:\/\/peezu-hub[\w-]*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS: origin '${origin}' is not allowed`));
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

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[PeezuHub Error]', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`PeezuHub API running on port ${PORT}`));
