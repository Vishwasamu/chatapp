const mongoose = require('mongoose');

const pendingSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, index: true },
  email:       { type: String, required: true, lowercase: true, index: true },
  otpHash:     { type: String, required: true },
  attempts:    { type: Number, default: 0 },
  lastSentAt:  { type: Date, default: Date.now },
  expiresAt:   { type: Date, required: true, index: { expires: 0 } }, // TTL index
});

pendingSchema.index({ phoneNumber: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('PendingRegistration', pendingSchema);