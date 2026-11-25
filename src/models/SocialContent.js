// src/models/SocialContent.js
const mongoose = require("mongoose");
const { STATUSES, computeDueAt } = require("../services/socialWorkflow");

const PLATFORMS = ["Instagram", "Facebook", "Twitter", "LinkedIn", "TikTok", "YouTube", "Other"];

const mediaSchema = new mongoose.Schema(
  {
    name:         { type: String, default: "" },
    size:         { type: Number, default: 0 },
    type:         { type: String, default: "" },      // MIME type
    url:          { type: String, required: true },   // Cloudinary HTTPS URL
    publicId:     { type: String, default: "" },
    resourceType: { type: String, enum: ["image", "video", "raw"], default: "image" },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text:   { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Who did what, shown as the post's activity timeline.
const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },   // created, submitted, approved, rejected, posted, missed, metrics, rescheduled, edited
    by:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note:   { type: String, default: "" },
    at:     { type: Date, default: Date.now },
  },
  { _id: false }
);

const socialContentSchema = new mongoose.Schema(
  {
    // References SocialProject (NOT the existing Project model)
    socialProject: { type: mongoose.Schema.Types.ObjectId, ref: "SocialProject", required: true },

    // Kept for backward compat / display — synced from socialProject.name on create
    title: { type: String },

    platform: { type: String, enum: PLATFORMS, required: true },

    // Brief from the supervisor (what the post should be about)
    contentDescription: { type: String },

    // The post itself
    caption:      { type: String, default: "", maxlength: 5000 },
    hashtags:     [{ type: String, trim: true, maxlength: 100 }],
    firstComment: { type: String, default: "", maxlength: 2000 },
    media:        [mediaSchema],

    plannedPostDate: { type: Date, required: true },   // UTC midnight of the planned day
    plannedTime:     { type: String, default: "" },    // "HH:mm" in company time, optional
    dueAt:           { type: Date },                   // after this the post counts as Missed

    actualPostDate:       { type: Date },
    postedLate:           { type: Boolean, default: false },
    performanceCheckedAt: { type: Date },
    // Set when the 7-day "add performance data" reminder has been sent, so it goes out once.
    performanceReminderSentAt: { type: Date },
    postUrl: { type: String },

    status: { type: String, enum: STATUSES, default: "Planned" },

    approval: {
      submittedAt:     { type: Date, default: null },
      submittedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt:      { type: Date, default: null },
      reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectionReason: { type: String, default: "" },
    },

    comments: [commentSchema],
    history:  [historySchema],

    // Daily routine that generated this post (if any) and the day it is for
    routine:     { type: mongoose.Schema.Types.ObjectId, ref: "SocialRoutine", default: null },
    routineDate: { type: String, default: null },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    metrics: {
      views:            { type: Number, default: 0 },
      likes:            { type: Number, default: 0 },
      comments:         { type: Number, default: 0 },
      shares:           { type: Number, default: 0 },
      engagementRate:   { type: Number, default: 0 },
      performanceScore: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

socialContentSchema.index({ plannedPostDate: 1 });
socialContentSchema.index({ status: 1, dueAt: 1 });
socialContentSchema.index({ assignedTo: 1, plannedPostDate: 1 });
// One post per routine per day, even if the generator runs twice.
socialContentSchema.index(
  { routine: 1, routineDate: 1 },
  { unique: true, partialFilterExpression: { routine: { $type: "objectId" } } }
);

socialContentSchema.pre("save", function (next) {
  if (this.isNew || this.isModified("plannedPostDate") || this.isModified("plannedTime") || !this.dueAt) {
    this.dueAt = computeDueAt(this.plannedPostDate, this.plannedTime);
  }
  next();
});

// Engagement Rate = (Likes + Comments + Shares) / Views × 100
// Performance Score = Views + (Likes × 2) + (Comments × 3)
socialContentSchema.methods.calculateMetrics = function ({ views, likes, comments, shares }) {
  const v = views    || 0;
  const l = likes    || 0;
  const c = comments || 0;
  const s = shares   || 0;

  const engagementRate   = v > 0 ? ((l + c + s) / v) * 100 : 0;
  const performanceScore = v + (l * 2) + (c * 3);

  return {
    views: v, likes: l, comments: c, shares: s,
    engagementRate:   Math.round(engagementRate * 100) / 100,
    performanceScore,
  };
};

socialContentSchema.statics.PLATFORMS = PLATFORMS;

module.exports = mongoose.model("SocialContent", socialContentSchema);
