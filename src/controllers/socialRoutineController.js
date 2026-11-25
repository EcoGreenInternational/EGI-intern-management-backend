// controllers/socialRoutineController.js – repeating (e.g. daily) posts.
const mongoose      = require("mongoose");
const SocialRoutine = require("../models/SocialRoutine");
const SocialProject = require("../models/SocialProject");
const SocialContent = require("../models/SocialContent");
const User          = require("../models/User");
const { TIME_RE, DAY_RE, todayInTz } = require("../utils/zonedTime");
const { generateRoutinePosts, removeUpcomingRoutinePosts } = require("../services/routineGenerator");

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const POP = (q) => q.populate("socialProject", "name").populate("assignedTo", "name avatar avatarColor profilePicture").populate("createdBy", "name");

const cleanHashtags = (list) =>
  (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/))
    .map(h => String(h).trim().replace(/^#*/, "")).filter(Boolean).map(h => `#${h}`.slice(0, 100))
    .filter((h, i, a) => a.indexOf(h) === i).slice(0, 30);

async function validate(body, { partial = false } = {}) {
  const out = {};
  const need = (k) => !partial || body[k] !== undefined;
  if (need("name")) {
    if (!String(body.name || "").trim()) return { error: "Give the routine a name." };
    out.name = String(body.name).trim().slice(0, 120);
  }
  if (need("socialProject")) {
    if (!isId(body.socialProject) || !(await SocialProject.exists({ _id: body.socialProject }))) return { error: "Choose a social project." };
    out.socialProject = body.socialProject;
  }
  if (need("platform")) {
    if (!SocialContent.PLATFORMS.includes(body.platform)) return { error: "Choose a platform." };
    out.platform = body.platform;
  }
  if (need("assignedTo")) {
    const person = isId(body.assignedTo) && await User.findOne({ _id: body.assignedTo, isDeleted: { $ne: true } }).select("_id");
    if (!person) return { error: "Choose who will post it." };
    out.assignedTo = person._id;
  }
  if (need("daysOfWeek")) {
    const days = [...new Set((Array.isArray(body.daysOfWeek) ? body.daysOfWeek : []).map(Number))].filter(d => d >= 0 && d <= 6).sort();
    if (!days.length) return { error: "Pick at least one day of the week." };
    out.daysOfWeek = days;
  }
  if (need("startDate")) {
    const start = body.startDate || todayInTz();
    if (!DAY_RE.test(start)) return { error: "Start date must be a date." };
    out.startDate = start;
  }
  if (body.endDate !== undefined) {
    if (body.endDate && !DAY_RE.test(body.endDate)) return { error: "End date must be a date." };
    out.endDate = body.endDate || "";
  }
  if (body.time !== undefined) {
    if (body.time && !TIME_RE.test(body.time)) return { error: "Time must be HH:mm." };
    out.time = body.time || "";
  }
  if (body.contentDescription !== undefined) out.contentDescription = String(body.contentDescription).slice(0, 2000);
  if (body.caption !== undefined)      out.caption = String(body.caption).slice(0, 5000);
  if (body.hashtags !== undefined)     out.hashtags = cleanHashtags(body.hashtags);
  if (body.firstComment !== undefined) out.firstComment = String(body.firstComment).slice(0, 2000);
  if (body.autoApproved !== undefined) out.autoApproved = !!body.autoApproved;
  if (body.active !== undefined)       out.active = !!body.active;
  const start = out.startDate, end = out.endDate;
  if (start && end && end < start) return { error: "End date can't be before the start date." };
  return { data: out };
}

// GET /api/social-routines – supervisors: all; interns: routines assigned to them
exports.list = async (req, res, next) => {
  try {
    const filter = req.user.role === "supervisor" ? {} : { assignedTo: req.user._id };
    const routines = await POP(SocialRoutine.find(filter)).sort({ active: -1, time: 1, name: 1 });
    res.json({ success: true, data: routines });
  } catch (err) { next(err); }
};

// POST /api/social-routines (supervisor)
exports.create = async (req, res, next) => {
  try {
    const { data, error } = await validate(req.body || {});
    if (error) return fail(res, 400, error);
    const routine = await SocialRoutine.create({ ...data, createdBy: req.user._id });
    const gen = await generateRoutinePosts({ routineId: routine._id });
    res.status(201).json({ success: true, data: await POP(SocialRoutine.findById(routine._id)), generated: gen.created });
  } catch (err) { next(err); }
};

// PUT /api/social-routines/:id (supervisor)
// Upcoming posts nobody has started are re-created so they follow the new settings.
exports.update = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, "Invalid routine id.");
    const routine = await SocialRoutine.findById(req.params.id);
    if (!routine) return fail(res, 404, "Routine not found.");
    const { data, error } = await validate(req.body || {}, { partial: true });
    if (error) return fail(res, 400, error);
    if (data.startDate && (data.endDate ?? routine.endDate) && (data.endDate ?? routine.endDate) < data.startDate)
      return fail(res, 400, "End date can't be before the start date.");
    Object.assign(routine, data);
    await routine.save();
    const removed = await removeUpcomingRoutinePosts(routine._id);
    const gen = routine.active ? await generateRoutinePosts({ routineId: routine._id }) : { created: 0 };
    res.json({ success: true, data: await POP(SocialRoutine.findById(routine._id)), refreshed: removed, generated: gen.created });
  } catch (err) { next(err); }
};

// DELETE /api/social-routines/:id (supervisor) – past posts are kept.
exports.remove = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, "Invalid routine id.");
    const routine = await SocialRoutine.findById(req.params.id);
    if (!routine) return fail(res, 404, "Routine not found.");
    const removed = await removeUpcomingRoutinePosts(routine._id);
    await routine.deleteOne();
    res.json({ success: true, message: "Routine deleted", removedUpcoming: removed });
  } catch (err) { next(err); }
};
