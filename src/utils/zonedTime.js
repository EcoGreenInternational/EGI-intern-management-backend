// utils/zonedTime.js
// Date helpers that work in the company's time zone (APP_TIMEZONE, default
// Asia/Colombo) no matter what time zone the server itself runs in.
const APP_TZ = process.env.APP_TIMEZONE || "Asia/Colombo";

const pad = (n) => String(n).padStart(2, "0");

// Milliseconds the zone is ahead of UTC at a given instant.
function tzOffsetMs(date, tz = APP_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// "2026-11-25" + "18:30" in the company zone → the real instant (Date).
function zonedToUtc(dateStr, timeStr = "00:00", tz = APP_TZ) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi]    = (timeStr || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(t), tz);       // correct across DST changes
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}

// Today's date ("YYYY-MM-DD") in the company zone.
function todayInTz(now = new Date(), tz = APP_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 0 = Sunday … 6 = Saturday
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

// Planned post dates are stored as UTC midnight of the chosen calendar day.
const plannedDayOf = (plannedPostDate) =>
  plannedPostDate ? new Date(plannedPostDate).toISOString().slice(0, 10) : null;
const plannedDateFromDay = (dateStr) => new Date(`${dateStr}T00:00:00Z`);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE  = /^\d{4}-\d{2}-\d{2}$/;

module.exports = {
  APP_TZ, tzOffsetMs, zonedToUtc, todayInTz, addDays, weekdayOf,
  plannedDayOf, plannedDateFromDay, TIME_RE, DAY_RE,
};
