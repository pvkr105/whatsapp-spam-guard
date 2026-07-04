const test = require('node:test');
const assert = require('node:assert');
const breaker = require('../src/circuitBreaker');

test('allows actions up to the limit, trips on the action after it', () => {
  breaker.configure({ enabled: true, maxActions: 3, windowMinutes: 10 });
  const t0 = 1_000_000;

  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', t0), { allowed: true, justTripped: false });
  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', t0 + 1000), { allowed: true, justTripped: false });
  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', t0 + 2000), { allowed: true, justTripped: false });
  // 4th action within the window exceeds maxActions=3: tripped exactly once
  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', t0 + 3000), { allowed: false, justTripped: true });
  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', t0 + 4000), { allowed: false, justTripped: false });
  assert.strictEqual(breaker.isTripped('rule-a'), true);
});

test('rules trip independently', () => {
  breaker.configure({ enabled: true, maxActions: 1, windowMinutes: 10 });
  breaker.registerLiveAction('rule-a', 0);
  breaker.registerLiveAction('rule-a', 1);
  assert.strictEqual(breaker.isTripped('rule-a'), true);
  assert.strictEqual(breaker.isTripped('rule-b'), false);
  assert.deepStrictEqual(breaker.trippedRules(), ['rule-a']);
  assert.deepStrictEqual(breaker.registerLiveAction('rule-b', 2), { allowed: true, justTripped: false });
});

test('old actions fall out of the sliding window', () => {
  breaker.configure({ enabled: true, maxActions: 2, windowMinutes: 10 });
  const windowMs = 10 * 60 * 1000;
  breaker.registerLiveAction('rule-a', 0);
  breaker.registerLiveAction('rule-a', 1000);
  // Both prior actions are now outside the window, so this is action #1 of a fresh window.
  const result = breaker.registerLiveAction('rule-a', windowMs + 2000);
  assert.deepStrictEqual(result, { allowed: true, justTripped: false });
});

test('reset un-trips a rule and reports whether it was tripped', () => {
  breaker.configure({ enabled: true, maxActions: 1, windowMinutes: 10 });
  breaker.registerLiveAction('rule-a', 0);
  breaker.registerLiveAction('rule-a', 1);
  assert.strictEqual(breaker.reset('rule-a'), true);
  assert.strictEqual(breaker.isTripped('rule-a'), false);
  assert.strictEqual(breaker.reset('rule-a'), false); // not tripped anymore
  // Window history was cleared too - actions start counting from zero again.
  assert.deepStrictEqual(breaker.registerLiveAction('rule-a', 2), { allowed: true, justTripped: false });
});

test('enabled:false disables the breaker entirely', () => {
  breaker.configure({ enabled: false, maxActions: 1, windowMinutes: 10 });
  for (let i = 0; i < 20; i++) {
    assert.deepStrictEqual(breaker.registerLiveAction('rule-a', i), { allowed: true, justTripped: false });
  }
  assert.strictEqual(breaker.isTripped('rule-a'), false);
});
