// src/jobs/socialCron.js
const cron          = require("node-cron");
const SocialContent = require("../models/SocialContent");
const Notification  = require("../models/Notification");

const notify = async (io, content, type, message, socketMessage) => {
  await Notification.create({
    recipient:    content.assignedTo,
    type,
    message,
    relatedId:    content._id,
    relatedModel: "SocialContent",
  });
  if (io) io.to(`user:${content.assignedTo}`).emit("notification", { type, message: socketMessage });
};

module.exports = function startSocialCron(io) {

  // ── Every hour: mark missed posts ─────────────────────────────────────────
  cron.schedule("0 * * * *", async () => {
    try {
      const missed = await SocialContent.find({
        status:          "Planned",
        plannedPostDate: { $lt: new Date() },
      });

      let count = 0;
      for (const content of missed) {
        // One bad record must not stop the rest of the batch.
        try {
          content.status = "Missed";
          await content.save();
          count++;
          await notify(
            io, content, "missed_post",
            `Your post "${content.title}" on ${content.platform} was not posted on time.`,
            `Missed post: "${content.title}"`
          );
        } catch (err) {
          console.error(`[SocialCron] Missed-post update failed for ${content._id}:`, err.message);
        }
      }

      if (count > 0) console.log(`[SocialCron] Marked ${count} post(s) as Missed`);
    } catch (err) {
      console.error("[SocialCron] Missed post check error:", err.message);
    }
  });

  // ── Daily at 9am: 7-day performance reminders (sent once per post) ────────
  cron.schedule("0 9 * * *", async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const due = await SocialContent.find({
        status:                    "Posted",
        actualPostDate:            { $lte: sevenDaysAgo },
        performanceCheckedAt:      { $exists: false },
        performanceReminderSentAt: { $exists: false },
      });

      let count = 0;
      for (const content of due) {
        try {
          await notify(
            io, content, "performance_due",
            `7 days have passed since "${content.title}" was posted. Please add performance data.`,
            `Performance data due: "${content.title}"`
          );
          content.performanceReminderSentAt = new Date();
          await content.save();
          count++;
        } catch (err) {
          console.error(`[SocialCron] Reminder failed for ${content._id}:`, err.message);
        }
      }

      if (count > 0) console.log(`[SocialCron] Sent ${count} 7-day reminder(s)`);
    } catch (err) {
      console.error("[SocialCron] 7-day reminder error:", err.message);
    }
  });

  console.log("[SocialCron] Social media cron jobs started");
};
