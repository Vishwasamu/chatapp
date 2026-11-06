const mongoose = require('mongoose');

/**
 * A conversation. Private chats have exactly 2 members and a unique
 * `privateKey` (sorted member ids) so the same pair can never get two chats.
 * Group chats have a name, an admin and 3+ members.
 */
const chatSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    name: { type: String, trim: true, maxlength: 60 },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    privateKey: { type: String, unique: true, sparse: true },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  },
  { timestamps: true }
);

chatSchema.index({ members: 1, updatedAt: -1 });

module.exports = mongoose.model('Chat', chatSchema);
