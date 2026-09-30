import { normalizePlayerGoods } from './inventory-system.js';

/** Number of save slots (matches original save dialog list capacity). */
export const SAVE_SLOT_COUNT = 50;

const LEGACY_SAVE_KEY = 'wordgame-save-v1';
const INDEX_KEY = 'wordgame-save-index-v1';
const SLOT_KEY_PREFIX = 'wordgame-save-slot-';
const SLOT_KEY_SUFFIX = '-v1';

export function createDefaultPlayer() {
  return {
    name: '\u65e0\u540d',
    sex: 1,
    money: 50,
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    level: 1,
    exp: 0,
    goods: {},
    skills: {
      sword: { level: 0, uses: 0 },
      medicine: { level: 0, uses: 0 },
      equip: { level: 0, uses: 0 },
      hidden: { level: 0, uses: 0 },
    },
  };
}

export function createDefaultSave() {
  return {
    player: createDefaultPlayer(),
    party: null,
    friendList: [],
    departedFriends: {},
    sceneEvents: {},
    resEvents: {},
    tasks: {},
    dialogue: {},
    messages: [],
    partyCount: 1,
    temp: {},
    tempStrings: {},
    currentScene: 10000,
    currentSceneAttr: 0,
    oldScene: 10000,
    homeScene: 10001,
    mazeFactor: 0,
    weather: 0,
    readTextIndex: 0,
    noGoHome: false,
    chatLocked: false,
    gameTimer: null,
    gameTimeLeft: 0,
    gameTimePage: 0,
    deferredScript: '',
    pendingMazeWordTravelCost: 0,
    wordStats: { correct: 0, wrong: 0 },
    wordProgress: {},
    sequentialIndex: 0,
    abhsByLib: {},
    partSlotsByLib: {},
    started: false,
    savedAt: null,
    slotId: null,
  };
}

function slotStorageKey(slotId) {
  return `${SLOT_KEY_PREFIX}${slotId}${SLOT_KEY_SUFFIX}`;
}

function normalizeStats(raw) {
  const stats = Array.isArray(raw) ? raw.slice(0, 64) : [];
  while (stats.length < 64) stats.push(0);
  return stats;
}

function normalizeRole(role, fallbackName) {
  if (!role) return null;
  return {
    oldName: role.oldName || fallbackName || '\u65e0\u540d',
    name: role.name || fallbackName || '\u65e0\u540d',
    stats: normalizeStats(role.stats),
    equip: Array.isArray(role.equip) ? role.equip.slice(0, 10) : new Array(10).fill(0),
    ji: Array.isArray(role.ji) ? role.ji.slice(0, 24) : new Array(24).fill(0),
    fa: Array.isArray(role.fa) ? role.fa.slice(0, 64) : new Array(64).fill(0),
    hidden: role.hidden ?? 1,
    savedHidden: role.savedHidden ?? 1,
    equipBootstrapped: role.equipBootstrapped ?? true,
  };
}

export function normalizeSaveParty(save) {
  if (Array.isArray(save.party)) {
    save.party = save.party.map((role) => normalizeRole(role, save.player?.name));
  }
  if (!save.departedFriends || typeof save.departedFriends !== 'object' || Array.isArray(save.departedFriends)) {
    save.departedFriends = {};
  } else {
    const out = {};
    for (const [key, role] of Object.entries(save.departedFriends)) {
      const n = normalizeRole(role, key);
      if (n) out[n.oldName || key] = n;
    }
    save.departedFriends = out;
  }
  return save;
}

function normalizeLoadedSave(parsed) {
  const base = createDefaultSave();
  const save = normalizeSaveParty({
    ...base,
    ...parsed,
    player: {
      ...base.player,
      ...parsed.player,
      skills: {
        ...base.player.skills,
        ...(parsed.player?.skills || {}),
      },
    },
    party: parsed.party || base.party,
    friendList: parsed.friendList || base.friendList,
    departedFriends: parsed.departedFriends || base.departedFriends,
    tempStrings: parsed.tempStrings || base.tempStrings,
    sceneEvents: parsed.sceneEvents || base.sceneEvents,
    resEvents: parsed.resEvents || base.resEvents,
    tasks: parsed.tasks || base.tasks,
    messages: Array.isArray(parsed.messages) ? parsed.messages : base.messages,
    dialogue: parsed.dialogue || base.dialogue,
    wordProgress: parsed.wordProgress || base.wordProgress,
    abhsByLib: parsed.abhsByLib || base.abhsByLib,
    partSlotsByLib: parsed.partSlotsByLib || base.partSlotsByLib,
  });
  normalizePlayerGoods(save.player);
  return save;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatCompactTimestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function buildSlotLabel(save, sceneName = '') {
  const prefix = sceneName || '\u5b58\u6863';
  return `${prefix}${formatCompactTimestamp(save?.savedAt ? new Date(save.savedAt) : new Date())}`;
}

function emptyIndex() {
  return { activeSlotId: null, entries: {} };
}

export function loadSaveIndex() {
  migrateLegacySave();
  const idx = readJson(INDEX_KEY, emptyIndex());
  if (!idx.entries || typeof idx.entries !== 'object') idx.entries = {};
  if (!('activeSlotId' in idx)) idx.activeSlotId = null;
  return idx;
}

function writeSaveIndex(index) {
  writeJson(INDEX_KEY, index);
}

export function migrateLegacySave() {
  const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
  if (!legacy) return false;
  try {
    const parsed = JSON.parse(legacy);
    if (parsed?.started) {
      persistSaveToSlot(0, normalizeLoadedSave(parsed), { sceneName: '\u65e7\u6863\u6848' });
      writeSaveIndex({ ...loadSaveIndex(), activeSlotId: 0 });
    }
  } catch {
    /* ignore corrupt legacy save */
  }
  localStorage.removeItem(LEGACY_SAVE_KEY);
  return true;
}

export function getActiveSlotId() {
  const idx = loadSaveIndex();
  return Number.isInteger(idx.activeSlotId) ? idx.activeSlotId : null;
}

export function setActiveSlotId(slotId) {
  const idx = loadSaveIndex();
  idx.activeSlotId = slotId;
  writeSaveIndex(idx);
}

export function slotHasData(slotId) {
  return !!localStorage.getItem(slotStorageKey(slotId));
}

export function loadSlot(slotId) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SAVE_SLOT_COUNT) return null;
  try {
    const raw = localStorage.getItem(slotStorageKey(slotId));
    if (!raw) return null;
    return normalizeLoadedSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getSlotMeta(slotId) {
  const idx = loadSaveIndex();
  const entry = idx.entries[String(slotId)];
  if (!entry) return null;
  return { slotId, ...entry };
}

export function listSaveSlots() {
  const idx = loadSaveIndex();
  const slots = [];
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    const meta = idx.entries[String(i)];
    const save = loadSlot(i);
    if (meta || save) {
      slots.push({
        slotId: i,
        label: meta?.label || buildSlotLabel(save),
        savedAt: meta?.savedAt || save?.savedAt || null,
        playerName: meta?.playerName || save?.player?.name || '\u65c5\u4eba',
        level: meta?.level ?? save?.player?.level ?? 1,
        scene: meta?.scene ?? save?.currentScene ?? 10000,
        money: meta?.money ?? save?.player?.money ?? 0,
        empty: false,
      });
    } else {
      slots.push({ slotId: i, empty: true, label: '\u7a7a' });
    }
  }
  return slots;
}

export function countNonEmptySlots() {
  return listSaveSlots().filter((s) => !s.empty).length;
}

export function hasAnySave() {
  return countNonEmptySlots() > 0;
}

export function findFirstEmptySlot() {
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    if (!slotHasData(i)) return i;
  }
  return null;
}

export function findMostRecentSlot() {
  const idx = loadSaveIndex();
  let bestId = null;
  let bestTime = 0;
  for (const [key, entry] of Object.entries(idx.entries || {})) {
    const t = Date.parse(entry.savedAt || '') || 0;
    if (t >= bestTime && slotHasData(Number(key))) {
      bestTime = t;
      bestId = Number(key);
    }
  }
  if (bestId != null) return bestId;
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    if (slotHasData(i)) return i;
  }
  return null;
}

function updateIndexEntry(slotId, save, sceneName) {
  const idx = loadSaveIndex();
  idx.entries[String(slotId)] = {
    label: buildSlotLabel(save, sceneName),
    savedAt: save.savedAt,
    playerName: save.player?.name || '\u65c5\u4eba',
    level: save.player?.level ?? 1,
    scene: save.currentScene ?? 10000,
    money: save.player?.money ?? 0,
  };
  idx.activeSlotId = slotId;
  writeSaveIndex(idx);
}

export function persistSaveToSlot(slotId, save, { sceneName = '' } = {}) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SAVE_SLOT_COUNT) {
    throw new Error('\u65e0\u6548\u7684\u5b58\u6863\u69fd\u4f4d');
  }
  save.savedAt = new Date().toISOString();
  save.slotId = slotId;
  localStorage.setItem(slotStorageKey(slotId), JSON.stringify(save));
  updateIndexEntry(slotId, save, sceneName);
  return slotId;
}

export function deleteSlot(slotId) {
  localStorage.removeItem(slotStorageKey(slotId));
  const idx = loadSaveIndex();
  delete idx.entries[String(slotId)];
  if (idx.activeSlotId === slotId) idx.activeSlotId = findMostRecentSlot();
  writeSaveIndex(idx);
}

/** Persist current play session to active slot (assigns first empty slot if needed). */
export function persistSave(save, { slotId, sceneName } = {}) {
  if (!save.started) return null;
  let target = slotId;
  if (!Number.isInteger(target)) {
    target = getActiveSlotId();
  }
  if (!Number.isInteger(target)) {
    target = findFirstEmptySlot();
  }
  if (!Number.isInteger(target)) {
    target = 0;
  }
  return persistSaveToSlot(target, save, { sceneName });
}

/** Load save for current browser session (active slot, else default new game). */
export function loadSessionSave() {
  migrateLegacySave();
  const active = getActiveSlotId();
  if (active != null) {
    const save = loadSlot(active);
    if (save?.started) return save;
  }
  const recent = findMostRecentSlot();
  if (recent != null) {
    const save = loadSlot(recent);
    if (save?.started) {
      setActiveSlotId(recent);
      return save;
    }
  }
  return createDefaultSave();
}

/** @deprecated use hasAnySave */
export function hasSave() {
  return hasAnySave();
}

/** @deprecated use loadSessionSave */
export function loadSave() {
  return loadSessionSave();
}
