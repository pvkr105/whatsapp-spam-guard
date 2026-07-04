// Guided one-time setup wizard: creates .env, connects to WhatsApp, and writes
// config/config.json from your choices. Run with: npm run setup
//
// This only handles first-time onboarding (the "Quick start" section in
// README.md). Adding a second rule or tuning thresholds afterward is still a
// matter of editing config.json directly - see "Adding a new spam category"
// in README.md.

const fs = require('fs');
const path = require('path');
const prompts = require('prompts');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const CONFIG_PATH = path.join(ROOT, 'config', 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config', 'config.example.json');

async function ensureEnv() {
  if (fs.existsSync(ENV_PATH)) {
    console.log('.env already exists, skipping.');
    return;
  }

  const { phone } = await prompts({
    type: 'text',
    name: 'phone',
    message: 'Your WhatsApp admin number, INCLUDING country code, no + or spaces (e.g. 91XXXXXXXXXX):',
    validate: (v) => /^\d{8,15}$/.test(v) || 'Digits only, no + or spaces - remember to include the country code',
  });
  if (!phone) {
    console.log('Cancelled.');
    process.exit(1);
  }

  fs.writeFileSync(ENV_PATH, `BOT_PHONE_NUMBER=${phone}\nLOG_LEVEL=info\n`);
  console.log('Saved to .env');
}

async function connectAndDiscover() {
  require('dotenv').config();
  const logger = require('../src/logger');
  const { startSocket } = require('../src/connection');

  console.log('\nConnecting to WhatsApp to discover your groups...\n');

  return new Promise((resolve, reject) => {
    startSocket({ botPhoneNumber: process.env.BOT_PHONE_NUMBER, logger, onMessages: async () => {} })
      .then((sock) => {
        sock.ev.on('connection.update', async (update) => {
          if (update.connection !== 'open') return;
          try {
            const raw = await sock.groupFetchAllParticipating();
            const groups = Object.values(raw).map((g) => ({
              jid: g.id,
              subject: g.subject,
              isCommunity: g.isCommunity ?? false,
              isCommunityAnnounce: g.isCommunityAnnounce ?? false,
              linkedParent: g.linkedParent ?? null,
              participantsCount: g.participants?.length ?? 0,
            }));
            resolve(groups);
          } catch (err) {
            reject(err);
          }
        });
      })
      .catch(reject);
  });
}

async function main() {
  const { listCommunities, findAnnounceGroup, findSubgroups } = require('../src/communityDiscovery');

  console.log('whatsapp-spam-guard setup');
  console.log('─────────────────────────');
  console.log('This will walk you through connecting your WhatsApp account, picking which');
  console.log('groups to protect, and writing config/config.json. Takes ~3 minutes.\n');

  if (fs.existsSync(CONFIG_PATH)) {
    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'config/config.json already exists. Overwrite it?',
      initial: false,
    });
    if (!proceed) {
      console.log('Cancelled - existing config left untouched.');
      process.exit(0);
    }
  }

  await ensureEnv();
  const groups = await connectAndDiscover();

  const communities = listCommunities(groups);
  if (communities.length === 0) {
    console.log('\nNo communities found on this account. This bot is designed to protect a');
    console.log('WhatsApp Community - create one first, then run "npm run setup" again.');
    process.exit(1);
  }

  const communityChoices = communities.map((c) => {
    const subgroups = findSubgroups(groups, c.jid);
    const announce = findAnnounceGroup(groups, c.jid);
    return {
      title: `${c.subject}  (${subgroups.length} groups, ${announce ? announce.participantsCount : '?'}-member announcement group)`,
      value: c.jid,
    };
  });

  const { communityJid } = await prompts({
    type: 'select',
    name: 'communityJid',
    message: 'Which community do you want to protect?',
    choices: communityChoices,
  });
  if (!communityJid) {
    console.log('Cancelled.');
    process.exit(1);
  }

  const community = communities.find((c) => c.jid === communityJid);
  const announceGroup = findAnnounceGroup(groups, communityJid);
  if (!announceGroup) {
    console.log("\nCould not find this community's announcement group automatically.");
    console.log('Run "npm run list-groups" and set communityJid manually - see "Manual setup" in README.md.');
    process.exit(1);
  }
  console.log(`\nCommunity set: ${community.subject}`);
  console.log(`  communityJid -> ${announceGroup.jid} (announcement group, auto-selected)\n`);

  const subgroups = findSubgroups(groups, communityJid);
  if (subgroups.length === 0) {
    console.log('No regular groups found under this community.');
    process.exit(1);
  }

  const { groupJids } = await prompts({
    type: 'multiselect',
    name: 'groupJids',
    message: 'Which of these groups should the bot monitor?',
    choices: subgroups.map((g) => ({
      title: `${g.subject} (${g.participantsCount} members)`,
      value: g.jid,
      selected: true,
    })),
    hint: '- Space to toggle, Enter to confirm',
  });
  if (!groupJids || groupJids.length === 0) {
    console.log('No groups selected - cancelled.');
    process.exit(1);
  }

  console.log(`\n${groupJids.length} group(s) selected.\n`);
  console.log('Setting up your first spam-detection rule.\n');

  const example = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
  const presetRule = example.rules.find((r) => r.id === 'investment-spam');
  console.log('Using the built-in "investment-spam" preset:');
  console.log(`  keywords: ${presetRule.keywords.join(', ')}`);
  console.log(`  link required: ${presetRule.linkPattern}\n`);
  console.log('(You can edit config/config.json afterward to add keywords or a second rule -');
  console.log(' see "Adding a new spam category" in README.md.)\n');

  const { actionMode } = await prompts({
    type: 'select',
    name: 'actionMode',
    message: 'Start this rule in log-only mode (recommended) or live?',
    choices: [
      { title: 'log-only (recommended)', value: 'log-only' },
      { title: 'live', value: 'live' },
    ],
    initial: 0,
  });
  if (!actionMode) {
    console.log('Cancelled.');
    process.exit(1);
  }

  const config = {
    communityJid: announceGroup.jid,
    groupJids,
    adminJids: [`${process.env.BOT_PHONE_NUMBER}@s.whatsapp.net`],
    allowlistJids: [],
    rules: [{ ...presetRule, actionMode }],
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log('Wrote config/config.json\n');

  console.log('Setup complete. Next steps:');
  console.log('  1. npm start');
  console.log('  2. Post a test spam message into one of your groups from a second phone');
  console.log('  3. Check logs/actions.log and your own WhatsApp DMs for the [log-only] report');
  console.log('  4. When you trust it, edit config.json and set actionMode to "live"\n');
  console.log('Full config reference: README.md');

  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
