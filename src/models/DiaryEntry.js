// models/DiaryEntry.js – private diary entries, one owner per entry.
const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    size:         { type: Number, default: 0 },
    type:         { type: String, default: "" },      // MIME type
    url:          { type: String, required: true },   // Cloudinary HTTPS URL
    publicId:     { type: String, default: "" },      // Cloudinary public_id (for deletion)
    resourceType: { type: String, enum: ["image", "raw", "video"], default: "image" },
  },
  { _id: false }
);

const diaryEntrySchema = new mongoose.Schema(
  {
    user:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date:        { type: String, required: true },          // "YYYY-MM-DD"
    title:       { type: String, default: "", trim: true, maxlength: 300 },
    content:     { type: String, default: "", maxlength: 100000 },
    mood:        { type: String, default: "" },
    tags:        [{ type: String, trim: true, maxlength: 60 }],
    attachments: [attachmentSchema],
    // id from the old browser-only diary, so a repeated import doesn't duplicate entries
    legacyId:    { type: String, default: null },
  },
  { timestamps: true }
);

diaryEntrySchema.index({ user: 1, date: -1 });
diaryEntrySchema.index({ user: 1, legacyId: 1 });

module.exports = mongoose.model("DiaryEntry", diaryEntrySchema);
