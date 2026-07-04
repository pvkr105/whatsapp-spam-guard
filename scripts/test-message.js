// Dry-run any message text through your configured rules without connecting to
// WhatsApp - the fast way to tune keywords/thresholds without posting real test
// messages from a second phone.
//
// Usage: npm run test-message -- "your message text here"

const { loadConfig } = require('../src/config');
const { detectSpam, evaluateRule } = require('../src/spamDetector');

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.log('Usage: npm run test-message -- "message text to test"');
  console.log('Example: npm run test-message -- "invest in stocks https://chat.whatsapp.com/abc"');
  process.exit(1);
}

const cfg = loadConfig();

console.log(`\nMessage: "${text}"\n`);
console.log('Per-rule breakdown:');
for (const rule of cfg.rules) {
  if (!rule.enabled) {
    console.log(`  - ${rule.id}: skipped (disabled)`);
    continue;
  }
  const r = evaluateRule(text, rule);
  const verdict = r.isSpam
    ? `WOULD ACT (actionMode: ${rule.actionMode})`
    : r.needsReview
      ? 'WOULD FLAG FOR ADMIN REVIEW'
      : 'no match';
  console.log(`  - ${rule.id}: ${verdict} - ${r.reason}`);
}

// A synthetic non-admin, non-allowlisted sender: we're testing rules, not exemptions.
const overall = detectSpam(text, 'test-sender@s.whatsapp.net', cfg);
const overallVerdict = overall.isSpam
  ? `SPAM -> rule "${overall.ruleId}" would ${overall.actionMode === 'live' ? 'DELETE the message and REMOVE the sender' : 'log/report only (log-only mode)'}`
  : overall.needsReview
    ? `NEEDS REVIEW -> rule "${overall.ruleId}" would DM the admin(s) for an approve/ignore decision`
    : 'NO ACTION - message would be left alone';

console.log(`\nOverall: ${overallVerdict}`);
console.log(`Reason:  ${overall.reason}\n`);
