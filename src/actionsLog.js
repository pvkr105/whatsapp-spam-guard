const fs = require('fs');
const path = require('path');
const { labelFor } = require('./groupNames');

const ACTIONS_LOG_PATH = path.join(__dirname, '..', 'logs', 'actions.log');

function appendActionsLog(block) {
  fs.mkdirSync(path.dirname(ACTIONS_LOG_PATH), { recursive: true });
  fs.appendFileSync(ACTIONS_LOG_PATH, block + '\n\n');
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
}

// Records one moderation event in plain English (logs/actions.log) and DMs the admin
// a short summary. This is the file to read to answer "what did the bot actually do
// and why" - logs/combined.log is for the more technical connection/library detail.
async function record({ sock, logger, adminJids, senderJid, text, reason, ruleId, actionMode, result, isOffline = false, approvedId = null }) {
  const live = actionMode === 'live';
  const senderNumber = senderJid.split('@')[0];
  const groupLabel = labelFor(result.groupJid);
  const removedLabels = result.removedFrom.map(labelFor);
  const failedLabels = result.failedOn.map((f) => `${f.step}: ${f.error}`);

  const headerNotes = [];
  if (approvedId) headerNotes.push(`admin-approved #${approvedId}`);
  if (isOffline) headerNotes.push('found in offline backlog');
  const header = `[${timestamp()}] ${live ? 'LIVE ACTION' : 'LOG-ONLY (simulated)'}${headerNotes.length ? ' - ' + headerNotes.join(', ') : ''} - rule: ${ruleId}`;

  const block = [
    header,
    `  Group:    ${groupLabel}`,
    `  Sender:   ${senderNumber} (${senderJid})`,
    `  Reason:   ${reason}`,
    `  Message:  "${text.slice(0, 300)}"`,
    `  Deleted message: ${result.deleted ? 'yes' : 'no'}`,
    `  Removed from (${removedLabels.length}): ${removedLabels.length ? removedLabels.join(', ') : 'none'}`,
    `  Failed steps: ${failedLabels.length ? failedLabels.join('; ') : 'none'}`,
  ].join('\n');

  appendActionsLog(block);

  const prefix = live ? '🛑 Removed' : '🔍 [log-only] Would remove';
  const noteSuffix = headerNotes.length ? ` (${headerNotes.join(', ')})` : '';
  const summary =
    `${prefix} spam sender ${senderNumber} from ${removedLabels.length} group(s)${noteSuffix}.\n` +
    `Rule: ${ruleId}\n` +
    `Group: ${groupLabel}\n` +
    `Reason: ${reason}\n` +
    `Message: "${text.slice(0, 200)}"`;

  for (const adminJid of adminJids) {
    try {
      await sock.sendMessage(adminJid, { text: summary });
    } catch (err) {
      logger.error({ err, adminJid }, 'Failed to send admin DM summary');
    }
  }
}

module.exports = { record, ACTIONS_LOG_PATH };
