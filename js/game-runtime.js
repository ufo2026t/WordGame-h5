import { getGameConfig, getPersonaTemplate } from './game-config.js';
import { getGoodsInfo } from './goods-data.js';
import { applyTemplateEquipment, ensureRoleArrays, initRoleFromTemplate } from './inventory-system.js';

export const STAT = {
  money: 0,
  luck: 1,
  speed: 2,
  attack: 3,
  hide: 4,
  tili: 5,
  lingli: 6,
  intellect: 7,
  life: 8,
  morality: 9,
  weiwang: 10,
  character: 11,
  sex: 12,
  cupidity: 13,
  love: 14,
  loveme: 15,
  believeMe: 16,
  believe: 17,
  fuzu: 18,
  experience: 19,
  defend: 20,
  face: 21,
  talk22: 22,
  talkid23: 23,
  upgrade: 24,
  gdtl25: 25,
  gdll26: 26,
  gdsmz27: 27,
  grade: 28,
  tmpHide: 29,
  yanchi30: 30,
  linshifang: 31,
  iconIndex: 32,
  touxian: 33,
};

const GOODS_TYPE_ICON = [
  [1, 'img_w_1.gif'],
  [2, 'img_w_2.gif'],
  [4, 'img_w_4.gif'],
  [8, 'img_w_8.gif'],
  [16, 'img_w_16.gif'],
  [32, 'img_w_32.gif'],
  [64, 'img_w_64.gif'],
  [128, 'img_w_128.gif'],
  [256, 'img_w_256.gif'],
];

function padArray(raw, len, fill = 0) {
  const a = Array.isArray(raw) ? raw.slice(0, len) : [];
  while (a.length < len) a.push(fill);
  return a;
}

/** Deep-copy a party role so save snapshots cannot be mutated in place. */
export function cloneRole(role) {
  if (!role) return null;
  return {
    oldName: role.oldName || role.name,
    name: role.name || role.oldName,
    stats: padArray(role.stats, 64),
    equip: padArray(role.equip, 10),
    ji: padArray(role.ji, 24),
    fa: padArray(role.fa, 64),
    hidden: role.hidden ?? 1,
    savedHidden: role.savedHidden ?? 1,
    equipBootstrapped: role.equipBootstrapped ?? true,
  };
}

export function ensureDepartedFriends(state) {
  if (!state.departedFriends || typeof state.departedFriends !== 'object' || Array.isArray(state.departedFriends)) {
    state.departedFriends = {};
  }
  return state.departedFriends;
}

/** Original del_friend writes the persona to dat\; remake keeps it on the save. */
export function storeDepartedFriend(state, role) {
  if (!role) return;
  const store = ensureDepartedFriends(state);
  const key = role.oldName || role.name;
  if (key) store[key] = cloneRole(role);
}

export function findDepartedFriend(state, name) {
  const store = ensureDepartedFriends(state);
  if (store[name]) return store[name];
  return Object.values(store).find((r) => r.oldName === name || r.name === name) || null;
}

/**
 * Original initialize_role(n, new): new=0 loads dat\ if present; new=1 uses the template.
 * Current party members are already serialized on save.party.
 */
export function createJoinedRole(state, name, mode) {
  if (Number(mode) === 0) {
    const saved = findDepartedFriend(state, name);
    if (saved) return cloneRole(saved);
  }
  return createRoleFromTemplate(name, name);
}

let ensuringParty = false;

function hasParty(state) {
  return Array.isArray(state?.party) && state.party.length > 0;
}

export function ensureParty(state) {
  if (ensuringParty) {
    if (!hasParty(state)) {
      state.party = [createRoleFromTemplate('\u65e0\u540d', state.player?.name || '\u65e0\u540d')];
    }
    return;
  }
  ensuringParty = true;
  try {
    if (!hasParty(state)) {
      state.party = [createRoleFromTemplate('\u65e0\u540d', state.player?.name || '\u65e0\u540d')];
    }
    state.party.forEach((role) => ensureRoleArrays(role));
    if (!Array.isArray(state.friendList)) state.friendList = [];
    ensureDepartedFriends(state);
    if (!state.temp || typeof state.temp !== 'object') state.temp = {};
    if (!state.tempStrings || typeof state.tempStrings !== 'object') state.tempStrings = {};
    if (!state.sceneEvents || typeof state.sceneEvents !== 'object') state.sceneEvents = {};
    if (!state.resEvents || typeof state.resEvents !== 'object') state.resEvents = {};
    syncPlayerFromRole(state, 0);
  } finally {
    ensuringParty = false;
  }
}

export function createRoleFromTemplate(oldName, displayName) {
  const tpl = getPersonaTemplate(oldName);
  const stats = tpl?.stats?.length >= 64 ? [...tpl.stats.slice(0, 64)] : defaultStats();
  if (displayName) stats[STAT.money] = stats[STAT.money] || 50;
  const role = {
    oldName: tpl?.oldName || oldName,
    name: displayName || tpl?.name || oldName,
    stats,
    equip: new Array(10).fill(0),
    ji: new Array(24).fill(0),
    fa: new Array(64).fill(0),
    hidden: 1,
    savedHidden: 1,
  };
  if (tpl) initRoleFromTemplate(role, tpl, displayName || tpl.name || oldName);
  return role;
}

export function bootstrapRoleStats(state, roleIndex = 0) {
  const role = state.party?.[roleIndex];
  if (!role || role.equipBootstrapped) return;
  ensureRoleArrays(role);
  applyTemplateEquipment(state, roleIndex, role);
  role.equipBootstrapped = true;
}

function defaultStats() {
  const s = new Array(64).fill(0);
  s[STAT.money] = 50;
  s[STAT.life] = 100;
  s[STAT.gdsmz27] = 100;
  s[STAT.lingli] = 50;
  s[STAT.gdll26] = 50;
  s[STAT.grade] = 1;
  s[STAT.sex] = 1;
  s[STAT.hide] = 1;
  return s;
}

export function getRoleCount(state) {
  ensureParty(state);
  return state.party.length;
}

/** Maze travel: deduct maxTili * wordCount * 1% per party member; stamina floors at 0. */
export function deductPartyTiliForMazeTravel(state, wordCount) {
  deductPartyTiliByMaxPercent(state, wordCount);
}

/** Inter-city travel: deduct maxTili * percent / 100 per member; never blocks travel. */
export function deductPartyTiliForCityTravel(state, percentOfMax) {
  deductPartyTiliByMaxPercent(state, percentOfMax);
}

function deductPartyTiliByMaxPercent(state, percentOfMax) {
  const p = Math.max(1, Number(percentOfMax) || 1);
  for (let i = 0; i < getRoleCount(state); i += 1) {
    const max = readValues(state, i, STAT.gdtl25);
    const cur = readValues(state, i, STAT.tili);
    const cost = Math.floor((max * p) / 100);
    writeValues(state, i, STAT.tili, Math.max(0, cur - cost));
  }
  syncPlayerFromRole(state, 0);
}

export function getRoleH(state) {
  return getRoleCount(state) - 1;
}

export function findRoleIndex(state, oldName) {
  ensureParty(state);
  return state.party.findIndex((r) => r.oldName === oldName || r.name === oldName);
}

export function readValues(state, roleIndex, statIndex) {
  if (!hasParty(state)) ensureParty(state);
  if (roleIndex < 0 || roleIndex >= state.party.length) return 0;
  return Number(state.party[roleIndex].stats[statIndex]) || 0;
}

export function writeValues(state, roleIndex, statIndex, value) {
  if (!hasParty(state)) ensureParty(state);
  if (roleIndex < 0 || roleIndex >= state.party.length) return false;
  state.party[roleIndex].stats[statIndex] = Math.max(0, Number(value) || 0);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
  return true;
}

export function syncPlayerFromRole(state, roleIndex = 0) {
  const role = state.party[roleIndex];
  if (!role || !state.player) return;
  state.player.name = role.name;
  state.player.money = readValues(state, roleIndex, STAT.money);
  state.player.hp = readValues(state, roleIndex, STAT.life);
  state.player.maxHp = readValues(state, roleIndex, STAT.gdsmz27) || state.player.hp;
  state.player.mp = readValues(state, roleIndex, STAT.lingli);
  state.player.maxMp = readValues(state, roleIndex, STAT.gdll26) || state.player.mp;
  state.player.exp = readValues(state, roleIndex, STAT.experience);
  state.player.level = readValues(state, roleIndex, STAT.grade) || 1;
  state.player.sex = readValues(state, roleIndex, STAT.sex) === 0 ? 0 : 1;
  state.partyCount = state.party.length;
}

export function syncRoleFromPlayer(state, roleIndex = 0) {
  const p = state.player;
  if (!p) return;
  writeValues(state, roleIndex, STAT.money, p.money);
  writeValues(state, roleIndex, STAT.life, p.hp);
  writeValues(state, roleIndex, STAT.gdsmz27, p.maxHp);
  writeValues(state, roleIndex, STAT.lingli, p.mp);
  writeValues(state, roleIndex, STAT.gdll26, p.maxMp);
  writeValues(state, roleIndex, STAT.experience, p.exp);
  writeValues(state, roleIndex, STAT.grade, p.level);
  writeValues(state, roleIndex, STAT.sex, p.sex ?? 1);
  if (state.party[roleIndex]) state.party[roleIndex].name = p.name;
}

export function getRoleDisplayName(state, roleIndex) {
  ensureParty(state);
  const idx = (roleIndex <= 0 ? 1 : roleIndex) - 1;
  const role = state.party[idx];
  if (!role) return ' ';
  const rank = readValues(state, idx, STAT.touxian);
  if (rank > 0) {
    const title = getGameConfig()?.touxian?.ranks?.[rank - 1] || '';
    if (title) return `${role.name}(${title})`;
  }
  return role.name;
}

export function getGoodsTypeIcon(name) {
  const info = getGoodsInfo(name);
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  for (const [mask, icon] of GOODS_TYPE_ICON) {
    if (typeNum & mask) return icon;
  }
  return 'img_w_0.gif';
}

export function gameBaseRandom(max) {
  const n = Math.max(1, Number(max) || 1);
  return 1 + Math.floor(Math.random() * n);
}

/** Same range as Delphi Game_base_random: 0 .. max-1 */
export function gameBaseRandomZero(max) {
  const n = Math.max(1, Number(max) || 1);
  return Math.floor(Math.random() * n);
}

export function gameRandomChance(state, max) {
  let n = Math.max(1, Number(max) || 1);
  if (gameBaseRandom(n) === 1) return true;
  const luck = readValues(state, 0, STAT.luck);
  const intellect = readValues(state, 0, STAT.intellect);
  n = n * 5 + Math.round(Math.abs(1 - Math.abs((luck + intellect - 100) / 100)) * n * 10);
  return gameBaseRandom(Math.max(1, n)) === 1;
}

export function parseEventIdList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export function sceneEventValue(state, id) {
  const v = state.sceneEvents[id];
  return v === undefined || v === null ? 0 : Number(v) || 0;
}

export function resEventValue(state, id) {
  const v = state.resEvents[id];
  return v === undefined || v === null ? 0 : Number(v) || 0;
}
