const test = require('node:test');
const assert = require('node:assert');
const status = require('../src/statusIndicator');

test('formatUptime renders minutes, hours, and days', () => {
  assert.strictEqual(status.formatUptime(0), '0m');
  assert.strictEqual(status.formatUptime(59 * 1000), '0m');
  assert.strictEqual(status.formatUptime(5 * 60 * 1000), '5m');
  assert.strictEqual(status.formatUptime(3 * 60 * 60 * 1000 + 2 * 60 * 1000), '3h 2m');
  assert.strictEqual(status.formatUptime(2 * 24 * 60 * 60 * 1000 + 60 * 1000), '2d 0h 1m');
});

test('statusLine reflects the current state and detail', () => {
  status.setState('online', 'watching 5 groups');
  assert.strictEqual(status.statusLine(), '🟢 LIVE - watching for spam (watching 5 groups)');

  status.setState('reconnecting');
  assert.match(status.statusLine(), /^🟡 Connection lost - reconnecting$/);

  status.setState('logged-out');
  assert.match(status.statusLine(), /^🔴 NEEDS ATTENTION: logged out/);
});

test('summaryLine reports counters', () => {
  status.countChecked();
  status.countChecked();
  status.countChecked();
  status.countSpam();
  status.countReview();
  assert.match(status.summaryLine(), /3 messages checked, 1 spam actioned, 1 flagged for review/);
});
