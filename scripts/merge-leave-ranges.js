// scripts/merge-leave-ranges.js
// One-time clean-up: before leave ranges were stored as one task, a range was
// saved as one task PER DAY. This merges those day-by-day entries back into a
// single range entry, so old leave shows as one row like new leave does.
//
// It only merges entries that were clearly created together:
//   same person, same reason, same creator, consecutive dates,
//   and created within 2 minutes of each other (one "Mark Leave" save).
// Merged-away entries are SOFT-deleted (isDeleted = true), not removed.
//
// Usage (from the backend folder, uses MONGO_URI from .env):
//   node scripts/merge-leave-ranges.js          # dry run: only prints what it would do
//   node scripts/merge-leave-ranges.js --apply  # makes the changes
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const CREATED_TOGETHER_MS = 2 * 60 * 1000;

const nextDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

// Pure planning step (exported for testing). Input: single-day leave tasks.
// Output: [{ keep: task, endDate, remove: [tasks] }]
function planMerges(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    const key = [t.assignedTo, t.createdBy, (t.leaveReason || "").trim()].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const plans = [];
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // batches of entries saved together
    const batches = [];
    for (const t of list) {
      const last = batches[batches.length - 1];
      if (last && new Date(t.createdAt) - new Date(last[0].createdAt) <= CREATED_TOGETHER_MS) last.push(t);
      else batches.push([t]);
    }

    for (const batch of batches) {
      const byDate = [...new Map(batch.map(t => [t.date, t])).values()]
        .sort((a, b) => a.date.localeCompare(b.date));
      let run = [byDate[0]];
      const flush = () => {
        if (run.length > 1) plans.push({ keep: run[0], endDate: run[run.length - 1].date, remove: run.slice(1) });
      };
      for (let i = 1; i < byDate.length; i++) {
        if (byDate[i].date === nextDay(run[run.length - 1].date)) run.push(byDate[i]);
        else { flush(); run = [byDate[i]]; }
      }
      flush();
      // exact duplicates of the same date in one batch are removed too
      const kept = new Set(byDate.map(t => String(t._id)));
      const dups = batch.filter(t => !kept.has(String(t._id)));
      if (dups.length) plans.push({ keep: null, endDate: null, remove: dups, duplicate: true });
    }
  }
  return plans;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.MONGO_URI) { console.error("MONGO_URI is not set (.env)"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const Task = require("../src/models/Task");

  const tasks = await Task.find({
    isLeave: true,
    isDeleted: { $ne: true },
    $or: [{ leaveEndDate: "" }, { leaveEndDate: null }, { leaveEndDate: { $exists: false } }],
  }).select("_id date assignedTo createdBy leaveReason createdAt").lean();

  const plans = planMerges(tasks);
  let merged = 0, removed = 0;
  for (const p of plans) {
    if (p.duplicate) {
      console.log(`  duplicate entries: ${p.remove.map(t => `${t.date} (${t._id})`).join(", ")}`);
    } else {
      console.log(`  ${p.keep.date} → ${p.endDate}  (${p.remove.length + 1} days, person ${p.keep.assignedTo})`);
    }
    if (apply) {
      if (p.keep) await Task.updateOne({ _id: p.keep._id }, { $set: { leaveEndDate: p.endDate } });
      await Task.updateMany(
        { _id: { $in: p.remove.map(t => t._id) } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
      );
    }
    if (p.keep) merged++;
    removed += p.remove.length;
  }

  console.log(`\n${apply ? "Done" : "Dry run"}: ${merged} leave range(s), ${removed} day entr${removed === 1 ? "y" : "ies"} ${apply ? "merged" : "would be merged"}.`);
  if (!apply && plans.length) console.log("Run again with --apply to make these changes.");
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
module.exports = { planMerges };
