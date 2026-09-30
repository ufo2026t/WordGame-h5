import {
  createDefaultSave,
  normalizeSaveParty,
  persistSaveToSlot,
  setActiveSlotId,
  getActiveSlotId,
  findFirstEmptySlot,
  loadSlot,
} from './save-manager.js';
import { normalizePlayerGoods } from './inventory-system.js';
import { ensureParty, syncPlayerFromRole } from './game-runtime.js';

export const SAVE_EXPORT_PREFIX = 'WGSAVE1:';

/** Serialize game state to a single portable string (clipboard-friendly). */
export function exportSaveString(save) {
  const payload = JSON.stringify(save);
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return SAVE_EXPORT_PREFIX + btoa(binary);
}

function decodePayloadString(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('\u8bf7\u8f93\u5165\u975e\u7a7a\u5b57\u7b26\u4e32');

  if (trimmed.startsWith(SAVE_EXPORT_PREFIX)) {
    const b64 = trimmed.slice(SAVE_EXPORT_PREFIX.length);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  if (trimmed.startsWith('{')) return trimmed;
  throw new Error(
    '\u65e0\u6cd5\u8bc6\u522b\u7684\u5b58\u6863\u683c\u5f0f\uff0c\u8bf7\u4f7f\u7528 WGSAVE1: \u5f00\u5934\u6216\u7c98\u8d34\u5b8c\u6574 JSON',
  );
}

/** Parse exported string into normalized save object. */
export function importSaveString(text) {
  const json = decodePayloadString(text);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('\u5b58\u6863\u6570\u636e\u635f\u574f\u6216\u4e0d\u662f\u5408\u6cd5 JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('\u5b58\u6863\u7ed3\u6784\u65e0\u6548');
  }
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

export function getSaveSummary(save) {
  const name = save?.player?.name || '\u65c5\u4eba';
  const scene = save?.currentScene ?? 10000;
  const money = save?.player?.money ?? 0;
  const level = save?.player?.level ?? 1;
  const slot = Number.isInteger(save?.slotId) ? save.slotId + 1 : '-';
  const when = save?.savedAt
    ? new Date(save.savedAt).toLocaleString()
    : '\u5c1a\u672a\u4fdd\u5b58';
  return { name, scene, money, level, when, slot };
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export async function readClipboardText() {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error(
    '\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u8bfb\u53d6\u526a\u8d34\u677f\uff0c\u8bf7\u624b\u52a8\u7c98\u8d34\u5230\u6587\u672c\u6846',
  );
}

export function mergeSaveInto(target, imported) {
  Object.keys(target).forEach((k) => { delete target[k]; });
  Object.assign(target, imported);
}

export function applySaveToGame(app, save, { slotId, sceneName, persist = true } = {}) {
  mergeSaveInto(app.state, save);
  ensureParty(app.state);
  syncPlayerFromRole(app.state, 0);
  app.wordEngine?.resetErrorList?.(app.settings);
  let targetSlot = slotId;
  if (!Number.isInteger(targetSlot)) targetSlot = save.slotId;
  if (!Number.isInteger(targetSlot)) targetSlot = getActiveSlotId();
  if (!Number.isInteger(targetSlot)) targetSlot = findFirstEmptySlot();
  if (Number.isInteger(targetSlot)) {
    save.slotId = targetSlot;
    app.state.slotId = targetSlot;
    setActiveSlotId(targetSlot);
    if (persist && save.started) {
      persistSaveToSlot(targetSlot, app.state, { sceneName });
    }
  }
  app.ui.refreshStatus();
}

export async function loadSlotIntoGame(app, slotId) {
  const save = loadSlot(slotId);
  if (!save?.started) {
    throw new Error('\u8be5\u69fd\u4f4d\u6ca1\u6709\u53ef\u8bfb\u6863\u6848');
  }
  applySaveToGame(app, save, { slotId, persist: false });
  setActiveSlotId(slotId);
  sessionStorage.setItem('wordgame-in-progress', '1');
  await app.api.game_show_scene(save.currentScene || 10001);
}
