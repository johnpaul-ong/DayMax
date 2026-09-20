"use client";

/**
 * Data layer for Phase 2+3: tracks, members, share rules, invites,
 * Compare, Arena, friend directory. Split in Sep 2026 across four
 * sibling modules — every symbol they used to expose is re-exported
 * from here so import sites (`from "@/lib/friends"`) keep working.
 * New code can import from the deeper file if it prefers a smaller
 * surface.
 *
 *   tracks.ts       tracks + members + invites + Compare
 *   profiles.ts     public profile page (visibility + readers)
 *   leaderboards.ts Arena, pursuit-wide day totals and lifts
 *   friendships.ts  friend directory + @usernames
 */

export {
  acceptInvite,
  addTrackMember,
  createInvite,
  createTrack,
  deleteInvite,
  deleteTrack,
  fetchCompareDay,
  fetchCompareLifts,
  fetchInvites,
  fetchMembers,
  fetchTracks,
  getInviteInfo,
  removeMember,
  renameTrack,
  setMyShareRule,
  type CompareDayRow,
  type CompareLiftRow,
  type Invite,
  type InviteInfo,
  type ShareRule,
  type Track,
  type TrackKind,
  type TrackMember,
} from "./tracks";

export {
  ALL_SECTIONS,
  PROFILE_SECTIONS,
  fetchMemberBodyweight,
  fetchMemberDayMetrics,
  fetchMemberDayStrip,
  fetchMemberDayTotals,
  fetchMemberExercises,
  fetchMemberLifts,
  fetchMemberProfile,
  fetchMyProfileSections,
  fetchMyVisibility,
  saveMyProfileSections,
  saveMyVisibility,
  setDefaultExercise,
  type DayStripRow,
  type FriendStatus,
  type MemberDayMetricsRow,
  type MemberDayTotal,
  type MemberProfile,
  type MyVisibility,
  type ProfileSection,
} from "./profiles";

export {
  fetchArena,
  fetchLeaderboard,
  fetchLeaderboardLifts,
  fetchPursuitDayTotals,
  fetchPursuitLifts,
  invalidateCommunityCache,
  type ArenaScope,
  type LeaderboardLiftRow,
  type LeaderboardRow,
} from "./leaderboards";

export {
  acceptFriendRequest,
  fetchDiscoverable,
  fetchMyUsername,
  isUsernameAvailable,
  listFriends,
  removeFriendship,
  searchProfiles,
  sendFriendRequest,
  setDiscoverable,
  setUsername,
  type FoundProfile,
  type Friendship,
  type MyHandle,
} from "./friendships";
