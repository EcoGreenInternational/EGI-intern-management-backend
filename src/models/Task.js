
const mongoose = require("mongoose");
const { getWeekKey } = require("../utils/weekKey");
const subTaskSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },
    status:      { type: String, default: "To Do", enum: ["To Do", "In Progress", "Done", "Hold"] },
    estimateTime:{ type: String, default: "" },
    timeFrom:    { type: String, default: "" },
    timeTo:      { type: String, default: "" },
    totalMinutes:{ type: Number, default: 0 },
    workDoc:     { type: String, default: "" },
    reason:      { type: String, default: "" },
    completedAt: { type: Date,   default: null },
  },
  { timestamps: true, _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    date:         { type: String, required: true },
    project:      { type: String, required: true },
    assignedBy:   { type: String, default: "" },
    task:         { type: String, required: true },
    status:       { type: String, default: "To Do", enum: ["To Do", "In Progress", "Done", "Hold"] },
    estimateTime: { type: String, default: "" },
    timeFrom:     { type: String, default: "" },
    timeTo:       { type: String, default: "" },
    totalMinutes: { type: Number, default: 0 },
    workDoc:      { type: String, default: "" },
    reason:       { type: String, default: "" },
    adminChecked: [{ type: String }],

    isLeave:     { type: Boolean, default: false },
    leaveReason: { type: String,  default: "" },
    // Last day of a multi-day leave ("YYYY-MM-DD"); "" means a single day.
    // A leave range is stored as ONE task covering date … leaveEndDate.
    leaveEndDate: { type: String, default: "" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subTasks:   [subTaskSchema],
    weekKey:    { type: String, default: "" },

    // ── Soft delete ───────────────────────────────────────────────────────
    isDeleted:  { type: Boolean, default: false },
    deletedAt:  { type: Date,   default: null },
  },
  { timestamps: true }
);

taskSchema.pre("save", function (next) {
  if (this.date) {
    this.weekKey = getWeekKey(new Date(this.date));
  }
  if (!this.isLeave) this.leaveEndDate = "";
  next();
});

module.exports = mongoose.model("Task", taskSchema);