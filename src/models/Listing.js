const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const listingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    locationLabel: { type: String, trim: true, default: '' },
    startingPrice: { type: Number, required: true, min: 0 },
    priceLabel: { type: String, required: true, trim: true },
    photos: [{ type: String, required: true }],
    contact: {
      whatsapp: { type: String, required: true, trim: true },
      email: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, default: '' },
    premiumRequested: { type: Boolean, default: false },
    premiumPaymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid'], default: 'unpaid' },
    paystackReference: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    featuredUntil: { type: Date },
    reviews: [reviewSchema],
    averageRating: { type: Number, default: 0 },
    reviewsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Listing', listingSchema);
