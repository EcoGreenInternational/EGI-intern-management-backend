// routes/diary.js – every route is scoped to the logged-in user's own entries.
const express    = require("express");
const multer     = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const router     = express.Router();
const DiaryEntry = require("../models/DiaryEntry");
const cloudinary = require("../config/cloudinary");
const { protect } = require("../middleware/auth");

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Cloudinary upload (egi/diary/diary-<userId>-<timestamp>) ─────────────────
const diaryUpload = multer({
  storage: new CloudinaryStorage({
    cloudinary,
    params: async (req) => ({
      folder:        "egi/diary",
      public_id:     `diary-${req.user._id}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      resource_type: "auto",
    }),
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

// Cloudinary URLs look like https://res.cloudinary.com/<cloud>/<image|raw|video>/upload/...
const resourceTypeFromUrl = (url = "") => {
  const m = /\/(image|raw|video)\/upload\//.exec(url);
  return m ? m[1] : "image";
};

// An attachment belongs to the user if its public_id was created for them above.
const ownsPublicId = (user, publicId = "") =>
  String(publicId).startsWith(`egi/diary/diary-${user._id}-`);

const destroyAttachment = async ({ publicId, resourceType }) => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: resourceType || "image" }); }
  catch (e) { console.error("[diary] Cloudinary delete failed:", e.message); }
};

// Only keep attachments that were uploaded through this API for this user.
const cleanAttachments = (user, list) =>
  (Array.isArray(list) ? list : [])
    .filter(a => a && a.url && ownsPublicId(user, a.publicId))
    .map(a => ({
      name:         String(a.name || "file").slice(0, 255),
      size:         Number(a.size) || 0,
      type:         String(a.type || ""),
      url:          String(a.url),
      publicId:     String(a.publicId),
      resourceType: ["image", "raw", "video"].includes(a.resourceType) ? a.resourceType : resourceTypeFromUrl(a.url),
    }));

const cleanEntry = (user, body = {}) => {
  const out = {};
  if (body.date !== undefined)        out.date    = String(body.date);
  if (body.title !== undefined)       out.title   = String(body.title || "");
  if (body.content !== undefined)     out.content = String(body.content || "");
  if (body.mood !== undefined)        out.mood    = String(body.mood || "");
  if (body.tags !== undefined)        out.tags    = (Array.isArray(body.tags) ? body.tags : []).map(String).slice(0, 30);
  if (body.attachments !== undefined) out.attachments = cleanAttachments(user, body.attachments);
  return out;
};

router.use(protect);

// GET /api/diary – my entries, newest first
router.get("/", async (req, res, next) => {
  try {
    const entries = await DiaryEntry.find({ user: req.user._id }).sort({ date: -1, createdAt: -1 });
    res.json({ success: true, entries });
  } catch (err) { next(err); }
});

// POST /api/diary/attachments – upload one file (field "file"), returns attachment metadata
router.post("/attachments", (req, res, next) => {
  diaryUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)." : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided." });
    res.status(201).json({
      success: true,
      attachment: {
        name:         req.file.originalname,
        size:         req.file.size || 0,
        type:         req.file.mimetype || "",
        url:          req.file.path,
        publicId:     req.file.filename,
        resourceType: resourceTypeFromUrl(req.file.path),
      },
    });
  });
});

// DELETE /api/diary/attachments – discard an upload that was never saved to an entry
router.delete("/attachments", async (req, res, next) => {
  try {
    const { publicId } = req.body || {};
    if (!ownsPublicId(req.user, publicId))
      return res.status(403).json({ success: false, message: "Not your attachment." });
    const inUse = await DiaryEntry.exists({ user: req.user._id, "attachments.publicId": publicId });
    if (!inUse) {
      const resourceType = ["image", "raw", "video"].includes(req.body.resourceType) ? req.body.resourceType : "image";
      await destroyAttachment({ publicId, resourceType });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/diary – create
router.post("/", async (req, res, next) => {
  try {
    const data = cleanEntry(req.user, req.body);
    if (!data.date || !DATE_RE.test(data.date))
      return res.status(400).json({ success: false, message: "A valid date (YYYY-MM-DD) is required." });

    const legacyId = req.body.legacyId ? String(req.body.legacyId) : null;
    if (legacyId) {
      const existing = await DiaryEntry.findOne({ user: req.user._id, legacyId });
      if (existing) return res.json({ success: true, entry: existing, duplicate: true });
    }

    const entry = await DiaryEntry.create({ ...data, legacyId, user: req.user._id });
    res.status(201).json({ success: true, entry });
  } catch (err) { next(err); }
});

// PUT /api/diary/:id – update my entry
router.put("/:id", async (req, res, next) => {
  try {
    const entry = await DiaryEntry.findOne({ _id: req.params.id, user: req.user._id });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found." });

    const data = cleanEntry(req.user, req.body);
    if (data.date !== undefined && !DATE_RE.test(data.date))
      return res.status(400).json({ success: false, message: "A valid date (YYYY-MM-DD) is required." });

    // Delete files that were removed from the entry.
    if (data.attachments) {
      const keep = new Set(data.attachments.map(a => a.publicId));
      await Promise.all(entry.attachments.filter(a => !keep.has(a.publicId)).map(destroyAttachment));
    }

    Object.assign(entry, data);
    await entry.save();
    res.json({ success: true, entry });
  } catch (err) { next(err); }
});

// DELETE /api/diary/:id – delete my entry and its files
router.delete("/:id", async (req, res, next) => {
  try {
    const entry = await DiaryEntry.findOne({ _id: req.params.id, user: req.user._id });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found." });
    await Promise.all(entry.attachments.map(destroyAttachment));
    await entry.deleteOne();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
