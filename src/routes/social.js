// routes/social.js
const express = require("express");
const router  = express.Router();
const c = require("../controllers/socialController");
const { protect, restrictTo } = require("../middleware/auth");
const { socialMediaUpload, handleUpload, SOCIAL_MEDIA_MAX_MB } = require("../middleware/uploadCloudinary");

router.use(protect);

// Fixed paths first (before /:id)
router.get("/dashboard", c.getDashboardStats);
router.post("/media",    handleUpload(socialMediaUpload.single("file"), SOCIAL_MEDIA_MAX_MB), c.uploadMedia);
router.delete("/media",  c.discardMedia);

router.route("/")
  .get(c.getAllContent)
  .post(c.createContent);          // supervisors assign; interns draft their own

router.route("/:id")
  .get(c.getContent)
  .put(c.updateContent)
  .delete(c.deleteContent);

// Workflow actions
router.patch("/:id/submit",      c.submitForApproval);
router.patch("/:id/approve",     restrictTo("supervisor"), c.approveContent);
router.patch("/:id/reject",      restrictTo("supervisor"), c.rejectContent);
router.patch("/:id/mark-posted", c.markAsPosted);
router.patch("/:id/performance", c.submitPerformance);
router.post("/:id/comments",     c.addComment);

module.exports = router;
