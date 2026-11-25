// src/models/SocialRoutine.js
// A repeating post (e.g. a daily "good morning" post). The routine generator
// creates a SocialContent for every matching day automatically.
const mongoose = require("mongoose");

const PLATFORMS = ["Instagram", "Facebook", "Twitter", "LinkedIn", "TikTok", "YouTube", "Other"];

const socialRoutineSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true, maxlength: 120 },
    socialProject: { type: mongoose.Schema.Types.ObjectId, ref: "SocialProject", required: true },
    platform:      { type: String, enum: PLATFORMS, required: true },
    assignedTo:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Starting content copied into each day's post (the intern can edit it per day)
    contentDescription: { type: String, default: "" },
    caption:            { type: String, default: "", maxlength: 5000 },
    hashtags:           [{ type: String, trim: true, maxlength: 100 }],
    firstComment:       { type: String, default: "", maxlength: 2000 },

    time:       { type: String, default: "" },                    // "HH:mm", optional
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] }, // 0 = Sunday
    startDate:  { type: String, required: true },                 // "YYYY-MM-DD"
    endDate:    { type: String, default: "" },                    // "" = no end

    autoApproved: { type: Boolean, default: true },   // routine posts skip the approval step
    active:       { type: Boolean, default: true },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SocialRoutine", socialRoutineSchema);
