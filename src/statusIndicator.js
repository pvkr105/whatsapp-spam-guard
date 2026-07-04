// Terminal status indicator so whoever is watching the bot can tell at a glance
// whether it's live, reconnecting, or needs attention. Design constraint: pino
// writes to stdout from a transport worker thread, so a persistent bottom
// "status bar" (cursor save/restore) would interleave with log writes and garble
// both. Instead: a colored status line on every state change, a periodic
// heartbeat line with activity counters, and (in a real terminal only) the tab
// title mirrors the current state. Everything goes through the main logger, so
// status lines land in both the terminal and combined.log.

const STATES = {
  connecting: { icon: '🟡', label: 'Connecting to WhatsApp...' },
  online: { icon: '🟢', label: 'LIVE - watching for spam' },
  reconnecting: { icon: '🟡', label: 'Connection lost - reconnecting' },
  'logged-out': { icon: '🔴', label: 'NEEDS ATTENTION: logged out - delete the auth/ folder and restart to re-pair' },
};

const counters = { checked: 0, spam: 0, review: 0 };
let current = null;
let currentDetail = '';
let startedAt = Date.now();
let log = null;
let heartbeatTimer = null;

function formatUptime(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusLine() {
  const s = STATES[current] || { icon: '⚪', label: current ? String(current) : 'starting up' };
  return `${s.icon} ${s.label}${currentDetail ? ` (${currentDetail})` : ''}`;
}

function summaryLine() {
  return (
    `${statusLine()} | up ${formatUptime(Date.now() - startedAt)} | ` +
    `${counters.checked} messages checked, ${counters.spam} spam actioned, ${counters.review} flagged for review`
  );
}

function setTitle() {
  if (!process.stdout.isTTY) return;
  const s = STATES[current];
  if (s) process.stdout.write(`\x1b]0;spam-guard ${s.icon} ${current}\x07`);
}

function setState(name, detail = '') {
  if (name === current && detail === currentDetail) {
    // Repeated same-state calls (e.g. each reconnect attempt) shouldn't spam the log.
    setTitle();
    return;
  }
  current = name;
  currentDetail = detail;
  setTitle();
  if (!log) return;
  const line = statusLine();
  if (name === 'logged-out') log.error(line);
  else if (name === 'reconnecting') log.warn(line);
  else log.info(line);
}

function init({ logger, heartbeatMinutes = 30 }) {
  log = logger;
  startedAt = Date.now();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (heartbeatMinutes > 0) {
    heartbeatTimer = setInterval(() => {
      if (log && current) log.info(summaryLine());
    }, heartbeatMinutes * 60 * 1000);
    // The heartbeat must never be the thing keeping the process alive.
    heartbeatTimer.unref();
  }
}

function countChecked() {
  counters.checked += 1;
}

function countSpam() {
  counters.spam += 1;
}

function countReview() {
  counters.review += 1;
}

module.exports = { init, setState, countChecked, countSpam, countReview, statusLine, summaryLine, formatUptime };
