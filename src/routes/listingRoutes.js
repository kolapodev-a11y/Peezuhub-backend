const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const Listing = require('../models/Listing');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth, optionalAuth, adminOnly } = require('../middleware/auth');
const { detectScamText } = require('../utils/scamCheck');
const { NIGERIAN_STATES, CATEGORIES, SAFETY_DISCLAIMER } = require('../utils/constants');
const { queueEmail } = require('../utils/sendEmail');
const {
  APP_NAME,
  buildAdminAlertEmail,
  formatDateTime,
  getAdminNotificationRecipients,
} = require('../utils/emailTemplates');

const router = express.Router();
const MAX_PHOTOS = 4;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const LIST_CARD_SELECT =
  'title category description state city locationLabel startingPrice priceLabel photos status saleStatus isFeatured isVerified averageRating reviewsCount user createdAt';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: MAX_PHOTOS },
  fileFilter(_req, file, callback) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      callback(new Error('Only image files can be uploaded.'));
      return;
    }

    callback(null, true);
  },
});

function sanitizeWhatsapp(value = '') {
  return value.replace(/[^\d]/g, '');
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function optimisePhotoFiles(files = []) {
  return Promise.all(
    files.map(async (file) => {
      const processedBuffer = await sharp(file.buffer, { failOnError: false })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();

      return `data:image/webp;base64,${processedBuffer.toString('base64')}`;
    })
  );
}

function updateRatingStats(listing) {
  const total = listing.reviews.reduce((sum, review) => sum + review.rating, 0);
  listing.reviewsCount = listing.reviews.length;
  listing.averageRating = listing.reviews.length ? Number((total / listing.reviews.length).toFixed(1)) : 0;
}

function isValidCategory(category) {
  return CATEGORIES.includes(category);
}

function parsePhotosField(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue.filter(Boolean);

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getPublicSort(sort = 'newest') {
  if (sort === 'highest_rated') {
    return { isFeatured: -1, featuredUntil: -1, averageRating: -1, createdAt: -1 };
  }

  if (sort === 'lowest_price') {
    return { isFeatured: -1, featuredUntil: -1, startingPrice: 1, createdAt: -1 };
  }

  return { isFeatured: -1, featuredUntil: -1, createdAt: -1 };
}

function hasActiveSellerPremium(user) {
  return Boolean(
    user?.premiumStatus === 'active' &&
      user?.premiumExpiresAt &&
      new Date(user.premiumExpiresAt) > new Date()
  );
}

function syncListingPremiumState(listing, user) {
  const hasPremium = hasActiveSellerPremium(user);

  if (!hasPremium) {
    listing.isFeatured = false;
    listing.isVerified = false;

    if (!listing.featuredUntil || new Date(listing.featuredUntil) <= new Date()) {
      listing.featuredUntil = null;
      listing.premiumPaymentStatus = 'unpaid';
      listing.premiumRequested = false;
      listing.paystackReference = '';
    }

    return;
  }

  listing.premiumRequested = true;
  listing.premiumPaymentStatus = 'paid';
  listing.paystackReference = user.premiumReference || listing.paystackReference;
  listing.featuredUntil = new Date(user.premiumExpiresAt);

  const shouldSurfacePremium = listing.saleStatus === 'available' && listing.status === 'approved';
  listing.isFeatured = shouldSurfacePremium;
  listing.isVerified = shouldSurfacePremium;
}

function applySaleStatusEffects(listing, saleStatus, user) {
  listing.saleStatus = saleStatus;
  listing.soldAt = saleStatus === 'sold' ? new Date() : null;
  syncListingPremiumState(listing, user);
}

async function cleanupDeletedListing(listingId) {
  await Promise.all([
    Message.deleteMany({ listing: listingId }),
    Report.deleteMany({ listing: listingId }),
    Notification.deleteMany({ 'meta.listingId': String(listingId) }),
  ]);
}

function buildAdminNotificationScope(adminUserId) {
  return {
    $or: [{ user: adminUserId }, { user: null }, { user: { $exists: false } }],
  };
}

function shapeListingCard(listing) {
  return {
    ...listing,
    photos: Array.isArray(listing.photos) ? listing.photos.slice(0, MAX_PHOTOS) : [],
  };
}

router.get('/meta/options', async (_req, res, next) => {
  try {
    const [categoryCountsRaw, stateCountsRaw] = await Promise.all([
      Listing.aggregate([
        { $match: { status: 'approved', saleStatus: 'available' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
      Listing.aggregate([
        { $match: { status: 'approved', saleStatus: 'available' } },
        { $group: { _id: '$state', count: { $sum: 1 } } },
      ]),
    ]);

    const categoryCountMap = new Map(categoryCountsRaw.map((item) => [item._id, item.count]));
    const stateCountMap = new Map(stateCountsRaw.map((item) => [item._id, item.count]));

    const categoryCounts = CATEGORIES.map((name) => ({
      name,
      count: categoryCountMap.get(name) || 0,
    }));

    const stateCounts = NIGERIAN_STATES.filter((state) => state !== 'All States').map((name) => ({
      name,
      count: stateCountMap.get(name) || 0,
    }));

    res.json({ categories: categoryCounts, states: stateCounts, disclaimer: SAFETY_DISCLAIMER });
  } catch (error) {
    next(error);
  }
});

router.get('/featured', async (_req, res, next) => {
  try {
    const featured = await Listing.find({
      status: 'approved',
      saleStatus: 'available',
      isFeatured: true,
      premiumPaymentStatus: 'paid',
      featuredUntil: { $gt: new Date() },
    })
      .select(LIST_CARD_SELECT)
      .sort({ featuredUntil: -1, createdAt: -1 })
      .limit(12)
      .populate('user', 'name avatar role')
      .lean();

    res.json(featured.map(shapeListingCard));
  } catch (error) {
    next(error);
  }
});

router.get('/mine', auth, async (req, res) => {
  const listings = await Listing.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(listings);
});

router.get('/admin/dashboard', auth, adminOnly, async (_req, res) => {
  const [
    pendingListings,
    reports,
    unreadNotifications,
    pendingCount,
    inboxCount,
    totalListings,
    approvedListings,
    rejectedListings,
    soldListings,
    premiumUsers,
    totalUsers,
    allListings,
  ] = await Promise.all([
    Listing.find({ status: 'pending' }).populate('user', 'name email avatar role').sort({ createdAt: -1 }),
    Report.find({ status: 'open' })
      .populate({ path: 'listing', populate: { path: 'user', select: 'name email role' } })
      .sort({ createdAt: -1 }),
    Notification.countDocuments({ ...buildAdminNotificationScope(_req.user._id), isRead: false }),
    Listing.countDocuments({ status: 'pending' }),
    Message.countDocuments(),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'approved' }),
    Listing.countDocuments({ status: 'rejected' }),
    Listing.countDocuments({ saleStatus: 'sold' }),
    User.countDocuments({ premiumStatus: 'active' }),
    User.countDocuments(),
    Listing.find().populate('user', 'name email avatar role').sort({ createdAt: -1 }).limit(100),
  ]);

  res.json({
    pendingListings,
    reports,
    unreadNotifications,
    pendingCount,
    inboxCount,
    totalListings,
    approvedListings,
    rejectedListings,
    soldListings,
    premiumUsers,
    totalUsers,
    allListings,
  });
});

router.get('/', async (req, res, next) => {
  try {
    const {
      search = '',
      state,
      category,
      sort = 'newest',
      status = 'approved',
      saleStatus = 'available',
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (saleStatus && saleStatus !== 'All') query.saleStatus = saleStatus;
    if (state && state !== 'All States') query.state = state;
    if (category && category !== 'All Categories') query.category = category;

    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
      const safeSearch = new RegExp(escapeRegex(normalizedSearch), 'i');
      query.$or = [
        { title: safeSearch },
        { description: safeSearch },
        { city: safeSearch },
      ];
    }

    const listings = await Listing.find(query)
      .select(LIST_CARD_SELECT)
      .populate('user', 'name avatar role')
      .sort(getPublicSort(sort))
      .lean();

    res.json(listings.map(shapeListingCard));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res) => {
  const listing = await Listing.findById(req.params.id).populate(
    'user',
    'name email avatar role premiumStatus premiumExpiresAt'
  );
  if (!listing) return res.status(404).json({ message: 'Listing not found' });
  res.json(listing);
});

router.post('/', auth, upload.array('photos', MAX_PHOTOS), async (req, res, next) => {
  try {
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
      safetyAccepted,
    } = req.body;

    if (
      !title ||
      !category ||
      !description ||
      !state ||
      !city ||
      startingPrice === undefined ||
      startingPrice === '' ||
      !priceLabel ||
      !whatsapp
    ) {
      return res.status(400).json({ message: 'All required fields must be filled' });
    }

    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'Please choose a valid category.' });
    }

    if (String(safetyAccepted) !== 'true') {
      return res.status(400).json({ message: 'Safety responsibility confirmation is required' });
    }

    if ((req.files || []).length > MAX_PHOTOS) {
      return res.status(400).json({ message: `You can upload a maximum of ${MAX_PHOTOS} photos.` });
    }

    const photos = await optimisePhotoFiles(req.files || []);
    if (!photos.length) return res.status(400).json({ message: 'At least one photo is required' });

    const scamHit = detectScamText(`${title} ${description}`);
    const moderationStatus = scamHit ? 'rejected' : 'pending';
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
      status: moderationStatus,
      rejectionReason,
      saleStatus: 'available',
    });

    syncListingPremiumState(listing, req.user);
    await listing.save();

    await Notification.create({
      type: 'submission',
      title: 'New listing submitted',
      message: `${title} was submitted in ${city}, ${state}`,
      meta: {
        listingId: listing._id.toString(),
        status: moderationStatus,
        path: '/admin?tab=pending',
      },
    });

    const newListingEmail = buildAdminAlertEmail({
      variant: 'listing_approval',
      eyebrow: 'New listing submitted',
      title: 'A new listing needs moderation',
      intro: `A user just submitted a listing on ${APP_NAME}. Review it in the admin dashboard and decide whether to approve or reject it.`,
      fields: [
        { label: 'Listing title', value: title },
        { label: 'Category', value: category },
        { label: 'Location', value: `${city}, ${state}` },
        { label: 'Price', value: `₦${Number(startingPrice).toLocaleString('en-NG')}` },
        { label: 'Seller', value: req.user.name },
        { label: 'Seller email', value: req.user.email },
        { label: 'Moderation status', value: moderationStatus },
        { label: 'Submitted at', value: formatDateTime(listing.createdAt) },
      ],
      actionLabel: 'Open admin dashboard',
      callout: 'Open the admin dashboard to verify the content, inspect the photos and take moderation action quickly.',
      footerNote: 'You are receiving this because you are the PeezuHub admin contact for operational notifications.',
    });

    queueEmail({
      to: getAdminNotificationRecipients(),
      subject: `${APP_NAME} listing submitted: ${title}`,
      html: newListingEmail.html,
      text: newListingEmail.text,
    });

    res.status(201).json({ listing, paymentNeeded: false });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', auth, upload.array('photos', MAX_PHOTOS), async (req, res, next) => {
  try {
    const listing = await Listing.findOne({ _id: req.params.id, user: req.user._id });
    if (!listing) return res.status(404).json({ message: 'Listing not found or does not belong to you.' });

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
      keepPhotos,
      safetyAccepted,
    } = req.body;

    const preservedPhotos = parsePhotosField(keepPhotos);
    const uploadedPhotos = await optimisePhotoFiles(req.files || []);

    if (
      !title ||
      !category ||
      !description ||
      !state ||
      !city ||
      startingPrice === undefined ||
      startingPrice === '' ||
      !priceLabel ||
      !whatsapp
    ) {
      return res.status(400).json({ message: 'All required fields must be filled' });
    }

    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'Please choose a valid category.' });
    }

    if (String(safetyAccepted) !== 'true') {
      return res.status(400).json({ message: 'Safety responsibility confirmation is required' });
    }

    if (preservedPhotos.length + uploadedPhotos.length > MAX_PHOTOS) {
      return res.status(400).json({ message: `You can keep or upload only ${MAX_PHOTOS} photos in total.` });
    }

    const nextPhotos = [...preservedPhotos, ...uploadedPhotos];

    if (!nextPhotos.length) {
      return res.status(400).json({ message: 'Keep at least one photo or upload a new one.' });
    }

    const scamHit = detectScamText(`${title} ${description}`);
    const moderationStatus = scamHit ? 'rejected' : 'pending';
    const rejectionReason = scamHit ? `Auto-rejected for suspicious keyword: ${scamHit}` : '';

    listing.title = title;
    listing.category = category;
    listing.description = description;
    listing.state = state;
    listing.city = city;
    listing.locationLabel = locationLabel || '';
    listing.startingPrice = Number(startingPrice);
    listing.priceLabel = priceLabel;
    listing.photos = nextPhotos;
    listing.contact = {
      whatsapp: sanitizeWhatsapp(whatsapp),
      email: email || '',
      phone: phone || '',
    };
    listing.status = moderationStatus;
    listing.rejectionReason = rejectionReason;

    syncListingPremiumState(listing, req.user);
    await listing.save();
    res.json(listing);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/sale-status', auth, async (req, res) => {
  const { saleStatus } = req.body;
  const listing = await Listing.findOne({ _id: req.params.id, user: req.user._id });
  if (!listing) return res.status(404).json({ message: 'Listing not found or does not belong to you.' });

  if (!['available', 'sold'].includes(saleStatus)) {
    return res.status(400).json({ message: 'Invalid sale status supplied.' });
  }

  applySaleStatusEffects(listing, saleStatus, req.user);
  await listing.save();

  res.json(listing);
});

router.delete('/:id', auth, async (req, res) => {
  const listing = await Listing.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!listing) return res.status(404).json({ message: 'Listing not found or does not belong to you.' });

  await cleanupDeletedListing(listing._id);
  res.json({ message: 'Listing deleted successfully.' });
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

  syncListingPremiumState(listing, listing.user);
  await listing.save();

  await Notification.create({
    user: listing.user?._id,
    type: action === 'approve' ? 'moderation_approved' : 'moderation_rejected',
    title: action === 'approve' ? 'Listing approved' : 'Listing rejected',
    message:
      action === 'approve'
        ? `${listing.title} has been approved and is now visible to buyers.`
        : `${listing.title} was rejected${reason ? `: ${reason}` : '.'}`,
    meta: {
      listingId: listing._id.toString(),
      action,
      reason: reason || '',
      path: `/listings/${listing._id.toString()}`,
    },
  });

  res.json(listing);
});

router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || !comment) return res.status(400).json({ message: 'Rating and comment are required' });
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ message: 'Listing not found' });

  if (listing.user.toString() === req.user._id.toString()) {
    return res.status(400).json({ message: 'You cannot review or rate your own listing.' });
  }

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

  await Notification.create({
    user: listing.user,
    type: 'review',
    title: 'New review received',
    message: `${req.user.name} left a ${Number(rating)}-star review on ${listing.title}.`,
    meta: {
      listingId: listing._id.toString(),
      reviewerId: req.user._id.toString(),
      rating: Number(rating),
      path: `/listings/${listing._id.toString()}`,
    },
  });

  res.status(201).json(listing);
});

router.post('/:id/report', optionalAuth, async (req, res) => {
  try {
    const reporterName = String(req.body?.reporterName || '').trim();
    const reporterEmail = String(req.body?.reporterEmail || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();

    if (!reporterName || !reason) {
      return res.status(400).json({ message: 'Reporter name and reason are required' });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (req.user && listing.user.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot report your own listing.' });
    }

    const report = await Report.create({
      listing: listing._id,
      reporterName,
      reporterEmail,
      reason,
    });

    const sideEffects = [];

    sideEffects.push(
      Notification.create({
        type: 'report',
        title: 'Listing reported',
        message: `${listing.title} was reported by ${reporterName}`,
        meta: {
          listingId: listing._id.toString(),
          reportId: report._id.toString(),
          actionUrl: '/admin?tab=reports',
        },
      })
    );

    sideEffects.push(
      Promise.resolve().then(() => {
        const reportEmail = buildAdminAlertEmail({
          variant: 'listing_report',
          eyebrow: 'Listing reported',
          title: 'A listing was reported by a user',
          intro: 'A visitor flagged a listing for admin attention. Please inspect the listing details and decide whether additional moderation is required.',
          fields: [
            { label: 'Listing title', value: listing.title },
            { label: 'Category', value: listing.category },
            { label: 'Listing owner ID', value: listing.user?.toString?.() || String(listing.user || '') },
            { label: 'Reporter', value: reporterName },
            { label: 'Reporter email', value: reporterEmail || 'Not provided' },
            { label: 'Reason', value: reason },
            { label: 'Reported at', value: formatDateTime(report.createdAt) },
          ],
          actionLabel: 'Review admin dashboard',
          callout: 'Reports can indicate fraud, spam, duplicate content or unsafe buyer/seller behaviour. Review promptly.',
          footerNote: 'You are receiving this because you are the PeezuHub admin contact for operational notifications.',
        });

        return queueEmail({
          to: getAdminNotificationRecipients(),
          subject: `${APP_NAME} report: ${listing.title}`,
          html: reportEmail.html,
          text: reportEmail.text,
        });
      })
    );

    const sideEffectResults = await Promise.allSettled(sideEffects);
    const failedSideEffect = sideEffectResults.find((result) => result.status === 'rejected');
    if (failedSideEffect) {
      console.error('[PeezuHub] report side effect failed:', failedSideEffect.reason?.message || failedSideEffect.reason);
    }

    return res.status(201).json({ message: 'Report sent to admin successfully' });
  } catch (error) {
    console.error('[PeezuHub] report listing failed:', error.message);
    return res.status(500).json({ message: 'Unable to submit report right now. Please try again.' });
  }
});

module.exports = router;
