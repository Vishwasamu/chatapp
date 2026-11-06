const Chat = require('../models/Chat');
const Message = require('../models/Message');

const MEMBER_FIELDS = 'username avatar isOnline lastSeen';

/** Load a chat in the exact JSON shape the Flutter client expects. */
async function toClientChat(chatId, viewerId) {
  const chat = await Chat.findById(chatId)
    .populate('members', MEMBER_FIELDS)
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'username' } })
    .lean();
  if (!chat) return null;
  chat.unreadCount = await Message.countDocuments({
    chat: chat._id,
    readBy: { $ne: viewerId },
  });
  return chat;
}

module.exports = { toClientChat, MEMBER_FIELDS };
