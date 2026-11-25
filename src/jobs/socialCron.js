// src/jobs/socialCron.js
// - every 15 min: mark posts Missed once their due time has passed
// - hourly + on start: create today's and tomorrow's routine posts
// - daily 09:00 (company time): one reminder to add results 7 days after posting
const cron          = require("node-cron");
const SocialContent = require("../models/SocialContent");
const W             = require("../services/socialWorkflow");
const { notify }    = require("../services/notify");
const { generateRoutinePosts } = require("../services/routineGenerator");
const { APP_TZ }    = require("../utils/zonedTime");

async function markMissedPosts(now = new Date()) {
  const candidates = await SocialContent.find({
    status: { $in: W.OPEN_STATUSES },
    $or: [{ dueAt: { $lt: now } }, { dueAt: null }],
  });

  let count = 0;
  for (const content of candidates) {
    try {
      const due = content.dueAt || W.computeDueAt(content.plannedPostDate, content.plannedTime);
      if (!due || due >= now) { if (!content.dueAt && due) { content.dueAt = due; await content.save(); } continue; }
      content.status = "Missed";
      content.history.push({ action: "missed", by: null, at: now });
      await content.save();
      count++;
      await notify([content.assignedTo], {
        type: "missed_post", relatedId: content._id,
        message: `Your ${content.platform} post for ${content.title} wasn't posted on time. You can still post it and mark it as posted.`,
      });
    } catch (err) {
      console.error(`[SocialCron] Missed-post update failed for ${content._id}:`, err.message);
    }
  }
  if (count) console.log(`[SocialCron] Marked ${count} post(s) as Missed`);
  return count;
}

async function sendPerformanceReminders(now = new Date()) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const due = await SocialContent.find({
    status:                    "Posted",
    actualPostDate:            { $lte: sevenDaysAgo },
    performanceCheckedAt:      { $exists: false },
    performanceReminderSentAt: { $exists: false },
  });
  let count = 0;
  for (const content of due) {
    try {
      await notify([content.assignedTo], {
        type: "performance_due", relatedId: content._id,
        message: `It's been 7 days since your ${content.platform} post for ${content.title} went up. Add its results.`,
      });
      content.performanceReminderSentAt = now;
      await content.save();
      count++;
    } catch (err) {
      console.error(`[SocialCron] Reminder failed for ${content._id}:`, err.message);
    }
  }
  if (count) console.log(`[SocialCron] Sent ${count} 7-day reminder(s)`);
  return count;
}

const safe = (name, fn) => () => fn().catch(err => console.error(`[SocialCron] ${name}:`, err.message));

module.exports = function startSocialCron() {
  cron.schedule("*/15 * * * *", safe("missed", markMissedPosts), { timezone: APP_TZ });
  cron.schedule("5 * * * *",    safe("routines", () => generateRoutinePosts()), { timezone: APP_TZ });
  cron.schedule("0 9 * * *",    safe("reminders", sendPerformanceReminders), { timezone: APP_TZ });

  safe("routines", () => generateRoutinePosts())();   // on start
  safe("missed", markMissedPosts)();
  console.log(`[SocialCron] Social media jobs started (time zone ${APP_TZ})`);
};
module.exports.markMissedPosts = markMissedPosts;
module.exports.sendPerformanceReminders = sendPerformanceReminders;
