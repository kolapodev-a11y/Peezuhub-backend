const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    googleId: { type: String },
    avatar: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    premiumPlan: { type: String, enum: ['none', 'seller_premium'], default: 'none' },
    premiumStatus: { type: String, enum: ['inactive', 'pending', 'active'], default: 'inactive' },
    premiumReference: { type: String, default: '' },
    premiumActivatedAt: { type: Date, default: null },
    premiumExpiresAt: { type: Date, default: null },
    premiumAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
