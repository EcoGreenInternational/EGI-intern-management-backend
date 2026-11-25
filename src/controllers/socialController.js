// controllers/socialController.js
const mongoose       = require("mongoose");
const SocialContent  = require("../models/SocialContent");
const SocialProject  = require("../models/SocialProject");
const Notification   = require("../models/Notification");
const User           = require("../models/User");
const cloudinary     = require("../config/cloudinary");
const { resourceTypeFromUrl } = require("../utils/cloudinaryAsset");
const { TIME_RE, DAY_RE, plannedDateFromDay, plannedDayOf } = require("../utils/zonedTime");
const W = require("../services/socialWorkflow");
const { notify, approversFor } = require("../services/notify");

const PEOPLE = "name avatar avatarColor profilePicture role";
const PROJECT_FIELDS = "name platformUrls assignedPersons requireApproval createdBy";

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const destroyMedia = async (m) => {
  if (!m?.publicId) return;
  try { await cloudinary.uploader.destroy(m.publicId, { resource_type: m.resourceType || resourceTypeFromUrl(m.url) }); }
  catch (e) { console.error("[social] media delete failed:", e.message); }
};

// Media must have been uploaded through POST /social/media.
const cleanMedia = (list) =>
  (Array.isArray(list) ? list : [])
    .filter(m => m && m.url && String(m.publicId || "").startsWith("egi/social/"))
    .slice(0, 10)
    .map(m => ({
      name: String(m.name || "file").slice(0, 255), size: Number(m.size) || 0, type: String(m.type || ""),
      url: String(m.url), publicId: String(m.publicId),
      resourceType: ["image", "video", "raw"].includes(m.resourceType) ? m.resourceType : resourceTypeFromUrl(m.url),
    }));

const cleanHashtags = (list) =>
  (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/))
    .map(h => String(h).trim().replace(/^#*/, ""))
    .filter(Boolean)
    .map(h => `#${h}`.slice(0, 100))
    .filter((h, i, a) => a.indexOf(h) === i)
    .slice(0, 30);

const addHistory = (content, action, user, note = "") => {
  // Collapse repeated edits by the same person within 10 minutes into one entry.
  const last = content.history?.[content.history.length - 1];
  if (action === "edited" && last?.action === "edited" && String(last.by) === String(user._id) &&
      Date.now() - new Date(last.at).getTime() < 10 * 60000) {
    last.at = new Date();
    return;
  }
  content.history.push({ action, by: user._id, note, at: new Date() });
};

// Response shape for one post, with the actions the caller may take.
const present = (doc, user, { full = false } = {}) => {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  o.commentCount = (o.comments || []).length;
  if (!full) { delete o.comments; delete o.history; }
  o.allowed = W.allowedActions(o, o.socialProject, user);
  return o;
};

const populateFull = (q) => q
  .populate("socialProject", PROJECT_FIELDS)
  .populate("assignedTo", PEOPLE)
  .populate("assignedBy", PEOPLE)
  .populate("approval.reviewedBy", "name")
  .populate("comments.author", PEOPLE)
  .populate("history.by", "name");

async function loadForUser(req, res, { full = false } = {}) {
  if (!isId(req.params.id)) { fail(res, 400, "Invalid post id."); return null; }
  const content = await populateFull(SocialContent.findById(req.params.id));
  if (!content) { fail(res, 404, "Post not found."); return null; }
  if (!W.canView(content, content.socialProject, req.user)) { fail(res, 403, "You don't have access to this post."); return null; }
  return content;
}

// Projects an intern belongs to (they can see all posts in those).
const memberProjectIds = async (user) =>
  (await SocialProject.find({ assignedPersons: user._id }).select("_id")).map(p => p._id);

// Returns a filter with real ObjectIds (aggregate() does not cast strings).
async function visibilityFilter(req) {
  const { scope } = req.query;
  const assignee = isId(req.query.assignee) ? new mongoose.Types.ObjectId(String(req.query.assignee)) : null;
  if (W.isSupervisor(req.user)) {
    if (scope === "mine") return { assignedTo: req.user._id };
    if (assignee) return { assignedTo: assignee };
    return {};
  }
  if (scope === "mine" || !scope) return { assignedTo: req.user._id };
  const projects = await memberProjectIds(req.user);
  const base = { $or: [{ assignedTo: req.user._id }, { socialProject: { $in: projects } }] };
  if (assignee) return { $and: [base, { assignedTo: assignee }] };
  return base;
}

// ── GET /api/social ─────────────────────────────────────────────────────────
// Query: scope=mine|all, assignee, project, platform, status (comma list),
//        from/to (YYYY-MM-DD, planned day), search, limit
exports.getAllContent = async (req, res, next) => {
  try {
    const { project, platform, status, from, to, search } = req.query;
    const filter = { ...(await visibilityFilter(req)) };
    if (project && isId(project)) filter.socialProject = project;
    if (platform && platform !== "All") filter.platform = platform;
    if (status && status !== "All") {
      const list = String(status).split(",").filter(s => W.STATUSES.includes(s));
      if (list.length) filter.status = { $in: list };
    }
    if ((from && DAY_RE.test(from)) || (to && DAY_RE.test(to))) {
      filter.plannedPostDate = {};
      if (from && DAY_RE.test(from)) filter.plannedPostDate.$gte = plannedDateFromDay(from);
      if (to && DAY_RE.test(to))     filter.plannedPostDate.$lte = plannedDateFromDay(to);
    }
    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$and = [...(filter.$and || []), { $or: [{ caption: rx }, { contentDescription: rx }, { title: rx }] }];
    }

    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 300));
    const items = await SocialContent.find(filter)
      .select("-history")
      .populate("socialProject", PROJECT_FIELDS)
      .populate("assignedTo", PEOPLE)
      .populate("assignedBy", PEOPLE)
      .sort({ plannedPostDate: 1, plannedTime: 1, createdAt: 1 })
      .limit(limit);

    res.json({ success: true, data: items.map(c => present(c, req.user)), count: items.length });
  } catch (err) { next(err); }
};

// ── GET /api/social/:id ─────────────────────────────────────────────────────
exports.getContent = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    res.json({ success: true, data: present(content, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── POST /api/social ────────────────────────────────────────────────────────
exports.createContent = async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!isId(b.socialProject)) return fail(res, 400, "Choose a social project.");
    const project = await SocialProject.findById(b.socialProject);
    if (!project) return fail(res, 404, "Social project not found.");
    if (!SocialContent.PLATFORMS.includes(b.platform)) return fail(res, 400, "Choose a platform.");
    if (!b.plannedPostDate || !DAY_RE.test(String(b.plannedPostDate).slice(0, 10))) return fail(res, 400, "Choose a planned date.");
    if (b.plannedTime && !TIME_RE.test(b.plannedTime)) return fail(res, 400, "Time must be HH:mm.");

    let assignedTo;
    if (W.isSupervisor(req.user)) {
      if (!isId(b.assignedTo)) return fail(res, 400, "Choose who will post it.");
      const person = await User.findById(b.assignedTo).select("_id isDeleted");
      if (!person || person.isDeleted) return fail(res, 404, "That person was not found.");
      assignedTo = person._id;
    } else {
      // Interns can draft their own posts in projects they belong to.
      if (!W.isMember(project, req.user)) return fail(res, 403, "You can only add posts to projects you belong to.");
      assignedTo = req.user._id;
    }

    let postUrl = b.postUrl || "";
    if (!postUrl) postUrl = project.platformUrls.find(p => p.platform === b.platform)?.url || "";

    const content = new SocialContent({
      socialProject: project._id,
      title:         project.name,
      platform:      b.platform,
      contentDescription: String(b.contentDescription || "").slice(0, 2000),
      caption:       String(b.caption || "").slice(0, 5000),
      hashtags:      cleanHashtags(b.hashtags),
      firstComment:  String(b.firstComment || "").slice(0, 2000),
      media:         cleanMedia(b.media),
      plannedPostDate: plannedDateFromDay(String(b.plannedPostDate).slice(0, 10)),
      plannedTime:   b.plannedTime || "",
      postUrl,
      status:        "Planned",
      assignedTo,
      assignedBy:    req.user._id,
      createdBy:     req.user._id,
    });
    addHistory(content, "created", req.user);
    await content.save();

    if (String(assignedTo) !== String(req.user._id)) {
      await notify([assignedTo], {
        type: "content_assigned", sender: req.user, relatedId: content._id,
        message: `${req.user.name} assigned you a ${content.platform} post for ${project.name} on ${plannedDayOf(content.plannedPostDate)}.`,
      });
    }
    const full = await populateFull(SocialContent.findById(content._id));
    res.status(201).json({ success: true, data: present(full, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── PUT /api/social/:id ─────────────────────────────────────────────────────
exports.updateContent = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    const b = req.body || {};
    const user = req.user;

    const contentFields = ["caption", "hashtags", "firstComment", "media", "contentDescription", "postUrl"];
    const planningFields = ["plannedPostDate", "plannedTime", "platform", "socialProject", "assignedTo"];
    const wantsContent  = contentFields.some(f => b[f] !== undefined);
    const wantsPlanning = planningFields.some(f => b[f] !== undefined);

    if (wantsContent && !W.canEditContent(content, user))
      return fail(res, 403, content.status === "Posted" || content.status === "Reviewed"
        ? "This post is already posted and can't be edited." : "You can't edit this post.");
    if (wantsPlanning && !W.canEditPlanning(content, user))
      return fail(res, 403, "Only a supervisor can change the date, platform or person for this post.");

    let contentChanged = false;
    if (b.caption !== undefined)            { content.caption = String(b.caption).slice(0, 5000); contentChanged = true; }
    if (b.hashtags !== undefined)           { content.hashtags = cleanHashtags(b.hashtags); contentChanged = true; }
    if (b.firstComment !== undefined)       { content.firstComment = String(b.firstComment).slice(0, 2000); contentChanged = true; }
    if (b.contentDescription !== undefined) { content.contentDescription = String(b.contentDescription).slice(0, 2000); }
    if (b.postUrl !== undefined)            { content.postUrl = String(b.postUrl).slice(0, 1000); }
    let removedMedia = [];
    if (b.media !== undefined) {
      const next = cleanMedia(b.media);
      const keep = new Set(next.map(m => m.publicId));
      removedMedia = content.media.filter(m => !keep.has(m.publicId));
      content.media = next;
      contentChanged = true;
    }

    if (b.plannedPostDate !== undefined) {
      const day = String(b.plannedPostDate).slice(0, 10);
      if (!DAY_RE.test(day)) return fail(res, 400, "Choose a valid date.");
      if (day !== plannedDayOf(content.plannedPostDate)) addHistory(content, "rescheduled", user, `Moved to ${day}`);
      content.plannedPostDate = plannedDateFromDay(day);
    }
    if (b.plannedTime !== undefined) {
      if (b.plannedTime && !TIME_RE.test(b.plannedTime)) return fail(res, 400, "Time must be HH:mm.");
      content.plannedTime = b.plannedTime || "";
    }
    if (b.platform !== undefined) {
      if (!SocialContent.PLATFORMS.includes(b.platform)) return fail(res, 400, "Choose a platform.");
      content.platform = b.platform;
    }
    if (b.socialProject !== undefined && W.isSupervisor(user)) {
      const project = isId(b.socialProject) && await SocialProject.findById(b.socialProject);
      if (!project) return fail(res, 404, "Social project not found.");
      content.socialProject = project._id; content.title = project.name;
    }
    if (b.assignedTo !== undefined && W.isSupervisor(user) && String(b.assignedTo) !== W.idOf(content.assignedTo)) {
      const person = isId(b.assignedTo) && await User.findById(b.assignedTo).select("_id name isDeleted");
      if (!person || person.isDeleted) return fail(res, 404, "That person was not found.");
      content.assignedTo = person._id;
      await notify([person._id], { type: "content_assigned", sender: user, relatedId: content._id,
        message: `${user.name} assigned you a ${content.platform} post for ${content.title}.` });
    }

    if (contentChanged) addHistory(content, "edited", user);

    // An approved post edited by the intern goes back for approval.
    const project = await SocialProject.findById(W.idOf(content.socialProject));
    if (contentChanged && content.status === "Approved" && !W.isSupervisor(user) && W.needsApproval(project) && !content.routine) {
      content.status = "Pending Approval";
      content.approval.submittedAt = new Date(); content.approval.submittedBy = user._id;
      addHistory(content, "submitted", user, "Changed after approval");
      await notify(await approversFor(content, project), { type: "approval_requested", sender: user, relatedId: content._id,
        message: `${user.name} changed an approved ${content.platform} post for ${content.title}. It needs approval again.` });
    }

    // Rescheduling a missed post to a future time revives it.
    if (wantsPlanning) {
      const due = W.computeDueAt(content.plannedPostDate, content.plannedTime);
      if (content.status === "Missed" && due > new Date())
        content.status = content.approval?.reviewedAt && !content.approval?.rejectionReason ? "Approved" : "Planned";
    }

    await content.save();
    await Promise.all(removedMedia.map(destroyMedia));
    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, user, { full: true }) });
  } catch (err) { next(err); }
};

// ── PATCH /api/social/:id/submit ────────────────────────────────────────────
exports.submitForApproval = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canSubmit(content, req.user)) return fail(res, 400, `A post that is "${content.status}" can't be submitted.`);
    if (!String(content.caption || "").trim() && !content.media.length)
      return fail(res, 400, "Add a caption or an image before submitting.");

    const project = content.socialProject;
    content.status = W.statusAfterSubmit(project);
    content.approval.submittedAt = new Date();
    content.approval.submittedBy = req.user._id;
    content.approval.rejectionReason = "";
    if (content.status === "Approved") {
      content.approval.reviewedAt = new Date(); content.approval.reviewedBy = req.user._id;
      addHistory(content, "approved", req.user, "No approval needed for this project");
    } else {
      addHistory(content, "submitted", req.user);
    }
    await content.save();

    if (content.status === "Pending Approval") {
      await notify(await approversFor(content, project), {
        type: "approval_requested", sender: req.user, relatedId: content._id,
        message: `${req.user.name} sent a ${content.platform} post for ${content.title} for approval.`,
      });
    }
    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── PATCH /api/social/:id/approve ───────────────────────────────────────────
exports.approveContent = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canApprove(content, req.user))
      return fail(res, W.isSupervisor(req.user) ? 400 : 403,
        W.isSupervisor(req.user) ? `A post that is "${content.status}" can't be approved.` : "Only supervisors can approve posts.");
    content.status = "Approved";
    content.approval.reviewedAt = new Date();
    content.approval.reviewedBy = req.user._id;
    content.approval.rejectionReason = "";
    addHistory(content, "approved", req.user, String(req.body?.note || "").slice(0, 500));
    await content.save();
    await notify([content.assignedTo], { type: "content_approved", sender: req.user, relatedId: content._id,
      message: `${req.user.name} approved your ${content.platform} post for ${content.title}. It's ready to post.` });
    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── PATCH /api/social/:id/reject  { reason } ────────────────────────────────
exports.rejectContent = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canReject(content, req.user))
      return fail(res, W.isSupervisor(req.user) ? 400 : 403,
        W.isSupervisor(req.user) ? `A post that is "${content.status}" can't be sent back.` : "Only supervisors can reject posts.");
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return fail(res, 400, "Say what needs to change.");
    content.status = "Rejected";
    content.approval.reviewedAt = new Date();
    content.approval.reviewedBy = req.user._id;
    content.approval.rejectionReason = reason.slice(0, 1000);
    addHistory(content, "rejected", req.user, reason.slice(0, 1000));
    await content.save();
    await notify([content.assignedTo], { type: "content_rejected", sender: req.user, relatedId: content._id,
      message: `${req.user.name} sent back your ${content.platform} post for ${content.title}: "${reason.slice(0, 140)}"` });
    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── PATCH /api/social/:id/mark-posted  { postUrl } ──────────────────────────
exports.markAsPosted = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canMarkPosted(content, content.socialProject, req.user)) {
      if (["Posted", "Reviewed"].includes(content.status)) return fail(res, 400, "This post is already marked as posted.");
      return fail(res, 400, "This post needs to be approved before it's posted.");
    }
    const now = new Date();
    content.status = "Posted";
    content.actualPostDate = now;
    content.postedLate = !!(content.dueAt && now > content.dueAt);
    if (req.body?.postUrl) content.postUrl = String(req.body.postUrl).slice(0, 1000);
    addHistory(content, "posted", req.user, content.postedLate ? "Posted late" : "");
    await content.save();
    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, req.user, { full: true }), message: "Marked as posted" });
  } catch (err) { next(err); }
};

// ── PATCH /api/social/:id/performance ───────────────────────────────────────
exports.submitPerformance = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canAddMetrics(content, req.user)) return fail(res, 400, "Results can only be added after the post is posted.");

    const num = (v) => Math.max(0, parseInt(v, 10) || 0);
    const v = num(req.body.views), l = num(req.body.likes), cm = num(req.body.comments), s = num(req.body.shares);
    content.metrics = {
      views: v, likes: l, comments: cm, shares: s,
      engagementRate:   v > 0 ? parseFloat((((l + cm + s) / v) * 100).toFixed(2)) : 0,
      performanceScore: v + (l * 2) + (cm * 3),
    };
    content.performanceCheckedAt = new Date();
    content.status = "Reviewed";
    addHistory(content, "metrics", req.user);
    await content.save();

    const supervisors = await User.find({ role: "supervisor", isDeleted: { $ne: true } }).select("_id");
    await notify(supervisors.map(s => s._id), { type: "performance_submitted", sender: req.user, relatedId: content._id,
      message: `${req.user.name} added results for the ${content.platform} post for ${content.title}.` });

    const full = await populateFull(SocialContent.findById(content._id));
    res.json({ success: true, data: present(full, req.user, { full: true }), message: "Results saved" });
  } catch (err) { next(err); }
};

// ── POST /api/social/:id/comments  { text } ─────────────────────────────────
exports.addComment = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    const text = String(req.body?.text || "").trim();
    if (!text) return fail(res, 400, "Write a comment first.");
    content.comments.push({ author: req.user._id, text: text.slice(0, 2000) });
    await content.save();

    const people = [content.assignedTo, content.assignedBy, ...content.comments.map(c => c.author)];
    await notify(people, { type: "content_comment", sender: req.user, relatedId: content._id,
      message: `${req.user.name} commented on the ${content.platform} post for ${content.title}: "${text.slice(0, 120)}"` });

    const full = await populateFull(SocialContent.findById(content._id));
    res.status(201).json({ success: true, data: present(full, req.user, { full: true }) });
  } catch (err) { next(err); }
};

// ── DELETE /api/social/:id ──────────────────────────────────────────────────
exports.deleteContent = async (req, res, next) => {
  try {
    const content = await loadForUser(req, res);
    if (!content) return;
    if (!W.canDelete(content, req.user)) return fail(res, 403, "You can't delete this post.");
    await Promise.all((content.media || []).map(destroyMedia));
    await SocialContent.deleteOne({ _id: content._id });
    await Notification.deleteMany({ relatedId: content._id, relatedModel: "SocialContent" });
    res.json({ success: true, message: "Post deleted" });
  } catch (err) { next(err); }
};

// ── POST /api/social/media  (multipart "file") ──────────────────────────────
exports.uploadMedia = (req, res) => {
  if (!req.file) return fail(res, 400, "Choose an image or video.");
  res.status(201).json({
    success: true,
    media: {
      name: req.file.originalname, size: req.file.size || 0, type: req.file.mimetype || "",
      url: req.file.path, publicId: req.file.filename, resourceType: resourceTypeFromUrl(req.file.path),
    },
  });
};

// ── DELETE /api/social/media  { publicId, resourceType } – discard an unsaved upload
exports.discardMedia = async (req, res, next) => {
  try {
    const { publicId, resourceType } = req.body || {};
    if (!String(publicId || "").startsWith(`egi/social/social-${req.user._id}-`))
      return fail(res, 403, "You can only discard your own uploads.");
    const used = await SocialContent.exists({ "media.publicId": publicId });
    if (!used) await destroyMedia({ publicId, resourceType });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── GET /api/social/dashboard ───────────────────────────────────────────────
exports.getDashboardStats = async (req, res, next) => {
  try {
    const filter = await visibilityFilter(req);
    const counts = await SocialContent.aggregate([{ $match: filter }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map(c => [c._id, c.n]));
    const total = counts.reduce((s, c) => s + c.n, 0);

    const topPerformers = await SocialContent.find({
      ...filter,
      status: { $in: ["Posted", "Reviewed"] },
      "metrics.performanceScore": { $gt: 0 },
      actualPostDate: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    })
      .select("-history -comments")
      .sort({ "metrics.performanceScore": -1 })
      .limit(5)
      .populate("assignedTo", "name")
      .populate("socialProject", "name");

    const platformBreakdown = await SocialContent.aggregate([
      { $match: filter },
      { $group: { _id: "$platform", count: { $sum: 1 }, missed: { $sum: { $cond: [{ $eq: ["$status", "Missed"] }, 1, 0] } } } },
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          total,
          planned:         by["Planned"] || 0,
          pendingApproval: by["Pending Approval"] || 0,
          approved:        by["Approved"] || 0,
          rejected:        by["Rejected"] || 0,
          posted:          by["Posted"] || 0,
          reviewed:        by["Reviewed"] || 0,
          missed:          by["Missed"] || 0,
          pendingReview:   by["Reviewed"] || 0,   // kept for older clients
        },
        topPerformers,
        platformBreakdown,
      },
    });
  } catch (err) { next(err); }
};
