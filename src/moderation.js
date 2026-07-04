const REMOVAL_JITTER_MIN_MS = 5000;
const REMOVAL_JITTER_MAX_MS = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function actOnSpam({ sock, msg, senderJid, actionMode, communityJid, groupJids, logger }) {
  const groupJid = msg.key.remoteJid;
  const live = actionMode === 'live';
  const result = { groupJid, senderJid, deleted: false, removedFrom: [], failedOn: [] };

  if (!live) {
    logger.info({ groupJid, senderJid }, '[log-only] would delete message and remove sender from all community groups');
    result.deleted = true;
    result.removedFrom = [groupJid, ...groupJids.filter((j) => j !== groupJid), communityJid];
    return result;
  }

  try {
    await sock.sendMessage(groupJid, {
      delete: {
        remoteJid: groupJid,
        fromMe: false,
        id: msg.key.id,
        participant: senderJid,
      },
    });
    result.deleted = true;
  } catch (err) {
    result.failedOn.push({ step: 'delete', error: err.message });
    logger.error({ err, groupJid }, 'Failed to delete spam message');
  }

  const jitterMs = REMOVAL_JITTER_MIN_MS + Math.random() * (REMOVAL_JITTER_MAX_MS - REMOVAL_JITTER_MIN_MS);
  logger.info({ groupJid, senderJid, jitterMs: Math.round(jitterMs) }, 'Delaying removal to avoid a mechanical detect-then-act pattern');
  await sleep(jitterMs);

  const allTargets = [groupJid, ...groupJids.filter((j) => j !== groupJid), communityJid];
  const uniqueTargets = [...new Set(allTargets)];

  for (const jid of uniqueTargets) {
    try {
      await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
      result.removedFrom.push(jid);
    } catch (err) {
      // Expected/benign when the sender was never a member of that particular group.
      result.failedOn.push({ step: `remove:${jid}`, error: err.message });
    }
  }

  return result;
}

module.exports = { actOnSpam };
