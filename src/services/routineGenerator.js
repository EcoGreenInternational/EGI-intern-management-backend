// services/routineGenerator.js
// Creates the day's post for every active routine, so daily posts appear
// automatically. Safe to run any number of times (one post per routine per day).
const SocialRoutine = require("../models/SocialRoutine");
const SocialContent = require("../models/SocialContent");
const SocialProject = require("../models/SocialProject");
const { todayInTz, addDays, weekdayOf, plannedDateFromDay } = require("../utils/zonedTime");

// Pure: which of the given days does this routine post on?
function routineDays(routine, days) {
  return days.filter(day =>
    day >= routine.startDate &&
    (!routine.endDate || day <= routine.endDate) &&
    (routine.daysOfWeek || []).includes(weekdayOf(day))
  );
}

// Pure: the post to create for one routine day.
function postFromRoutine(routine, project, day) {
  return {
    socialProject:      routine.socialProject._id || routine.socialProject,
    title:              project?.name || routine.name,
    platform:           routine.platform,
    contentDescription: routine.contentDescription || routine.name,
    caption:            routine.caption || "",
    hashtags:           routine.hashtags || [],
    firstComment:       routine.firstComment || "",
    plannedPostDate:    plannedDateFromDay(day),
    plannedTime:        routine.time || "",
    status:             routine.autoApproved ? "Approved" : "Planned",
    assignedTo:         routine.assignedTo,
    assignedBy:         routine.createdBy,
    createdBy:          routine.createdBy,
    routine:            routine._id,
    routineDate:        day,
    history: [{ action: "created", by: routine.createdBy, note: `Created from routine "${routine.name}"` }],
  };
}

/**
 * Generate posts for today and the next `daysAhead` days.
 * Pass { routineId } to generate for one routine only.
 */
async function generateRoutinePosts({ daysAhead = 1, routineId = null, now = new Date() } = {}) {
  const today = todayInTz(now);
  const days  = Array.from({ length: daysAhead + 1 }, (_, i) => addDays(today, i));
  const query = { active: true, ...(routineId ? { _id: routineId } : {}) };
  const routines = await SocialRoutine.find(query);

  let created = 0;
  for (const routine of routines) {
    const project = await SocialProject.findById(routine.socialProject).select("name isActive");
    if (!project || project.isActive === false) continue;
    for (const day of routineDays(routine, days)) {
      const exists = await SocialContent.exists({ routine: routine._id, routineDate: day });
      if (exists) continue;
      try {
        await SocialContent.create(postFromRoutine(routine, project, day));
        created++;
      } catch (err) {
        if (err.code !== 11000) console.error(`[routines] ${routine.name} ${day}:`, err.message); // 11000 = created by a parallel run
      }
    }
  }
  if (created) console.log(`[routines] created ${created} routine post(s) for ${days.join(", ")}`);
  return { created, days };
}

// When a routine is paused, deleted or changed: remove its upcoming posts that
// nobody has started (no caption change, not submitted/posted).
async function removeUpcomingRoutinePosts(routineId, now = new Date()) {
  const res = await SocialContent.deleteMany({
    routine: routineId,
    status: { $in: ["Planned", "Approved"] },
    dueAt: { $gt: now },
    "approval.submittedAt": null,
    comments: { $size: 0 },
    history:  { $size: 1 },      // only the "created" entry: nobody has edited it yet
  });
  return res.deletedCount || 0;
}

module.exports = { generateRoutinePosts, removeUpcomingRoutinePosts, routineDays, postFromRoutine };
