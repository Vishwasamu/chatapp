const express = require('express');
const User = require('../models/User');
const { protect, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// GET /api/users?q=ali  -> everyone except me (optionally filtered by username)
router.get('/', asyncHandler(async (req, res) => {
  const filter = { _id: { $ne: req.user.id } };
  if (req.query.q) {
    const safe = String(req.query.q).toLowerCase().replace(/[^a-z0-9_]/g, '');
    filter.username = { $regex: `^${safe}` };
  }
  const users = await User.find(filter)
    .select('username avatar isOnline lastSeen')
    .sort('username')
    .limit(100);
  res.json({ users });
}));

module.exports = router;
