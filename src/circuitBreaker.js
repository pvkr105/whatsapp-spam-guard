// Safety net against a misconfigured rule wiping out a community: if a single
// rule takes more than maxActions live actions inside a sliding windowMinutes
// window, that rule is "tripped" and its further matches are demoted to
// log-only until an admin sends "bot resume <rule-id>" or restarts the bot.
// Legitimate spam waves rarely exceed a handful of messages in ten minutes; a
// rule matching normal conversation (e.g. a keyword list edited badly) blows
// past the threshold within minutes and gets stopped after bounded damage.
// State is in-memory on purpose: a restart is a deliberate human action and
// resets the breaker along with whatever config fix prompted it.

let settings = { enabled: true, maxActions: 10, windowMinutes: 10 };
const actionTimes = new Map(); // ruleId -> timestamps of recent live actions
const tripped = new Set();

function configure(options = {}) {
  settings = { ...settings, ...options };
  actionTimes.clear();
  tripped.clear();
}

// Call before every live action. Returns whether the action may proceed live,
// and whether this call is the one that tripped the breaker (so the caller can
// alert the admin exactly once).
function registerLiveAction(ruleId, now = Date.now()) {
  if (!settings.enabled) return { allowed: true, justTripped: false };
  if (tripped.has(ruleId)) return { allowed: false, justTripped: false };

  const windowMs = settings.windowMinutes * 60 * 1000;
  const recent = (actionTimes.get(ruleId) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  actionTimes.set(ruleId, recent);

  if (recent.length > settings.maxActions) {
    tripped.add(ruleId);
    return { allowed: false, justTripped: true };
  }
  return { allowed: true, justTripped: false };
}

function isTripped(ruleId) {
  return tripped.has(ruleId);
}

function trippedRules() {
  return [...tripped];
}

// Returns true if the rule was actually tripped (so the caller can word the
// admin reply accordingly).
function reset(ruleId) {
  actionTimes.delete(ruleId);
  return tripped.delete(ruleId);
}

function getSettings() {
  return { ...settings };
}

module.exports = { configure, registerLiveAction, isTripped, trippedRules, reset, getSettings };
