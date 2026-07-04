const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'logs', 'pending-review.json');

function load() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function add(entry) {
  const store = load();
  const ids = Object.keys(store).map(Number);
  const id = String(ids.length ? Math.max(...ids) + 1 : 1);
  store[id] = entry;
  save(store);
  return id;
}

function take(id) {
  const store = load();
  const entry = store[id];
  if (entry) {
    delete store[id];
    save(store);
  }
  return entry;
}

function pruneExpired(maxAgeMs) {
  const store = load();
  const now = Date.now();
  let changed = false;
  for (const [id, entry] of Object.entries(store)) {
    if (now - entry.ts > maxAgeMs) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) save(store);
}

function list() {
  return Object.entries(load()).map(([id, entry]) => ({ id, ...entry }));
}

// Reviews that have sat unanswered longer than olderThanMs and haven't been
// reminded about yet. The caller sends the reminder and calls markReminded so
// each review only ever generates one reminder.
function dueForReminder(olderThanMs, now = Date.now()) {
  return list().filter((e) => !e.remindedAt && now - e.ts > olderThanMs);
}

function markReminded(id) {
  const store = load();
  if (store[id]) {
    store[id].remindedAt = Date.now();
    save(store);
  }
}

module.exports = { add, take, pruneExpired, list, dueForReminder, markReminded };
