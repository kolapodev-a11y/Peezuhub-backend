const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: { type: String, required: true, trim: true },
    senderEmail: { type: String, trim: true, default: '' },
    senderPhone: { type: String, trim: true, default: '' },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
