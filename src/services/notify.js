// services/notify.js – create in-app notifications and push them over Socket.IO.
const Notification = require("../models/Notification");
const User         = require("../models/User");

let ioRef = null;
const setNotifyIO = (io) => { ioRef = io; };

const uniqueIds = (ids) => [...new Set(ids.filter(Boolean).map(id => String(id._id || id)))];

/**
 * notify(recipients, { type, message, relatedId, relatedModel, sender })
 * Skips the sender and duplicates. Never throws (a failed notification must
 * not break the action that triggered it).
 */
async function notify(recipients, { type, message, relatedId, relatedModel = "SocialContent", sender = null }) {
  try {
    const senderId = sender ? String(sender._id || sender) : null;
    const ids = uniqueIds(recipients).filter(id => id !== senderId);
    if (!ids.length) return [];
    const docs = await Notification.insertMany(ids.map(recipient => ({
      recipient, sender: senderId, type, message, relatedId, relatedModel,
    })));
    if (ioRef) docs.forEach(d => ioRef.to(`user:${d.recipient}`).emit("notification", d));
    return docs;
  } catch (err) {
    console.error("[notify] failed:", err.message);
    return [];
  }
}

// Who should approve a post: the supervisor who planned it, the project owner
// and supervisors on the project; if none of those, every supervisor.
async function approversFor(content, project) {
  const candidates = uniqueIds([content.assignedBy, project?.createdBy, ...(project?.assignedPersons || [])]);
  const supervisors = await User.find({ _id: { $in: candidates }, role: "supervisor", isDeleted: { $ne: true } }).select("_id");
  if (supervisors.length) return supervisors.map(s => s._id);
  const all = await User.find({ role: "supervisor", isDeleted: { $ne: true } }).select("_id");
  return all.map(s => s._id);
}

module.exports = { notify, approversFor, setNotifyIO, uniqueIds };
