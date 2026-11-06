const express = require('express');
const User = require('../models/User');
const { signToken, protect, asyncHandler } = require('../middleware/auth');

const router = express.Router();

// Basic phone number validation regex (supports optional + and 9 to 15 digits)
const PHONE_RE = /^\+?[0-9]{9,15}$/;

function validate(phoneNumber, password) {
  if (typeof phoneNumber !== 'string' || !PHONE_RE.test(phoneNumber.trim()))
    return 'Enter a valid mobile number';
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return 'Password must be 6-72 characters';
  return null;
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { phoneNumber, password } = req.body;
  const problem = validate(phoneNumber, password);
  if (problem) return res.status(400).json({ message: problem });

  try {
    const formattedPhone = phoneNumber.trim();
    const user = await User.create({ phoneNumber: formattedPhone, password });
    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Phone number already registered' });
    throw err;
  }
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { phoneNumber, password } = req.body;
  if (typeof phoneNumber !== 'string' || typeof password !== 'string')
    return res.status(400).json({ message: 'Mobile number and password are required' });

  const user = await User.findOne({ phoneNumber: phoneNumber.trim() }).select('+password');
  // Same message for both cases to avoid account enumeration.
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: 'Invalid mobile number or password' });

  res.json({ token: signToken(user.id), user });
}));

// GET /api/auth/me
router.get('/me', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ message: 'User no longer exists' });
  res.json({ user });
}));

// POST /api/auth/check-contacts (WhatsApp style contact sync)
router.post('/check-contacts', protect, asyncHandler(async (req, res) => {
  const { phoneNumbers } = req.body;
  if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
    return res.status(400).json({ error: 'Phone numbers array is required' });
  }

  // Find users whose phone number exists in the sent list (excluding own user id)
  const registeredUsers = await User.find({
    _id: { $ne: req.user.id },
    phoneNumber: { $in: phoneNumbers }
  }).select('-password');

  res.json(registeredUsers);
}));

module.exports = router;