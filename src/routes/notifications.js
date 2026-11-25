// routes/notifications.js
const express = require("express");
const router  = express.Router();
const c = require("../controllers/notificationController");
const { protect } = require("../middleware/auth");

router.use(protect);
router.get("/",           c.getMine);
router.patch("/read-all", c.markAllRead);
router.patch("/:id/read", c.markRead);

module.exports = router;
