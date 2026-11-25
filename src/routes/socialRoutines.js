// routes/socialRoutines.js
const express = require("express");
const router  = express.Router();
const c = require("../controllers/socialRoutineController");
const { protect, restrictTo } = require("../middleware/auth");

router.use(protect);
router.get("/",       c.list);
router.post("/",      restrictTo("supervisor"), c.create);
router.put("/:id",    restrictTo("supervisor"), c.update);
router.delete("/:id", restrictTo("supervisor"), c.remove);

module.exports = router;
