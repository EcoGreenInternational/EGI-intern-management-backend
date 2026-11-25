

const multer                = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary            = require("../config/cloudinary");


const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder:         "egi/profile-pictures",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    public_id:      `profile-${req.params.id}-${Date.now()}`,
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  }),
});

const profileFileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error("Only image files (jpg, png, webp, gif) are allowed."), false);
};

const profileUpload = multer({
  storage:    profileStorage,
  fileFilter: profileFileFilter,
  limits:     { fileSize: 5 * 1024 * 1024 },
});


// ── Employee documents (CV / Police Report / Grama Niladhari) ─────────────────
// PDFs and Word files are stored as Cloudinary "raw" files with their extension,
// so the browser can open them from the View button. (Many Cloudinary accounts
// block delivery of PDFs stored as "image", which made uploaded reports
// impossible to view.) Images stay "image" files.
const DOCUMENT_MAX_MB = 20;
const DOCUMENT_TYPES = {
  pdf:  { resourceType: "raw",   mimes: ["application/pdf"] },
  doc:  { resourceType: "raw",   mimes: ["application/msword"] },
  docx: { resourceType: "raw",   mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  jpg:  { resourceType: "image", mimes: ["image/jpeg"] },
  jpeg: { resourceType: "image", mimes: ["image/jpeg"] },
  png:  { resourceType: "image", mimes: ["image/png"] },
  webp: { resourceType: "image", mimes: ["image/webp"] },
};
// Word files are only accepted for the CV.
const WORD_ONLY_FOR = ["cv"];

const extOf = (name = "") => (String(name).split(".").pop() || "").toLowerCase();

const documentStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext  = extOf(file.originalname);
    const kind = DOCUMENT_TYPES[ext] || DOCUMENT_TYPES.pdf;
    const base = `doc-${req.params.id}-${req.params.docType || "document"}-${Date.now()}`;
    return kind.resourceType === "raw"
      ? { folder: "egi/documents", public_id: `${base}.${ext}`, resource_type: "raw" }
      : { folder: "egi/documents", public_id: base, resource_type: "image" };
  },
});

const documentFileFilter = (req, file, cb) => {
  const ext  = extOf(file.originalname);
  const kind = DOCUMENT_TYPES[ext];
  // Some browsers send a generic type, so the extension decides; a real mismatch is rejected.
  const mimeOk = kind && (kind.mimes.includes(file.mimetype) || ["application/octet-stream", ""].includes(file.mimetype || ""));
  if (!kind || !mimeOk)
    return cb(Object.assign(new Error("Allowed formats: PDF, JPG, PNG, WEBP (CV may also be DOC/DOCX)."), { statusCode: 400 }), false);
  if ((ext === "doc" || ext === "docx") && !WORD_ONLY_FOR.includes(req.params.docType))
    return cb(Object.assign(new Error("Police and Grama Niladhari reports must be a PDF or an image (JPG, PNG, WEBP)."), { statusCode: 400 }), false);
  cb(null, true);
};

const documentUpload = multer({
  storage:    documentStorage,
  fileFilter: documentFileFilter,
  limits:     { fileSize: DOCUMENT_MAX_MB * 1024 * 1024, files: 1 },
});


const generalStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder:        "egi/files",
    public_id:     `file-${req.user?._id || "unknown"}-${Date.now()}`,
    resource_type: "auto",
  }),
});

const generalUpload = multer({
  storage: generalStorage,
  limits:  { fileSize: 50 * 1024 * 1024 },
});

// ── Social post media (images / short videos) ───────────────────────────────
const SOCIAL_MEDIA_MAX_MB = 50;
const socialMediaUpload = multer({
  storage: new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder:        "egi/social",
      public_id:     `social-${req.user._id}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      resource_type: (file.mimetype || "").startsWith("video/") ? "video" : "image",
    }),
  }),
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) || /^video\/(mp4|quicktime|webm)$/.test(file.mimetype);
    if (ok) return cb(null, true);
    cb(Object.assign(new Error("Use an image (JPG, PNG, WEBP, GIF) or a video (MP4, MOV, WEBM)."), { statusCode: 400 }), false);
  },
  limits: { fileSize: SOCIAL_MEDIA_MAX_MB * 1024 * 1024, files: 1 },
});

// Run a multer middleware and turn its errors into clear 4xx/5xx JSON responses
// (they used to fall through to the generic "Internal server error.").
const handleUpload = (multerMiddleware, maxMB) => (req, res, next) => {
  // Refuse obviously oversized requests before anything is sent to Cloudinary
  // (1 MB allowance for the multipart envelope).
  const declared = parseInt(req.headers["content-length"], 10);
  if (declared > (maxMB + 1) * 1024 * 1024)
    return res.status(413).json({ success: false, message: `File is too large. Maximum size is ${maxMB} MB.` });

  return multerMiddleware(req, res, (err) => {
    if (!err) return next();
    const httpCode = err.http_code || err.error?.http_code;
    let status  = err.statusCode || 400;
    let message = err.message || "Upload failed.";

    if (err.code === "LIMIT_FILE_SIZE") {
      message = `File is too large. Maximum size is ${maxMB} MB.`;
    } else if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
      message = "Please upload one file at a time.";
    } else if (httpCode || /api_key|api_secret|cloud_name|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(message)) {
      // Cloudinary/network problem: log the details, show a friendly message.
      console.error("[upload] File storage error:", httpCode || "", message);
      if (!httpCode || httpCode >= 500 || httpCode === 401 || httpCode === 403) {
        status  = 502;
        message = "File storage is not available right now. Please try again later.";
      }
    }
    res.status(status).json({ success: false, message });
  });
};

module.exports = { profileUpload, documentUpload, generalUpload, socialMediaUpload, handleUpload, DOCUMENT_MAX_MB, SOCIAL_MEDIA_MAX_MB };
