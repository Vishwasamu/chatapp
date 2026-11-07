const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true, index: true },
  username:    { type: String, required: true, index: true },
  email:       { type: String, lowercase: true, trim: true, sparse: true, unique: true, index: true },
  emailVerified: { type: Boolean, default: false },
  password:    { type: String, required: true, select: false },
  avatar:      { type: String, default: '' },
  isOnline:    { type: Boolean, default: false },
  lastSeen:    { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);