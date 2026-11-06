/**
 * Socket.io layer.
 *
 * Rooms:
 *   user:<userId>  – every device of one user (used for targeted events)
 *   chat:<chatId>  – every member of one conversation (private or group)
 *
 * Client -> server events:
 *   join_chat   (chatId, ack?)
 *   leave_chat  (chatId)
 *   send_message({ chatId, text, tempId }, ack)   ack({ ok, message | error })
 *   typing      ({ chatId })
 *   stop_typing ({ chatId })
 *   mark_read   ({ chatId })
 *
 * Server -> client events:
 *   receive_message, typing, stop_typing, user_status, messages_read, new_chat
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const { verifyToken } = require('../middleware/auth');

const userRoom = (id) => `user:${id}`;
const chatRoom = (id) => `chat:${id}`;
const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});
const plain = (doc) => JSON.parse(JSON.stringify(doc)); // ObjectId/Date -> JSON-safe

async function chatRoomsOf(userId) {
  const chats = await Chat.find({ members: userId }).select('_id').lean();
  return chats.map((c) => chatRoom(c._id));
}

/** Tell everybody who shares a chat with this user that their status changed. */
function broadcastPresence(io, rooms, userId, isOnline, lastSeen) {
  // NOTE: io.to([]) with no rooms would broadcast to EVERYONE – always guard.
  if (!rooms.length) return;
  io.to(rooms).emit('user_status', { userId, isOnline, lastSeen });
}

module.exports = function registerSocketHandlers(io) {
  // ---------- Authentication handshake ----------
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized'));
      const { id } = verifyToken(token);
      const user = await User.findById(id).select('username');
      if (!user) return next(new Error('Unauthorized'));
      socket.user = { id: user.id, username: user.username };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  // ---------- Connection ----------
  io.on('connection', async (socket) => {
    const { id: userId, username } = socket.user;
    try {
      socket.join(userRoom(userId));

      // Auto-join every conversation this user belongs to.
      const rooms = await chatRoomsOf(userId);
      rooms.forEach((r) => socket.join(r));

      await User.findByIdAndUpdate(userId, { isOnline: true });
      broadcastPresence(io, rooms, userId, true, null);
      console.log(`🟢 ${username} connected (${socket.id})`);
    } catch (err) {
      console.error('connection setup failed', err);
    }

    // ----- join / leave rooms -----
    socket.on('join_chat', async (chatId, ack) => {
      const reply = safeAck(ack);
      try {
        if (!mongoose.isValidObjectId(chatId)) return reply({ ok: false });
        // Security: only real members may join a room.
        if (!(await Chat.exists({ _id: chatId, members: userId }))) return reply({ ok: false });
        socket.join(chatRoom(chatId));
        reply({ ok: true });
      } catch {
        reply({ ok: false });
      }
    });

    socket.on('leave_chat', (chatId) => socket.leave(chatRoom(chatId)));

    // ----- send message -----
    socket.on('send_message', async (payload = {}, ack) => {
      const reply = safeAck(ack);
      try {
        const { chatId, text, tempId } = payload;
        const body = typeof text === 'string' ? text.trim() : '';
        if (!mongoose.isValidObjectId(chatId) || !body || body.length > 4000)
          return reply({ ok: false, error: 'Invalid message' });
        if (!(await Chat.exists({ _id: chatId, members: userId })))
          return reply({ ok: false, error: 'Not a member of this chat' });

        socket.join(chatRoom(chatId));

        const message = await Message.create({
          chat: chatId, sender: userId, text: body, readBy: [userId],
        });
        await Chat.findByIdAndUpdate(chatId, { lastMessage: message._id }); // bumps updatedAt
        await message.populate('sender', 'username');

        const data = { ...plain(message), tempId };
        // Everyone in the room except the sending socket (other devices included).
        socket.to(chatRoom(chatId)).emit('receive_message', data);
        reply({ ok: true, message: data });
      } catch (err) {
        console.error('send_message failed', err);
        reply({ ok: false, error: 'Failed to send message' });
      }
    });

    // ----- typing indicators (only relay if the socket is really in that room) -----
    socket.on('typing', ({ chatId } = {}) => {
      const room = chatRoom(chatId);
      if (socket.rooms.has(room)) socket.to(room).emit('typing', { chatId, userId, username });
    });

    socket.on('stop_typing', ({ chatId } = {}) => {
      const room = chatRoom(chatId);
      if (socket.rooms.has(room)) socket.to(room).emit('stop_typing', { chatId, userId });
    });

    // ----- read receipts -----
    socket.on('mark_read', async ({ chatId } = {}) => {
      try {
        const room = chatRoom(chatId);
        if (!mongoose.isValidObjectId(chatId) || !socket.rooms.has(room)) return;
        await Message.updateMany(
          { chat: chatId, readBy: { $ne: userId } },
          { $addToSet: { readBy: userId } }
        );
        socket.to(room).emit('messages_read', { chatId, userId });
      } catch (err) {
        console.error('mark_read failed', err);
      }
    });

    // ----- disconnect -----
    socket.on('disconnect', async (reason) => {
      try {
        // A user may have several devices: only go offline when the last one leaves.
        const remaining = await io.in(userRoom(userId)).fetchSockets();
        if (remaining.length > 0) return;

        const lastSeen = new Date();
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
        broadcastPresence(io, await chatRoomsOf(userId), userId, false, lastSeen);
        console.log(`🔴 ${username} disconnected (${reason})`);
      } catch (err) {
        console.error('disconnect handler failed', err);
      }
    });
  });
};
