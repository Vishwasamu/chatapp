const express = require('express');
const User = require('../models/User');
const { signToken, protect, asyncHandler } = require('../middleware/auth');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validate(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return 'Username must be 3-20 characters (letters, numbers, underscore)';
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return 'Password must be 6-72 characters';
  return null;
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const problem = validate(username, password);
  if (problem) return res.status(400).json({ message: problem });

  try {
    const user = await User.create({ username, password });
    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Username already taken' });
    throw err;
  }
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ message: 'Username and password are required' });

  const user = await User.findOne({ username: username.toLowerCase().trim() }).select('+password');
  // Same message for both cases to avoid username enumeration.
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: 'Invalid username or password' });

  res.json({ token: signToken(user.id), user });
}));

// GET /api/auth/me
router.get('/me', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ message: 'User no longer exists' });
  res.json({ user });
}));

module.exports = router;
