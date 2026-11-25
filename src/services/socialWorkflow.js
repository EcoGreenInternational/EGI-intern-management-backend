// services/socialWorkflow.js
// The social post workflow in one place (pure functions, no database):
//
//   Planned ──submit──▶ Pending Approval ──approve──▶ Approved ──mark posted──▶ Posted ──metrics──▶ Reviewed
//      ▲                     │ reject                      │ (edit by intern → back to Pending Approval)
//      └──── Rejected ◀──────┘                             │
//   (no approval needed for the project: submit goes straight to Approved)
//   Planned / Pending Approval / Approved / Rejected → Missed when the due time passes.
const { plannedDayOf, zonedToUtc, addDays } = require("../utils/zonedTime");

const STATUSES = ["Planned", "Pending Approval", "Approved", "Rejected", "Posted", "Missed", "Reviewed"];
const OPEN_STATUSES = ["Planned", "Pending Approval", "Approved", "Rejected"];   // can still become Missed
const MISSED_GRACE_MINUTES = parseInt(process.env.SOCIAL_MISSED_GRACE_MINUTES || "60", 10);

const isSupervisor = (user) => user?.role === "supervisor";
const idOf = (v) => String(v?._id || v || "");
const isAssignee  = (content, user) => idOf(content.assignedTo) === idOf(user);
const isCreator   = (content, user) => idOf(content.createdBy || content.assignedBy) === idOf(user);
const isMember    = (project, user) => (project?.assignedPersons || []).some(p => idOf(p) === idOf(user));
const needsApproval = (project) => project?.requireApproval !== false;

// When does a post count as missed?
//  - with a time: planned time + grace period (default 60 min)
//  - without a time: end of the planned day
function computeDueAt(plannedPostDate, plannedTime) {
  const day = plannedDayOf(plannedPostDate);
  if (!day) return null;
  if (plannedTime) return new Date(zonedToUtc(day, plannedTime).getTime() + MISSED_GRACE_MINUTES * 60000);
  return zonedToUtc(addDays(day, 1), "00:00");
}

const canView = (content, project, user) =>
  isSupervisor(user) || isAssignee(content, user) || isMember(project, user);

// Content fields (caption etc.) – supervisor always; assignee while not yet posted.
const canEditContent = (content, user) =>
  isSupervisor(user) || (isAssignee(content, user) && OPEN_STATUSES.includes(content.status));

// Date/time, project, platform, assignee – supervisors, or the intern who created their own draft.
const canEditPlanning = (content, user) =>
  isSupervisor(user) || (isAssignee(content, user) && isCreator(content, user) && ["Planned", "Rejected"].includes(content.status));

const canSubmit = (content, user) =>
  (isSupervisor(user) || isAssignee(content, user)) && ["Planned", "Rejected"].includes(content.status);

const canApprove = (content, user) =>
  isSupervisor(user) && ["Pending Approval", "Planned", "Rejected"].includes(content.status);

const canReject = (content, user) =>
  isSupervisor(user) && ["Pending Approval", "Approved"].includes(content.status);

function canMarkPosted(content, project, user) {
  if (!(isSupervisor(user) || isAssignee(content, user))) return false;
  if (["Posted", "Reviewed"].includes(content.status)) return false;
  if (isSupervisor(user)) return true;                                // supervisors may override
  if (content.status === "Approved") return true;
  if (!needsApproval(project) && ["Planned", "Rejected", "Missed"].includes(content.status)) return true;
  return content.status === "Missed" && !!content.approval?.reviewedAt && !content.approval?.rejectionReason;
}

const canAddMetrics = (content, user) =>
  (isSupervisor(user) || isAssignee(content, user)) && ["Posted", "Reviewed"].includes(content.status);

const canDelete = (content, user) =>
  isSupervisor(user) || (isAssignee(content, user) && isCreator(content, user) && ["Planned", "Rejected"].includes(content.status));

const statusAfterSubmit = (project) => (needsApproval(project) ? "Pending Approval" : "Approved");

// Allowed actions for the UI (same rules the API enforces).
function allowedActions(content, project, user) {
  return {
    edit:        canEditContent(content, user),
    editPlanning: canEditPlanning(content, user),
    submit:      canSubmit(content, user),
    approve:     canApprove(content, user),
    reject:      canReject(content, user),
    markPosted:  canMarkPosted(content, project, user),
    addMetrics:  canAddMetrics(content, user),
    delete:      canDelete(content, user),
  };
}

module.exports = {
  STATUSES, OPEN_STATUSES, MISSED_GRACE_MINUTES,
  isSupervisor, isAssignee, isCreator, isMember, needsApproval, idOf,
  computeDueAt, canView, canEditContent, canEditPlanning, canSubmit, canApprove,
  canReject, canMarkPosted, canAddMetrics, canDelete, statusAfterSubmit, allowedActions,
};
