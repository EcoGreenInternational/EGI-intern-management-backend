
const express = require("express");
const router  = express.Router();
const {
  login, register, getMe, changePassword, resetPassword,
} = require("../controllers/authController");
const { protect, restrictTo } = require("../middleware/auth");

router.post("/login",                          login);
router.post("/register",   protect, restrictTo("supervisor"), register);
router.get( "/me",         protect, getMe);
router.patch("/change-password", protect,      changePassword);

router.patch("/reset-password/:userId", protect, restrictTo("supervisor"), resetPassword);

// Senior supervisors can register other supervisors
router.post("/register-supervisor", protect, restrictTo("supervisor"), async (req, res, next) => {
  try {
    const caller = req.user;
    if (caller.supervisorLevel !== "senior")
      return res.status(403).json({ success: false, message: "Only senior supervisors can add supervisors." });

    const { name, username, password, supervisorLevel, email, contact, position, department } = req.body;
    if (!name || !username || !password || !email)
      return res.status(400).json({ success: false, message: "Name, username, password and email are required." });

    if (!["supervisor", "junior"].includes(supervisorLevel))
      return res.status(400).json({ success: false, message: "supervisorLevel must be 'supervisor' or 'junior'." });

    const User = require("../models/User");
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    let existingUser = await User.findOne({
      $or: [{ username: normalizedUsername }, { email: normalizedEmail }],
    });

    if (existingUser) {
      if (existingUser.isDeleted) {
        // If the user was soft-deleted, reactivate and promote them
        existingUser.name = name.trim();
        existingUser.username = normalizedUsername;
        existingUser.email = normalizedEmail;
        existingUser.password = password; // Will be hashed by pre-save hook
        existingUser.role = "supervisor";
        existingUser.supervisorLevel = supervisorLevel;
        existingUser.contact = contact || existingUser.contact || "";
        existingUser.position = position || existingUser.position || "";
        existingUser.department = department || existingUser.department || "";
        existingUser.isDeleted = false;
        existingUser.deletedAt = null;
        existingUser.mustChangePassword = true;
        await existingUser.save();

        return res.status(201).json({ success: true, user: existingUser.toSafeObject() });
      } else {
        return res.status(400).json({
          success: false,
          message: existingUser.username === normalizedUsername
            ? "A record with that username already exists."
            : "A record with that email already exists.",
        });
      }
    }

    const user = await User.create({
      name,
      username: normalizedUsername,
      password,
      role: "supervisor",
      supervisorLevel,
      email: normalizedEmail,
      contact: contact || "",
      position: position || "",
      department: department || "",
      avatar: name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
      avatarColor: "#1a6640",
      mustChangePassword: true,
      isDeleted: false,
      deletedAt: null,
    });

    res.status(201).json({ success: true, user: user.toSafeObject() });
  } catch (err) { next(err); }
});

// Senior supervisors can delete supervisors
router.delete("/supervisor/:id", protect, restrictTo("supervisor"), async (req, res, next) => {
  try {
    if (req.user.supervisorLevel !== "senior")
      return res.status(403).json({ success: false, message: "Only senior supervisors can remove supervisors." });
    
    const User = require("../models/User");
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();

    res.json({ success: true, message: "Supervisor removed." });
  } catch (err) { next(err); }
});
module.exports = router;