// Pure helpers over the group/community list returned by groupFetchAllParticipating
// (normalized to the same { jid, subject, isCommunity, isCommunityAnnounce,
// linkedParent, participantsCount } shape that scripts/list-groups.js writes to
// logs/groups-dump.json). No I/O here on purpose - this is the logic that got the
// community-vs-announcement-group JID mixed up during manual setup, so it's worth
// testing in isolation from the interactive wizard around it.

function listCommunities(groups) {
  return groups.filter((g) => g.isCommunity);
}

// The announcement group is what actually holds a real, removable membership list
// (see "Manual setup" in README.md) - it's a different JID from the bare community entity.
function findAnnounceGroup(groups, communityJid) {
  return groups.find((g) => g.linkedParent === communityJid && g.isCommunityAnnounce) || null;
}

function findSubgroups(groups, communityJid) {
  return groups.filter((g) => g.linkedParent === communityJid && !g.isCommunityAnnounce);
}

module.exports = { listCommunities, findAnnounceGroup, findSubgroups };
