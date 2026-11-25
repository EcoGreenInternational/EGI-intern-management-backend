// utils/leave.js
// A leave entry is a Task with isLeave = true. A multi-day leave is ONE task:
//   date         = first day ("YYYY-MM-DD")
//   leaveEndDate = last day  ("YYYY-MM-DD"), or "" for a single day.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEAVE_DAYS = 366;

const isValidDate = (s) => typeof s === "string" && DATE_RE.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));

// Whole days between two "YYYY-MM-DD" strings (UTC math, so no timezone drift).
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Last day of a task: leaveEndDate for a leave range, otherwise its own date.
const endDateOf = (t) => (t.isLeave && t.leaveEndDate && t.leaveEndDate > t.date ? t.leaveEndDate : t.date);

// Number of calendar days a leave entry covers (inclusive). 0 for normal tasks.
const leaveDayCount = (t) => {
  if (!t || !t.isLeave || !isValidDate(t.date)) return 0;
  return daysBetween(t.date, endDateOf(t)) + 1;
};

// Leave days that fall inside [start, end] (inclusive), e.g. one week.
const leaveDaysInRange = (t, start, end) => {
  if (!t || !t.isLeave || !isValidDate(t.date)) return 0;
  const from = t.date > start ? t.date : start;
  const last = endDateOf(t);
  const to   = last < end ? last : end;
  return to < from ? 0 : daysBetween(from, to) + 1;
};

// Mongo condition: tasks on a day in [start, end], plus leave ranges that overlap it.
// (leaveEndDate "" sorts before any date, so single-day entries never match the 2nd branch.)
const dateOverlapFilter = (start, end) => {
  const onDay = {};
  if (start) onDay.$gte = start;
  if (end)   onDay.$lte = end;
  const range = { isLeave: true, leaveEndDate: { $ne: "" } };
  if (start) range.leaveEndDate.$gte = start;
  if (end)   range.date = { $lte: end };
  return { $or: [{ date: onDay }, range] };
};

// Clean up a requested leave end date. Returns { leaveEndDate } or { error }.
const normaliseLeaveEnd = (isLeave, date, requestedEnd) => {
  if (!isLeave || !requestedEnd) return { leaveEndDate: "" };
  if (!isValidDate(requestedEnd)) return { error: "Leave end date must be a valid date (YYYY-MM-DD)." };
  if (!isValidDate(date))         return { error: "Leave start date must be a valid date (YYYY-MM-DD)." };
  if (requestedEnd < date)        return { error: "Leave end date cannot be before the start date." };
  if (requestedEnd === date)      return { leaveEndDate: "" };
  if (daysBetween(date, requestedEnd) + 1 > MAX_LEAVE_DAYS)
    return { error: `A leave range can be at most ${MAX_LEAVE_DAYS} days.` };
  return { leaveEndDate: requestedEnd };
};

module.exports = {
  isValidDate, daysBetween, endDateOf, leaveDayCount, leaveDaysInRange,
  dateOverlapFilter, normaliseLeaveEnd, MAX_LEAVE_DAYS,
};
