// routes/users.js
const express  = require("express");
const router   = express.Router();
const {
  getAllUsers, getUser, updateUser, deleteUser, getUserStats,
  uploadProfilePicture, deleteProfilePicture,
  uploadUserDocument, deleteUserDocument,
  checkFileTarget,
} = require("../controllers/userController");
const { protect, restrictTo }  = require("../middleware/auth");
const { profileUpload, documentUpload, handleUpload, DOCUMENT_MAX_MB } = require("../middleware/uploadCloudinary");

router.use(protect);

router.get("/",          restrictTo("supervisor"), getAllUsers);
router.get("/:id",       getUser);
router.patch("/:id",     updateUser);
router.delete("/:id",    restrictTo("supervisor"), deleteUser);
router.get("/:id/stats", getUserStats);

// ── Profile picture ──────────────────────────────────────────────────────────
// checkFileTarget runs BEFORE the upload, so nothing reaches Cloudinary unless
// the user/docType is valid and the caller is allowed to change it.
router.post(   "/:id/profile-picture", checkFileTarget, handleUpload(profileUpload.single("profilePicture"), 5), uploadProfilePicture);
router.delete( "/:id/profile-picture", deleteProfilePicture);

// ── Employee documents (CV / Police Report / Grama Niladhari) ────────────────
// docType: "cv" | "policeReport" | "gramaNiladhari"
router.post(   "/:id/documents/:docType", checkFileTarget, handleUpload(documentUpload.single("document"), DOCUMENT_MAX_MB), uploadUserDocument);
router.delete( "/:id/documents/:docType", deleteUserDocument);

module.exports = router;