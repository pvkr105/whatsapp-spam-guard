const { loadConfig } = require('./config');
const logger = require('./logger');
const { startSocket } = require('./connection');
const { extractText, detectSpam } = require('./spamDetector');
const { actOnSpam } = require('./moderation');
const actionsLog = require('./actionsLog');
const pendingReview = require('./pendingReview');
const status = require('./statusIndicator');
const circuitBreaker = require('./circuitBreaker');

const REVIEW_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // stale flags older than this are dropped rather than acted on
const REVIEW_REMIND_AFTER_MS = 12 * 60 * 60 * 1000; // one reminder DM per review that sits unanswered this long
const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Admin chats double as personal chats (the self-chat especially is often used
// as a notes/journal space), so nothing counts as a command unless it starts
// with the word "bot": "bot status", "Bot approve 4" (case-insensitive, since
// phones autocapitalize). Anything else in an admin chat is ignored entirely.
const BOT_COMMAND_RE = /^bot\s+([a-z]+)(?:\s+#?(\S+))?/i;

async function main() {
  const cfg = loadConfig();
  circuitBreaker.configure(cfg.circuitBreaker);
  const enabledRules = cfg.rules.filter((r) => r.enabled).map((r) => `${r.id} (${r.actionMode})`);
  logger.info({ groups: cfg.groupJids.length, rules: enabledRules }, 'Starting whatsapp-spam-guard');
  pendingReview.pruneExpired(REVIEW_EXPIRY_MS);
  status.init({ logger, heartbeatMinutes: Number(process.env.STATUS_HEARTBEAT_MINUTES ?? 30) });

  // Set lookup instead of Array.includes: these checks run on every message in every chat.
  const monitoredGroupJids = new Set(cfg.groupJids);
  const adminJidSet = new Set(cfg.adminJids);
  const selfJid = `${cfg.botPhoneNumber}@s.whatsapp.net`;
  // WhatsApp may route our own self-chat under either JID form (see
  // maybeDiscoverOwnLid below) - ownJids holds every form seen for "this is me
  // talking to myself", starting with the phone-number JID and gaining the
  // @lid alias once discovered.
  const ownJids = new Set([selfJid]);

  let activeSock = null;
  let startupDmSent = false;
  let ownLidDiscovered = false;

  // WhatsApp increasingly routes our own self-chat under an opaque "@lid"
  // identity instead of the phone-number JID in config.json (see AGENTS.md
  // gotcha #4). Baileys exposes both forms via sock.user right after
  // connecting, but exactly when that becomes available has proven to vary
  // (observed: present on some connects, not yet populated on others,
  // seemingly depending on whether this is a fresh pairing vs. a plain
  // reconnect). Rather than depend on catching it at one exact moment, this
  // is called on every connect AND on every message until it succeeds once -
  // cheap after that (it no-ops immediately via the flag).
  const maybeDiscoverOwnLid = async (sock) => {
    if (ownLidDiscovered) return;
    if (!adminJidSet.has(selfJid) || !sock.user?.lid) {
      logger.debug({ selfJidIsAdmin: adminJidSet.has(selfJid), user: sock.user }, 'Own @lid not yet available');
      return;
    }
    try {
      const { jidNormalizedUser } = await import('@whiskeysockets/baileys');
      const ownLid = jidNormalizedUser(sock.user.lid);
      if (ownLid) {
        adminJidSet.add(ownLid);
        ownJids.add(ownLid);
        ownLidDiscovered = true;
        logger.info({ ownLid }, 'Discovered own @lid identity - admin chat now recognized under both JID forms');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to resolve own @lid identity - will retry on next message');
    }
  };

  const dmAdmins = async (sock, text) => {
    for (const jid of cfg.adminJids) {
      try {
        await sock.sendMessage(jid, { text });
      } catch (err) {
        logger.error({ err, jid }, 'Failed to DM admin');
      }
    }
  };

  const approveReview = async (sock, replyTo, id) => {
    const entry = pendingReview.take(id);
    if (!entry) {
      await sock.sendMessage(replyTo, { text: `No pending review found for #${id} (already handled or expired).` });
      return;
    }
    logger.info({ id, groupJid: entry.groupJid, senderJid: entry.senderJid }, 'Admin approved flagged message - acting now');
    status.countSpam();
    // Explicit human approval always takes real action, regardless of that rule's own actionMode.
    const result = await actOnSpam({
      sock,
      msg: { key: entry.key },
      senderJid: entry.senderJid,
      actionMode: 'live',
      communityJid: cfg.communityJid,
      groupJids: cfg.groupJids,
      logger,
    });
    await actionsLog.record({
      sock,
      logger,
      adminJids: cfg.adminJids,
      senderJid: entry.senderJid,
      text: entry.text,
      reason: entry.reason,
      ruleId: entry.ruleId,
      actionMode: 'live',
      result,
      isOffline: entry.isOffline,
      approvedId: id,
    });
  };

  const ignoreReview = async (sock, replyTo, id) => {
    const entry = pendingReview.take(id);
    if (!entry) {
      await sock.sendMessage(replyTo, { text: `No pending review found for #${id} (already handled or expired).` });
      return;
    }
    logger.info({ id, groupJid: entry.groupJid, senderJid: entry.senderJid }, 'Admin dismissed flagged message');
    await sock.sendMessage(replyTo, { text: `Dismissed #${id}. No action taken.` });
  };

  const HELP_TEXT = [
    '🤖 whatsapp-spam-guard commands (every command starts with "bot"):',
    '• bot status — connection state, uptime, and activity counters',
    '• bot pending — flagged messages awaiting your decision',
    '• bot approve <id> — delete that message and remove its sender',
    '• bot ignore <id> — dismiss a flagged message',
    '• bot resume <rule-id> — re-enable a rule paused by the circuit breaker',
    '• bot help — this list',
  ].join('\n');

  const handleAdminCommand = async (sock, msg) => {
    const text = extractText(msg).trim();
    logger.debug({ remoteJid: msg.key.remoteJid, fromMe: msg.key.fromMe, text }, 'Admin chat message received');
    const match = text.match(BOT_COMMAND_RE);
    if (!match) return; // not addressed to the bot - admin chats are personal chats too

    const command = match[1].toLowerCase();
    const arg = match[2];
    const replyTo = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(replyTo, { text: t });

    switch (command) {
      case 'status': {
        const paused = circuitBreaker.trippedRules();
        const pausedNote = paused.length
          ? `\n⛔ Paused by circuit breaker: ${paused.join(', ')} — reply "bot resume <rule-id>" to re-enable.`
          : '';
        await reply(status.summaryLine() + pausedNote);
        return;
      }
      case 'pending': {
        const entries = pendingReview.list();
        if (entries.length === 0) {
          await reply('✅ No pending reviews.');
          return;
        }
        const lines = entries.map(
          (e) =>
            `#${e.id} [${e.ruleId}] ${e.senderJid.split('@')[0]}, ${status.formatUptime(Date.now() - e.ts)} ago: "${e.text.slice(0, 80)}"`
        );
        await reply(
          `⏳ ${entries.length} pending review(s):\n${lines.join('\n')}\n\nReply "bot approve <id>" or "bot ignore <id>".`
        );
        return;
      }
      case 'approve':
      case 'ignore': {
        if (!arg || !/^\d+$/.test(arg)) {
          await reply(`Usage: bot ${command} <id> (e.g. "bot ${command} 4")`);
          return;
        }
        if (command === 'approve') await approveReview(sock, replyTo, arg);
        else await ignoreReview(sock, replyTo, arg);
        return;
      }
      case 'resume': {
        if (!arg) {
          await reply('Usage: bot resume <rule-id> ("bot status" lists paused rules)');
          return;
        }
        const wasTripped = circuitBreaker.reset(arg);
        await reply(
          wasTripped
            ? `▶️ Rule "${arg}" resumed - live actions re-enabled.`
            : `Rule "${arg}" wasn't paused. Paused rules show up in "bot status".`
        );
        return;
      }
      case 'help': {
        await reply(HELP_TEXT);
        return;
      }
      default:
        await reply(`Unknown command "bot ${command}".\n\n${HELP_TEXT}`);
    }
  };

  const flagForReview = async (sock, { msg, groupJid, senderJid, text, reason, ruleId, isOffline }) => {
    const id = pendingReview.add({ key: msg.key, groupJid, senderJid, text, reason, ruleId, isOffline, ts: Date.now() });
    logger.info({ id, groupJid, senderJid, reason }, 'Possible spam - awaiting admin review');
    const senderNumber = senderJid.split('@')[0];
    const summary =
      `🤔 Possible spam (needs your review) #${id}\n` +
      `Rule: ${ruleId}\n` +
      `Group: ${groupJid}\nSender: ${senderNumber}\nReason: ${reason}\n` +
      `Text: "${text.slice(0, 300)}"\n\n` +
      `Reply "bot approve ${id}" to delete the message and remove the sender, or "bot ignore ${id}" to dismiss.`;
    await dmAdmins(sock, summary);
  };

  const onMessages = async (sock, msg, { isOffline = false } = {}) => {
    if (!msg.message) return;
    await maybeDiscoverOwnLid(sock);

    const chatJid = msg.key.remoteJid;
    logger.debug(
      { chatJid, fromMe: msg.key.fromMe, matchesConfiguredAdmin: adminJidSet.has(chatJid), configuredAdminJids: cfg.adminJids },
      'Inbound message routing check'
    );
    if (adminJidSet.has(chatJid)) {
      // In the self-chat the admin's own commands arrive as fromMe. In another
      // admin's DM chat, fromMe means the bot's outgoing summaries - never
      // parse those as commands.
      if (!msg.key.fromMe || ownJids.has(chatJid)) {
        await handleAdminCommand(sock, msg);
      }
      return;
    }

    if (msg.key.fromMe) return;

    const groupJid = chatJid;
    if (!monitoredGroupJids.has(groupJid)) return;

    const senderJid = msg.key.participant;
    if (!senderJid) return;

    status.countChecked();
    const text = extractText(msg);
    const { isSpam, needsReview, reason, ruleId, actionMode } = detectSpam(text, senderJid, cfg);

    if (isSpam) {
      status.countSpam();
      logger.info({ groupJid, senderJid, ruleId, reason, isOffline }, isOffline ? 'Spam detected (offline backlog)' : 'Spam detected');

      let effectiveMode = actionMode;
      let breakerNote = '';
      if (actionMode === 'live') {
        const { allowed, justTripped } = circuitBreaker.registerLiveAction(ruleId);
        if (!allowed) {
          effectiveMode = 'log-only';
          breakerNote = ' [circuit breaker: rule paused, action simulated only]';
          if (justTripped) {
            const { maxActions, windowMinutes } = circuitBreaker.getSettings();
            logger.error({ ruleId }, 'Circuit breaker tripped - rule demoted to log-only until "bot resume" or restart');
            await dmAdmins(
              sock,
              `⛔ Circuit breaker: rule "${ruleId}" tried to take more than ${maxActions} live actions within ${windowMinutes} minutes.\n` +
                `That's either a real spam wave or a misconfigured rule matching normal chat.\n` +
                `The rule still detects but is paused to log-only. Check logs/actions.log, then reply "bot resume ${ruleId}" to re-enable it (or fix config.json and restart).`
            );
          }
        }
      }

      const result = await actOnSpam({
        sock,
        msg,
        senderJid,
        actionMode: effectiveMode,
        communityJid: cfg.communityJid,
        groupJids: cfg.groupJids,
        logger,
      });
      await actionsLog.record({
        sock,
        logger,
        adminJids: cfg.adminJids,
        senderJid,
        text,
        reason: reason + breakerNote,
        ruleId,
        actionMode: effectiveMode,
        result,
        isOffline,
      });
      return;
    }

    if (needsReview) {
      status.countReview();
      await flagForReview(sock, { msg, groupJid, senderJid, text, reason, ruleId, isOffline });
    }
  };

  const sendPendingReminders = async () => {
    if (!activeSock) return;
    for (const e of pendingReview.dueForReminder(REVIEW_REMIND_AFTER_MS)) {
      await dmAdmins(
        activeSock,
        `⏰ Reminder: review #${e.id} is still pending (rule: ${e.ruleId}, sender: ${e.senderJid.split('@')[0]}, flagged ${status.formatUptime(Date.now() - e.ts)} ago).\n` +
          `Text: "${e.text.slice(0, 200)}"\n\n` +
          `Reply "bot approve ${e.id}" or "bot ignore ${e.id}". Unanswered reviews expire after 3 days.`
      );
      pendingReview.markReminded(e.id);
    }
  };
  setInterval(() => {
    sendPendingReminders().catch((err) => logger.error({ err }, 'Pending-review reminder check failed'));
  }, REMINDER_CHECK_INTERVAL_MS).unref();

  const onConnected = async (sock) => {
    activeSock = sock;
    await maybeDiscoverOwnLid(sock);

    if (startupDmSent) return; // reconnects within one run shouldn't re-announce
    startupDmSent = true;

    const pendingCount = pendingReview.list().length;
    const pendingNote = pendingCount ? `\n⏳ ${pendingCount} review(s) still pending - reply "bot pending".` : '';
    await dmAdmins(
      sock,
      `🟢 whatsapp-spam-guard is online - watching ${cfg.groupJids.length} group(s).\n` +
        `Rules: ${enabledRules.join(', ')}\n` +
        `Reply "bot help" for commands.${pendingNote}`
    );
    await sendPendingReminders();
  };

  await startSocket({
    botPhoneNumber: cfg.botPhoneNumber,
    logger,
    onMessages,
    onStatus: (name, detail) =>
      status.setState(name, name === 'online' ? `watching ${cfg.groupJids.length} groups` : detail),
    onConnected,
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
