const test = require('node:test');
const assert = require('node:assert');
const { listCommunities, findAnnounceGroup, findSubgroups } = require('../src/communityDiscovery');

// Mirrors the real shape found in logs/groups-dump.json: one community with an
// announcement group plus two regular subgroups, and one unrelated group outside it.
const groups = [
  { jid: 'community1@g.us', subject: 'Desi GR Hub', isCommunity: true, isCommunityAnnounce: false, linkedParent: null, participantsCount: 1 },
  { jid: 'announce1@g.us', subject: 'Desi GR Hub', isCommunity: false, isCommunityAnnounce: true, linkedParent: 'community1@g.us', participantsCount: 977 },
  { jid: 'sub1@g.us', subject: 'Kalamazoo Rides', isCommunity: false, isCommunityAnnounce: false, linkedParent: 'community1@g.us', participantsCount: 135 },
  { jid: 'sub2@g.us', subject: 'Community Q&A', isCommunity: false, isCommunityAnnounce: false, linkedParent: 'community1@g.us', participantsCount: 348 },
  { jid: 'unrelated@g.us', subject: 'Family', isCommunity: false, isCommunityAnnounce: false, linkedParent: null, participantsCount: 4 },
];

test('listCommunities returns only isCommunity:true entries', () => {
  const result = listCommunities(groups);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].jid, 'community1@g.us');
});

test('findAnnounceGroup returns the linked announcement group, not the bare community entity', () => {
  const result = findAnnounceGroup(groups, 'community1@g.us');
  assert.strictEqual(result.jid, 'announce1@g.us');
});

test('findAnnounceGroup returns null when a community has no linked announcement group', () => {
  const result = findAnnounceGroup(groups, 'nonexistent@g.us');
  assert.strictEqual(result, null);
});

test('findSubgroups returns linked subgroups but excludes the announcement group and unrelated groups', () => {
  const result = findSubgroups(groups, 'community1@g.us');
  const jids = result.map((g) => g.jid).sort();
  assert.deepStrictEqual(jids, ['sub1@g.us', 'sub2@g.us']);
});
