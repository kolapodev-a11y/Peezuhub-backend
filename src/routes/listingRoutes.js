const express = require('express');
const multer = require('multer');
const Listing = require('../models/Listing');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const { auth, adminOnly } = require('../middleware/auth');
const { detectScamText } = require('../utils/scamCheck');
const { NIGERIAN_STATES, CATEGORIES, SAFETY_DISCLAIMER } = require('../utils/constants');
const { sendEmail } = require('../utils/sendEmail');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

function sanitizeWhatsapp(value = '') {
  return value.replace(/[^\d]/g, '');
}

function updateRatingStats(listing) {
  const total = listing.reviews.reduce((sum, review) => sum + review.rating, 0);
  listing.reviewsCount = listing.reviews.length;
  listing.averageRating = listing.reviews.length ? Number((total / listing.reviews.length).toFixed(1)) : 0;
}

router.get('/meta/options', async (_req, res) => {
  const approved = await Listing.find({ status: 'approved' }).select('category state');
  const categoryCounts = CATEGORIES.map((name) => ({
    name,
    count: approved.filter((item) => item.category === name).length,
  }));
  const stateCounts = NIGERIAN_STATES.filter((state) => state !== 'All States').map((name) => ({
    name,
    count: approved.filter((item) => item.state === name).length,
  }));
  res.json({ categories: categoryCounts, states: stateCounts, disclaimer: SAFETY_DISCLAIMER });
});

router.get('/featured', async (_req, res) => {
  const featured = await Listing.find({ status: 'approved', isFeatured: true })
    .sort({ createdAt: -1 })
    .limit(12)
    .populate('user', 'name avatar');
  res.json(featured);
});

router.get('/mine', auth, async (req, res) => {
  const listings = await Listing.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(listings);
});

router.get('/admin/dashboard', auth, adminOnly, async (_req, res) => {
  const pendingListings = await Listing.find({ status: 'pending' }).populate('user', 'name email').sort({ createdAt: -1 });
  const reports = await Report.find({ status: 'open' }).populate('listing').sort({ createdAt: -1 });
  const unreadNotifications = await Notification.countDocuments({ isRead: false });
  const pendingCount = await Listing.countDocuments({ status: 'pending' });
  const inboxCount = await Message.countDocuments();
  res.json({ pendingListings, reports, unreadNotifications, pendingCount, inboxCount });
});

router.get('/', async (req, res) => {
  const {
    search = '',
    state,
    category,
    sort = 'newest',
    status = 'approved',
  } = req.query;

  const query = {};
  if (status) query.status = status;
  if (state && state !== 'All States') query.state = state;
  if (category && category !== 'All Categories') query.category = category;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { city: { $regex: search, $options: 'i' } },
    ];
  }

  let sortQuery = { createdAt: -1 };
  if (sort === 'highest_rated') sortQuery = { averageRating: -1, createdAt: -1 };
  if (sort === 'lowest_price') sortQuery = { startingPrice: 1, createdAt: -1 };

  const listings = await Listing.find(query).populate('user', 'name avatar').sort(sortQuery);
  res.json(listings);
});

router.get('/:id', async (req, res) => {
  const listing = await Listing.findById(req.params.id).populate('user', 'name email avatar');
  if (!listing) return res.status(404).json({ message: 'Listing not found' });
  res.json(listing);
});

router.post('/', auth, upload.array('photos', 4), async (req, res) => {
  const {
    title,
    category,
    description,
    state,
    city,
    locationLabel,
    startingPrice,
    priceLabel,
    whatsapp,
    email,
    phone,
    premiumRequested,
    safetyAccepted,
  } = req.body;

  if (!title || !category || !description || !state || !city || !startingPrice || !priceLabel || !whatsapp) {
    return res.status(400).json({ message: 'All required fields must be filled' });
  }
  if (String(safetyAccepted) !== 'true') {
    return res.status(400).json({ message: 'Safety responsibility confirmation is required' });
  }

  const photos = (req.files || []).map((file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
  if (!photos.length) return res.status(400).json({ message: 'At least one photo is required' });

  const scamHit = detectScamText(`${title} ${description}`);
  const status = scamHit ? 'rejected' : 'pending';
  const rejectionReason = scamHit ? `Auto-rejected for suspicious keyword: ${scamHit}` : '';

  const listing = await Listing.create({
    user: req.user._id,
    title,
    category,
    description,
    state,
    city,
    locationLabel,
    startingPrice: Number(startingPrice),
    priceLabel,
    photos,
    contact: {
      whatsapp: sanitizeWhatsapp(whatsapp),
      email: email || '',
      phone: phone || '',
    },
    premiumRequested: premiumRequested === 'true',
    status,
    rejectionReason,
  });

  await Notification.create({
    type: 'submission',
    title: 'New listing submitted',
    message: `${title} was submitted in ${city}, ${state}`,
    meta: { listingId: listing._id.toString(), status },
  });

  await sendEmail({
    to: process.env.ADMIN_EMAIL || 'peezutech@gmail.com',
    subject: `PeezuHub listing submitted: ${title}`,
    html: `<p>A new listing was submitted.</p><p><strong>${title}</strong><br/>${city}, ${state}<br/>Status: ${status}</p>`,
  });

  res.status(201).json({ listing, paymentNeeded: listing.premiumRequested });
});

router.patch('/:id/status', auth, adminOnly, async (req, res) => {
  const { action, reason } = req.body;
  const listing = await Listing.findById(req.params.id).populate('user');
  if (!listing) return res.status(404).json({ message: 'Listing not found' });

  if (action === 'approve') {
    listing.status = 'approved';
    listing.rejectionReason = '';
  } else if (action === 'reject') {
    if (!reason) return res.status(400).json({ message: 'Rejection reason is required' });
    listing.status = 'rejected';
    listing.rejectionReason = reason;
  } else {
    return res.status(400).json({ message: 'Invalid action' });
  }

  await listing.save();

  await Notification.create({
    type: 'moderation',
    title: `Listing ${action}d`,
    message: `${listing.title} has been ${action}d`,
    meta: { listingId: listing._id.toString(), action },
  });

  if (listing.user?.email) {
    await sendEmail({
      to: listing.user.email,
      subject: `Your PeezuHub listing was ${action}d`,
      html: `<p>Your listing <strong>${listing.title}</strong> was ${action}d.</p><p>${reason || 'Your listing is now live on PeezuHub.'}</p>`,
    });
  }

  res.json(listing);
});

router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || !comment) return res.status(400).json({ message: 'Rating and comment are required' });
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ message: 'Listing not found' });

  const existing = listing.reviews.find((review) => review.user?.toString() === req.user._id.toString());
  if (existing) return res.status(400).json({ message: 'You already reviewed this listing' });

  listing.reviews.push({
    user: req.user._id,
    name: req.user.name,
    rating: Number(rating),
    comment,
  });
  updateRatingStats(listing);
  await listing.save();

  res.status(201).json(listing);
});

router.post('/:id/report', async (req, res) => {
  const { reporterName, reporterEmail, reason } = req.body;
  if (!reporterName || !reason) return res.status(400).json({ message: 'Reporter name and reason are required' });
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ message: 'Listing not found' });

  const report = await Report.create({
    listing: listing._id,
    reporterName,
    reporterEmail,
    reason,
  });

  await Notification.create({
    type: 'report',
    title: 'Listing reported',
    message: `${listing.title} was reported by ${reporterName}`,
    meta: { listingId: listing._id.toString(), reportId: report._id.toString() },
  });

  await sendEmail({
    to: process.env.ADMIN_EMAIL || 'peezutech@gmail.com',
    subject: `PeezuHub report: ${listing.title}`,
    html: `<p><strong>${reporterName}</strong> reported listing <strong>${listing.title}</strong>.</p><p>${reason}</p>`,
  });

  res.status(201).json({ message: 'Report sent to admin successfully' });
});

module.exports = router;
