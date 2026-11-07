const express = require('express');
const User = require('../models/User');
const PendingRegistration = require('../models/PendingRegistration');
const { sendOtpEmail } = require('../utils/mailer');
const { generateOtp, hashCode } = require('../utils/otp');
const {
  signToken,
  protect,
  asyncHandler,
} = require('../middleware/auth');

const router = express.Router();

// Basic phone number validation regex (supports optional + and 9 to 15 digits)
const PHONE_RE = /^\+?[0-9]{9,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(phoneNumber, password) {
  if (typeof phoneNumber !== 'string' || !PHONE_RE.test(phoneNumber.trim()))
    return 'Enter a valid mobile number';
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return 'Password must be 6-72 characters';
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/auth/register  (LEGACY — old no-email flow, kept for compatibility)
// ---------------------------------------------------------------------------
router.post('/register', asyncHandler(async (req, res) => {
  const { phoneNumber, password } = req.body;
  const problem = validate(phoneNumber, password);
  if (problem) return res.status(400).json({ message: problem });

  try {
    const formattedPhone = phoneNumber.trim();
    const user = await User.create({ 
      phoneNumber: formattedPhone, 
      username: formattedPhone, // ⬅️ Auto-generate username
      password 
    });
    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Phone number already registered' });
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// POST /api/auth/register/request-otp  →  email OTP step 1
// ---------------------------------------------------------------------------
router.post('/register/request-otp', asyncHandler(async (req, res) => {
  const { phoneNumber, email, password } = req.body || {};

  // Validate
  const problem = validate(phoneNumber, password);
  if (problem) return res.status(400).json({ message: problem });
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ message: 'Enter a valid email address' });

  const formattedPhone = phoneNumber.trim();
  const formattedEmail = email.trim().toLowerCase();

  // Uniqueness
  const existingPhone = await User.findOne({ phoneNumber: formattedPhone });
  if (existingPhone) return res.status(409).json({ message: 'Phone number already registered' });

  const existingEmail = await User.findOne({ email: formattedEmail });
  if (existingEmail) return res.status(409).json({ message: 'Email already registered' });

  // Resend cooldown
  const pending = await PendingRegistration.findOne({
    phoneNumber: formattedPhone,
    email: formattedEmail,
  });
  if (pending) {
    const elapsed = (Date.now() - pending.lastSentAt.getTime()) / 1000;
    const cooldown = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
    if (elapsed < cooldown) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil(cooldown - elapsed)}s before requesting a new OTP`,
      });
    }
  }

  // Generate OTP
  const otp = generateOtp();
  const otpHash = hashCode(otp);
  const expiresAt = new Date(
    Date.now() + Number(process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000
  );

  if (pending) {
    pending.otpHash = otpHash;
    pending.attempts = 0;
    pending.lastSentAt = new Date();
    pending.expiresAt = expiresAt;
    await pending.save();
  } else {
    await PendingRegistration.create({
      phoneNumber: formattedPhone,
      email: formattedEmail,
      otpHash,
      expiresAt,
    });
  }

  // Testing: log OTP so you can use it even before email is configured
  console.log(`🔐 OTP for ${formattedEmail} = ${otp}`);

  // Send email
  try {
    await sendOtpEmail(formattedEmail, otp);
  } catch (e) {
    console.error('Email send failed:', e.message);
    return res.status(202).json({
      success: true,
      message: 'OTP generated but email delivery failed. Check server logs.',
    });
  }

  return res.status(200).json({ success: true });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/register/verify-otp  →  email OTP step 2
// ---------------------------------------------------------------------------
router.post('/register/verify-otp', asyncHandler(async (req, res) => {
  const { phoneNumber, email, password, otp } = req.body || {};

  // Validate
  const problem = validate(phoneNumber, password);
  if (problem) return res.status(400).json({ message: problem });
  if (typeof email !== 'string') return res.status(400).json({ message: 'Email required' });
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp))
    return res.status(400).json({ message: 'Enter the 6-digit OTP' });

  const formattedPhone = phoneNumber.trim();
  const formattedEmail = email.trim().toLowerCase();

  const pending = await PendingRegistration.findOne({
    phoneNumber: formattedPhone,
    email: formattedEmail,
  });
  if (!pending) return res.status(400).json({ message: 'No pending registration. Request a new OTP.' });

  if (pending.expiresAt < new Date()) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    return res.status(400).json({ message: 'OTP expired. Request a new one.' });
  }

  if (pending.attempts >= Number(process.env.OTP_MAX_ATTEMPTS || 5)) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    return res.status(429).json({ message: 'Too many attempts. Request a new OTP.' });
  }

  if (hashCode(otp) !== pending.otpHash) {
    pending.attempts += 1;
    await pending.save();
    return res.status(400).json({ message: 'Incorrect OTP' });
  }

  // Create user — User model's pre-save hook will hash the password.
  let user;
  try {
    user = await User.create({
      phoneNumber: formattedPhone,
      username: formattedPhone, // ⬅️ Auto-generate username (phone number)
      email: formattedEmail,
      password,                 // raw — model hashes it
      emailVerified: true,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Phone number or email already registered' });
    }
    throw err;
  }

  await PendingRegistration.deleteOne({ _id: pending._id });

  return res.status(201).json({ token: signToken(user.id), user });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', asyncHandler(async (req, res) => {
  // Accept phone OR username (Flutter currently sends 'username').
  const { phoneNumber, username, password } = req.body || {};
  const identifier = phoneNumber || username;

  if (typeof identifier !== 'string' || typeof password !== 'string')
    return res.status(400).json({ message: 'Mobile number and password are required' });

  const user = await User.findOne({ phoneNumber: identifier.trim() }).select('+password');
  
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: 'Invalid mobile number or password' });

  // Optional: block unverified emails from the legacy /register path
  if (user.emailVerified === false) {
    return res.status(403).json({ message: 'Email not verified. Please register again.' });
  }

  res.json({ token: signToken(user.id), user });
}));

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get('/me', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ message: 'User no longer exists' });
  res.json({ user });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/check-contacts  (WhatsApp-style contact sync)
// ---------------------------------------------------------------------------
router.post('/check-contacts', protect, asyncHandler(async (req, res) => {
  const { phoneNumbers } = req.body;
  if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
    return res.status(400).json({ error: 'Phone numbers array is required' });
  }

  const registeredUsers = await User.find({
    _id: { $ne: req.user.id },
    phoneNumber: { $in: phoneNumbers },
  }).select('-password');

  res.json(registeredUsers);
}));

module.exports = router;