// controllers/notificationController.js – the signed-in user's in-app notifications.
const mongoose     = require("mongoose");
const Notification = require("../models/Notification");

// GET /api/notifications?limit=30
exports.getMine = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const [items, unread] = await Promise.all([
      Notification.find({ recipient: req.user._id })
        .sort({ createdAt: -1 }).limit(limit)
        .populate("sender", "name avatar avatarColor profilePicture"),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);
    res.json({ success: true, notifications: items, unread });
  } catch (err) { next(err); }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { isRead: true }, { new: true });
    if (!n) return res.status(404).json({ success: false, message: "Notification not found." });
    res.json({ success: true, notification: n });
  } catch (err) { next(err); }
};

// PATCH /api/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) { next(err); }
};
