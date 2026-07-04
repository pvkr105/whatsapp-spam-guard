function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

// Spammers dodge keyword filters with lookalike Unicode ("𝐢𝐧𝐯𝐞𝐬𝐭") and invisible
// zero-width characters spliced into words and links. NFKC folds the lookalikes
// back to plain characters, and stripping the zero-width set (ZWSP/ZWNJ/ZWJ,
// word joiner, BOM) makes "inv​est" and "chat.​whatsapp.com" match again.
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

function normalizeForMatching(text) {
  return text.normalize('NFKC').replace(ZERO_WIDTH_RE, '').toLowerCase();
}

// Rules are parsed once at startup and never mutated, so the regex compilation and
// keyword normalization they imply is hoisted out of the per-message path into this
// per-rule cache. Keyed by rule object (WeakMap) so ad-hoc rule literals, e.g. in
// tests, get their own entry and stay garbage-collectable.
const ruleCache = new WeakMap();

function compileRule(rule) {
  let compiled = ruleCache.get(rule);
  if (!compiled) {
    compiled = {
      linkRe: new RegExp(rule.linkPattern, 'i'),
      normalizedKeywords: rule.keywords.map(normalizeForMatching),
    };
    ruleCache.set(rule, compiled);
  }
  return compiled;
}

// Evaluates a single rule against message text. A rule matches fully (isSpam) only
// when every signal it requires is present. A link-bearing message with a near-miss
// keyword count is the case a rule is least confident about (the link is the rare,
// high-signal half of the fingerprint - keywords alone show up in plenty of normal
// chat), so that gets flagged for human review instead of silently dropped.
function evaluateRule(text, rule, normalizedText = normalizeForMatching(text)) {
  const { linkRe, normalizedKeywords } = compileRule(rule);
  const hasLink = linkRe.test(normalizedText);

  if (rule.requireLink && !hasLink) {
    return { isSpam: false, needsReview: false, reason: 'no-link-match' };
  }

  const hits = rule.keywords.filter((k, i) => normalizedText.includes(normalizedKeywords[i]));

  if (hits.length >= rule.minKeywordMatches) {
    return { isSpam: true, needsReview: false, reason: `link=${hasLink} keywords=${hits.join(',')}` };
  }

  if (hits.length >= rule.reviewKeywordMatches) {
    return { isSpam: false, needsReview: true, reason: `borderline: link=${hasLink} keywords=${hits.join(',')}` };
  }

  return { isSpam: false, needsReview: false, reason: 'insufficient-keyword-match' };
}

// Runs every enabled rule against a message and returns the first one that fires.
// A full match (isSpam) always wins over a review-tier match, even if a later rule
// would have flagged it first, since a confident hit shouldn't wait behind a maybe.
function detectSpam(text, senderJid, cfg) {
  if (cfg.adminJids.includes(senderJid) || cfg.allowlistJids.includes(senderJid)) {
    return { isSpam: false, needsReview: false, reason: 'exempt', ruleId: null, actionMode: null };
  }

  if (!text) {
    return { isSpam: false, needsReview: false, reason: 'no-text', ruleId: null, actionMode: null };
  }

  let bestReview = null;
  let lastReason = null;

  const normalizedText = normalizeForMatching(text);
  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;

    const { isSpam, needsReview, reason } = evaluateRule(text, rule, normalizedText);
    lastReason = `[${rule.id}] ${reason}`;

    if (isSpam) {
      return { isSpam: true, needsReview: false, reason: lastReason, ruleId: rule.id, actionMode: rule.actionMode };
    }

    if (needsReview && !bestReview) {
      bestReview = { isSpam: false, needsReview: true, reason: lastReason, ruleId: rule.id, actionMode: rule.actionMode };
    }
  }

  if (bestReview) return bestReview;
  if (lastReason === null) return { isSpam: false, needsReview: false, reason: 'no-rule-match', ruleId: null, actionMode: null };
  return { isSpam: false, needsReview: false, reason: lastReason, ruleId: null, actionMode: null };
}

module.exports = { extractText, detectSpam, evaluateRule, normalizeForMatching };
