const express = require("express");
const router  = express.Router();
const Meeting = require("../models/Meeting");
const { protect, restrictTo } = require("../middleware/auth");

const POPULATE = { path: "participants createdBy", select: "name role avatar avatarColor" };

// Fields a supervisor may set when creating/updating a meeting.
// createdBy, isDeleted etc. can never be set from the request body.
const EDITABLE = [
  "title", "description", "date", "startTime", "endTime",
  "location", "meetingLink", "participants", "status", "notes",
];
const MEETING_STATUSES = ["scheduled", "completed", "cancelled"];

const pick = (body = {}) => {
  const out = {};
  EDITABLE.forEach(f => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

router.use(protect);

router.get("/", async (req, res) => {
  try {
    const query = req.user.role === "intern"
      ? { participants: req.user._id, isDeleted: { $ne: true } }
      : { isDeleted: { $ne: true } };

    const meetings = await Meeting.find(query)
      .sort({ date: 1 })
      .populate(POPULATE);

    res.json({ meetings });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/", restrictTo("supervisor"), async (req, res) => {
  try {
    const meeting   = await Meeting.create({ ...pick(req.body), createdBy: req.user._id });
    const populated = await meeting.populate(POPULATE);
    res.status(201).json({ meeting: populated });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// NOTE: specific routes must come BEFORE /:id
router.patch("/:id/status", restrictTo("supervisor"), async (req, res) => {
  try {
    const { status } = req.body;
    if (!MEETING_STATUSES.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { status },
      { new: true }
    ).populate(POPULATE);

    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    res.json({ meeting });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.patch("/:id", restrictTo("supervisor"), async (req, res) => {
  try {
    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      pick(req.body),
      { new: true, runValidators: true }
    ).populate(POPULATE);

    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    res.json({ meeting });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.delete("/:id", restrictTo("supervisor"), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    await meeting.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
