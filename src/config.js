const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

const JID_GROUP_RE = /@g\.us$/;
const JID_USER_RE = /@s\.whatsapp\.net$/;

function assertGroupJid(jid, field) {
  if (typeof jid !== 'string' || !JID_GROUP_RE.test(jid) || jid.startsWith('REPLACE_WITH')) {
    throw new Error(`config.json: ${field} must be a real group JID ending in @g.us (got "${jid}"). Run "npm run list-groups" to discover real JIDs.`);
  }
}

function assertUserJid(jid, field) {
  if (typeof jid !== 'string' || !JID_USER_RE.test(jid) || jid.startsWith('REPLACE_WITH')) {
    throw new Error(`config.json: ${field} must be a real user JID ending in @s.whatsapp.net (got "${jid}").`);
  }
}

function normalizeRule(rule, i) {
  const field = (name) => `rules[${i}].${name}`;

  if (typeof rule.id !== 'string' || !rule.id.trim()) {
    throw new Error(`config.json: ${field('id')} is required (a short name for this spam category, e.g. "investment-spam")`);
  }
  if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) {
    throw new Error(`config.json: ${field('keywords')} must be a non-empty array`);
  }
  if (typeof rule.linkPattern !== 'string' || !rule.linkPattern) {
    throw new Error(`config.json: ${field('linkPattern')} must be a non-empty regex string`);
  }

  const minKeywordMatches = typeof rule.minKeywordMatches === 'number' && rule.minKeywordMatches >= 0 ? rule.minKeywordMatches : 1;

  return {
    id: rule.id,
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    // Defaults to log-only so a rule someone adds without thinking about actionMode
    // can't accidentally start deleting messages and kicking people out.
    actionMode: rule.actionMode === 'live' ? 'live' : 'log-only',
    requireLink: typeof rule.requireLink === 'boolean' ? rule.requireLink : false,
    linkPattern: rule.linkPattern,
    keywords: rule.keywords,
    minKeywordMatches,
    reviewKeywordMatches:
      typeof rule.reviewKeywordMatches === 'number' && rule.reviewKeywordMatches >= 0
        ? rule.reviewKeywordMatches
        : Math.max(1, minKeywordMatches - 1),
  };
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config file at ${CONFIG_PATH}. Copy config/config.example.json to config/config.json and fill in your own values.`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }

  assertGroupJid(cfg.communityJid, 'communityJid');

  if (!Array.isArray(cfg.groupJids) || cfg.groupJids.length === 0) {
    throw new Error('config.json: groupJids must be a non-empty array');
  }
  cfg.groupJids.forEach((jid, i) => assertGroupJid(jid, `groupJids[${i}]`));

  if (!Array.isArray(cfg.adminJids) || cfg.adminJids.length === 0) {
    throw new Error('config.json: adminJids must be a non-empty array');
  }
  cfg.adminJids.forEach((jid, i) => assertUserJid(jid, `adminJids[${i}]`));

  if (!Array.isArray(cfg.allowlistJids)) {
    cfg.allowlistJids = [];
  }

  if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) {
    throw new Error('config.json: rules must be a non-empty array (each entry is a spam category to detect - see config/config.example.json)');
  }
  cfg.rules = cfg.rules.map(normalizeRule);

  const seenIds = new Set();
  for (const rule of cfg.rules) {
    if (seenIds.has(rule.id)) {
      throw new Error(`config.json: duplicate rule id "${rule.id}" - each rule needs a unique id`);
    }
    seenIds.add(rule.id);
  }

  const cb = cfg.circuitBreaker || {};
  const circuitBreaker = {
    enabled: typeof cb.enabled === 'boolean' ? cb.enabled : true,
    maxActions: typeof cb.maxActions === 'number' && cb.maxActions >= 1 ? cb.maxActions : 10,
    windowMinutes: typeof cb.windowMinutes === 'number' && cb.windowMinutes > 0 ? cb.windowMinutes : 10,
  };

  if (!process.env.BOT_PHONE_NUMBER) {
    throw new Error('.env: BOT_PHONE_NUMBER is required, including country code, no + or spaces (e.g. 91XXXXXXXXXX)');
  }

  return {
    communityJid: cfg.communityJid,
    groupJids: cfg.groupJids,
    adminJids: cfg.adminJids,
    allowlistJids: cfg.allowlistJids,
    rules: cfg.rules,
    circuitBreaker,
    botPhoneNumber: process.env.BOT_PHONE_NUMBER,
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig, CONFIG_PATH };
