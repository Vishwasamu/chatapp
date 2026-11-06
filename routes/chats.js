const express = require('express');
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const { protect, asyncHandler } = require('../middleware/auth');
const { toClientChat } = require('../services/chatService');

const router = express.Router();
router.use(protect);

// GET /api/chats -> my chats, newest activity first, with unread counts
router.get('/', asyncHandler(async (req, res) => {
  const ids = await Chat.find({ members: req.user.id }).sort('-updatedAt').select('_id').lean();
  const chats = await Promise.all(ids.map((c) => toClientChat(c._id, req.user.id)));
  res.json({ chats });
}));

// POST /api/chats
//   private: { "userId": "<id>" }
//   group:   { "name": "Team", "memberIds": ["<id>", "<id>"] }
router.post('/', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { userId, name, memberIds } = req.body;
  let chat;
  let created = false;

  if (userId) {
    // ---- private chat (find or create) ----
    if (!mongoose.isValidObjectId(userId) || userId === me)
      return res.status(400).json({ message: 'Invalid user' });
    if (!(await User.exists({ _id: userId })))
      return res.status(404).json({ message: 'User not found' });

    const privateKey = [me, userId].sort().join('_');
    chat = await Chat.findOne({ privateKey });
    if (!chat) {
      try {
        chat = await Chat.create({ members: [me, userId], privateKey });
        created = true;
      } catch (err) {
        if (err.code !== 11000) throw err; // lost a race: someone just created it
        chat = await Chat.findOne({ privateKey });
      }
    }
  } else {
    // ---- group chat ----
    if (typeof name !== 'string' || !name.trim())
      return res.status(400).json({ message: 'Group name is required' });
    if (!Array.isArray(memberIds) || !memberIds.every((i) => mongoose.isValidObjectId(i)))
      return res.status(400).json({ message: 'Invalid members' });

    const ids = [...new Set([me, ...memberIds])];
    if (ids.length < 3)
      return res.status(400).json({ message: 'A group needs at least 3 members' });
    if ((await User.countDocuments({ _id: { $in: ids } })) !== ids.length)
      return res.status(404).json({ message: 'Some members were not found' });

    chat = await Chat.create({ isGroup: true, name: name.trim(), members: ids, admin: me });
    created = true;
  }

  if (created) {
    const io = req.app.get('io');
    for (const member of chat.members) {
      const memberId = member.toString();
      // Put every connected device of every member into the new room...
      io.in(`user:${memberId}`).socketsJoin(`chat:${chat.id}`);
      // ...and tell everyone except the creator that a new chat exists.
      if (memberId !== me) {
        io.to(`user:${memberId}`).emit('new_chat', await toClientChat(chat.id, memberId));
      }
    }
  }

  res.status(created ? 201 : 200).json({ chat: await toClientChat(chat.id, me) });
}));

// GET /api/chats/:id/messages?limit=50&before=<ISO date>
router.get('/:id/messages', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid chat id' });
  if (!(await Chat.exists({ _id: id, members: req.user.id })))
    return res.status(403).json({ message: 'Not a member of this chat' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const filter = { chat: id };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!isNaN(before)) filter.createdAt = { $lt: before };
  }

  const messages = await Message.find(filter)
    .sort('-createdAt')
    .limit(limit)
    .populate('sender', 'username')
    .lean();

  res.json({ messages: messages.reverse() }); // chronological order
}));

module.exports = router;
