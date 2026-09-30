/**
 * Inter-city travel stamina rules.
 * Maze travel (attr bit 2) uses pendingMazeWordTravelCost instead ?? no extra city cost.
 */

/** Stamina cost = floor(maxTili * percent / 100) per party member. */
export const CITY_TRAVEL_STAMINA_PERCENT = 5;

const MENU_SCENE_IDS = new Set([10000, 14444]);

/**
 * Coarse world regions for travel-cost checks (scene id ranges).
 * Order matters: more specific ranges first.
 */
export function getTravelRegion(sceneId) {
  const id = Number(sceneId);
  if (!Number.isFinite(id) || id < 10000) return 'local';

  if (id >= 12821 && id <= 12831) return 'kekexili';
  if (id >= 12800 && id <= 12820) return 'dongying';
  if (id >= 12617 && id <= 12798) return 'xiyu';
  if (id >= 12100 && id <= 12299) return 'dongying';
  if (id >= 12059 && id <= 12088) return 'emei';
  if (id >= 11998 && id <= 12058) return 'wudang';
  if (id >= 11937 && id <= 11997) return 'tianshan';
  if (id >= 11800 && id <= 11936) return 'kunlun';
  if (id >= 11784 && id <= 11799) return 'saiwai';
  if (id === 11578) return 'saiwai';
  if (id >= 11819 && id <= 11870) return 'shangjing';
  if (id === 11579) return 'shangjing';
  if (id >= 11400 && id <= 11783) return 'kaifeng';
  if (id >= 11370 && id <= 11390) return 'dali';
  if (id >= 11100 && id <= 11180) return 'xiuzhou';
  if (id >= 10582 && id <= 11099) return 'linan';
  if (id >= 10644 && id <= 10699) return 'linan';
  if (id >= 10701 && id <= 10999) return 'linan';
  if (id >= 11331 && id <= 11378) return 'linan';
  if (id === 11568) return 'linan';
  if (id >= 10061 && id <= 10449) return 'wuzhou';
  if (id >= 10450 && id <= 10499) return 'donghai';
  if (id >= 10300 && id <= 10350) return 'wujian';
  if (id >= 10000 && id <= 10059) return 'hexi';

  return 'wilderness';
}

export function isMazeSceneAttr(attr) {
  return ((Number(attr) || 0) & 2) === 2;
}

/**
 * @param {number} fromId
 * @param {number} toId
 * @param {number} fromAttr current scene attr
 * @param {number} toAttr target scene attr
 * @param {number} rawPageId argument passed to game_page (may be relative)
 */
export function shouldApplyCityTravelStaminaCost(fromId, toId, fromAttr, toAttr, rawPageId) {
  const from = Number(fromId);
  const to = Number(toId);
  if (!from || !to || from === to) return false;
  if (MENU_SCENE_IDS.has(from) || MENU_SCENE_IDS.has(to)) return false;

  if (isMazeSceneAttr(fromAttr) || isMazeSceneAttr(toAttr)) return false;

  const fromRegion = getTravelRegion(from);
  const toRegion = getTravelRegion(to);
  if (fromRegion === toRegion) return false;

  return true;
}
