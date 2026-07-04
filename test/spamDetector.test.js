const test = require('node:test');
const assert = require('node:assert');
const { detectSpam, extractText } = require('../src/spamDetector');

const investmentRule = {
  id: 'investment-spam',
  enabled: true,
  actionMode: 'live',
  requireLink: true,
  linkPattern: 'chat\\.whatsapp\\.com/',
  keywords: ['invest', 'stocks', 'mutual fund', 'trading', 'sip', 'crypto', 'demat'],
  minKeywordMatches: 1,
  reviewKeywordMatches: 1,
};

const cfg = {
  adminJids: ['919999999999@s.whatsapp.net'],
  allowlistJids: [],
  rules: [investmentRule],
};

const SENDER = '911234567890@s.whatsapp.net';

test('flags the canonical spam message (link + keywords)', () => {
  const text = 'If you invest in stocks and mutual funds or want to invest, you can join this group to learn and discuss https://chat.whatsapp.com/F0yaJlhGarJCwqo75VYqEY';
  const { isSpam, ruleId, actionMode } = detectSpam(text, SENDER, cfg);
  assert.strictEqual(isSpam, true);
  assert.strictEqual(ruleId, 'investment-spam');
  assert.strictEqual(actionMode, 'live');
});

test('flags reworded spam variants with the same fingerprint', () => {
  const text = 'Learn crypto and forex trading, join our free group now -> https://chat.whatsapp.com/AbCdEfGhIjKlMnOp';
  const { isSpam } = detectSpam(text, SENDER, cfg);
  assert.strictEqual(isSpam, true);
});

test('does NOT flag an investment link-free discussion (keyword only)', () => {
  const text = 'I want to invest in mutual funds, any recommendations for SIP?';
  const { isSpam, needsReview, reason } = detectSpam(text, SENDER, cfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(needsReview, false);
  assert.match(reason, /no-link-match/);
});

test('does NOT flag an unrelated WhatsApp group link (link only, no investment keywords)', () => {
  const text = 'Hey everyone, join our neighborhood watch group: https://chat.whatsapp.com/ZzYyXxWwVvUuTt';
  const { isSpam, needsReview, reason } = detectSpam(text, SENDER, cfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(needsReview, false);
  assert.match(reason, /insufficient-keyword-match/);
});

test('flags a link-bearing, keyword-weak message for review instead of ignoring it', () => {
  const weakRule = { ...investmentRule, minKeywordMatches: 3, reviewKeywordMatches: 1 };
  const weakCfg = { ...cfg, rules: [weakRule] };
  const text = 'invest now https://chat.whatsapp.com/abc';
  const { isSpam, needsReview, ruleId } = detectSpam(text, SENDER, weakCfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(needsReview, true);
  assert.strictEqual(ruleId, 'investment-spam');
});

test('does NOT flag messages from admins even if they match every rule', () => {
  const text = 'Testing: invest in stocks https://chat.whatsapp.com/testtesttest';
  const { isSpam, reason } = detectSpam(text, '919999999999@s.whatsapp.net', cfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(reason, 'exempt');
});

test('does NOT flag allowlisted senders', () => {
  const allowlistCfg = { ...cfg, allowlistJids: [SENDER] };
  const text = 'invest in stocks https://chat.whatsapp.com/testtesttest';
  const { isSpam, reason } = detectSpam(text, SENDER, allowlistCfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(reason, 'exempt');
});

test('handles empty/no-text messages gracefully', () => {
  const { isSpam, reason } = detectSpam('', SENDER, cfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(reason, 'no-text');
});

test('skips disabled rules entirely', () => {
  const disabledCfg = { ...cfg, rules: [{ ...investmentRule, enabled: false }] };
  const text = 'If you invest in stocks and mutual funds, join this group https://chat.whatsapp.com/F0yaJlhGarJCwqo75VYqEY';
  const { isSpam, needsReview, reason } = detectSpam(text, SENDER, disabledCfg);
  assert.strictEqual(isSpam, false);
  assert.strictEqual(needsReview, false);
  assert.strictEqual(reason, 'no-rule-match');
});

test('a second rule catches spam the first rule does not, with its own actionMode', () => {
  const jobScamRule = {
    id: 'job-scam-spam',
    enabled: true,
    actionMode: 'log-only',
    requireLink: true,
    linkPattern: 'chat\\.whatsapp\\.com/',
    keywords: ['work from home', 'daily payment', 'no investment needed'],
    minKeywordMatches: 2,
    reviewKeywordMatches: 1,
  };
  const multiCfg = { ...cfg, rules: [investmentRule, jobScamRule] };
  const text = 'Work from home and get daily payment guaranteed, message us now https://chat.whatsapp.com/xyz';
  const { isSpam, ruleId, actionMode } = detectSpam(text, SENDER, multiCfg);
  assert.strictEqual(isSpam, true);
  assert.strictEqual(ruleId, 'job-scam-spam');
  assert.strictEqual(actionMode, 'log-only');
});

test('extractText reads plain conversation text', () => {
  const msg = { message: { conversation: 'hello world' } };
  assert.strictEqual(extractText(msg), 'hello world');
});

test('extractText reads extendedTextMessage text', () => {
  const msg = { message: { extendedTextMessage: { text: 'hello extended' } } };
  assert.strictEqual(extractText(msg), 'hello extended');
});

test('extractText reads image caption', () => {
  const msg = { message: { imageMessage: { caption: 'invest now https://chat.whatsapp.com/xyz' } } };
  assert.strictEqual(extractText(msg), 'invest now https://chat.whatsapp.com/xyz');
});

test('extractText returns empty string when no message payload', () => {
  assert.strictEqual(extractText({ message: null }), '');
  assert.strictEqual(extractText({}), '');
});

test('minKeywordMatches=2 requires two distinct keyword hits', () => {
  const strictRule = { ...investmentRule, minKeywordMatches: 2, reviewKeywordMatches: 0 };
  const strictCfg = { ...cfg, rules: [strictRule] };
  const oneKeyword = 'invest now https://chat.whatsapp.com/abc';
  const twoKeywords = 'invest in stocks now https://chat.whatsapp.com/abc';
  assert.strictEqual(detectSpam(oneKeyword, SENDER, strictCfg).isSpam, false);
  assert.strictEqual(detectSpam(twoKeywords, SENDER, strictCfg).isSpam, true);
});

test('requireLink=false allows keyword-only detection', () => {
  const looseRule = { ...investmentRule, requireLink: false };
  const looseCfg = { ...cfg, rules: [looseRule] };
  const text = 'DM me to invest in stocks and mutual funds for guaranteed returns';
  assert.strictEqual(detectSpam(text, SENDER, looseCfg).isSpam, true);
});

test('catches mathematical-bold lookalike keywords (NFKC normalization)', () => {
  // "𝐢𝐧𝐯𝐞𝐬𝐭 in 𝐬𝐭𝐨𝐜𝐤𝐬" written with U+1D400-range mathematical bold letters
  const bold = (s) => [...s].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97) : c)).join('');
  const text = `${bold('invest')} in ${bold('stocks')} https://chat.whatsapp.com/xyz`;
  const { isSpam, reason } = detectSpam(text, SENDER, cfg);
  assert.strictEqual(isSpam, true);
  assert.match(reason, /keywords=invest/);
});

test('catches keywords split by zero-width characters', () => {
  const zwsp = String.fromCharCode(0x200b);
  const text = `inv${zwsp}est now https://chat.whatsapp.com/abc`;
  assert.strictEqual(detectSpam(text, SENDER, cfg).isSpam, true);
});

test('catches links split by zero-width characters', () => {
  const zwsp = String.fromCharCode(0x200b);
  const text = `invest now https://chat.${zwsp}whatsapp.${zwsp}com/abc`;
  assert.strictEqual(detectSpam(text, SENDER, cfg).isSpam, true);
});
