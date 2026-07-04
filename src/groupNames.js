const fs = require('fs');
const path = require('path');

const DUMP_PATH = path.join(__dirname, '..', 'logs', 'groups-dump.json');

let cache = null;

function loadNames() {
  if (cache) return cache;
  cache = new Map();
  if (!fs.existsSync(DUMP_PATH)) return cache;
  try {
    const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
    for (const g of dump) {
      if (g.jid && g.subject) cache.set(g.jid, g.subject.replace(/\s+/g, ' ').trim());
    }
  } catch {
    // Missing/stale dump just means we fall back to raw JIDs - not fatal.
  }
  return cache;
}

// Human-readable label for a group/community JID, e.g. "GR Accommodation Hub (120363...@g.us)".
// Falls back to the bare JID if it isn't in the cached groups-dump.json (run "npm run list-groups"
// again to refresh the cache after joining/creating new groups).
function labelFor(jid) {
  const name = loadNames().get(jid);
  return name ? `${name} (${jid})` : jid;
}

module.exports = { labelFor };
