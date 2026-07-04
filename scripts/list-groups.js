// One-off discovery script: pairs the bot account (if not already paired) and
// dumps full metadata for every group/community the account participates in,
// so you can find the real JIDs to put in config/config.json.
//
// Run with: npm run list-groups
// Output is also saved to logs/groups-dump.json for later inspection.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { startSocket } = require('../src/connection');
const logger = require('../src/logger');

const OUT_PATH = path.join(__dirname, '..', 'logs', 'groups-dump.json');

async function main() {
  const botPhoneNumber = process.env.BOT_PHONE_NUMBER;
  if (!botPhoneNumber) {
    throw new Error('.env: BOT_PHONE_NUMBER is required, including country code, no + or spaces (e.g. 91XXXXXXXXXX)');
  }

  const sock = await startSocket({
    botPhoneNumber,
    logger,
    onMessages: async () => {}, // not needed for this script
  });

  sock.ev.on('connection.update', async (update) => {
    if (update.connection !== 'open') return;

    logger.info('Connected - fetching all participating groups...');
    const groups = await sock.groupFetchAllParticipating();

    const summary = Object.values(groups).map((g) => ({
      jid: g.id,
      subject: g.subject,
      isCommunity: g.isCommunity ?? null,
      isCommunityAnnounce: g.isCommunityAnnounce ?? null,
      linkedParent: g.linkedParent ?? null,
      participantsCount: g.participants?.length ?? 0,
      raw: g,
    }));

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));

    console.log('\n=== Groups/Community discovered ===');
    for (const g of summary) {
      console.log(`${g.jid}  "${g.subject}"  isCommunity=${g.isCommunity} isCommunityAnnounce=${g.isCommunityAnnounce} linkedParent=${g.linkedParent} participants=${g.participantsCount}`);
    }
    console.log(`\nFull metadata written to ${OUT_PATH}`);
    console.log('Copy the relevant JIDs into config/config.json (communityJid + groupJids), then Ctrl+C to exit.\n');
  });
}

main().catch((err) => {
  logger.error({ err }, 'list-groups failed');
  process.exit(1);
});
