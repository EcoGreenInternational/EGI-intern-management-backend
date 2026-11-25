// src/models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: [
        "post",
        "comment",
        "like",
        "mention",
        "system",
        "performance",
        "content_assigned",       // sent to intern when new content is assigned
        "performance_submitted",  // sent to supervisors when intern submits metrics
        "missed_post",            // sent by socialCron when a planned post passes its date
        "performance_due",        // sent by socialCron 7 days after posting without metrics
        "approval_requested",     // sent to supervisors when a post is submitted for approval
        "content_approved",       // sent to the assignee when a post is approved
        "content_rejected",       // sent to the assignee when a post is rejected
        "content_comment",        // sent to people on a post when someone comments
      ],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    // relatedId + relatedModel allow linking to any collection (SocialContent, Task, etc.)
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    relatedModel: {
      type: String,
      enum: ["SocialContent", "SocialRoutine", "Task", "User", "Post"],
    },
    // kept for backward compatibility with any existing notifications
    relatedContent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialContent",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);