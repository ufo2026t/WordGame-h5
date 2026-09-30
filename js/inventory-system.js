import { getGoodsById, getGoodsInfo } from './goods-data.js';
import { getSpecialItemScript } from './game-config.js';
import { readValues, writeValues, STAT, syncPlayerFromRole } from './game-runtime.js';

/** Max stack per item type (all acquisition paths). */
export const MAX_GOODS_STACK = 999;

export const EQUIP_SLOTS = {
  1: '\u5934\u6234',
  2: '\u8eab\u7a7f',
  3: '\u62ab\u98ce',
  4: '\u811a\u7a7f',
  5: '\u62a4\u8155',
  6: '\u6212\u6307',
  7: '\u9879\u94fe',
  8: '\u6b66\u5668',
  9: '\u8170\u6302',
};

const GOODS_FIELD = {
  f1: 'defense',
  t1: 'hp',
  L1: 'magic',
  s1: 'speed',
  m1: 'luck',
  g1: 'attack',
  z1: 'intel',
  y1: 'fortune',
  n1: 'durability',
  j1: 'price',
};

export function getGoodsStat(info, field) {
  if (!info) return 0;
  const key = GOODS_FIELD[field] || field;
  return Number(info[key]) || 0;
}

export function getGoodsStatById(id, field) {
  return getGoodsStat(getGoodsById(id), field);
}

export function decodeSkillId(entry) {
  return Number(entry) & 0xffff;
}

export function decodeSkillLevel(entry) {
  return (Number(entry) >>> 24) & 0xff;
}

export function decodeSkillUses(entry) {
  return (Number(entry) >>> 16) & 0xff;
}

export function encodeSkillEntry(goodsId, level = 1) {
  return ((level & 0xff) << 24) | (Number(goodsId) & 0xffff);
}

export function ensureRoleArrays(role) {
  if (!Array.isArray(role.equip) || role.equip.length < 10) {
    role.equip = new Array(10).fill(0);
  }
  if (!Array.isArray(role.ji) || role.ji.length < 24) {
    role.ji = new Array(24).fill(0);
  }
  if (!Array.isArray(role.fa) || role.fa.length < 64) {
    role.fa = new Array(64).fill(0);
  }
}

export function getRoleLevel(state, roleIndex) {
  return readValues(state, roleIndex, STAT.grade) || 1;
}

export function getRoleSex(state, roleIndex) {
  return readValues(state, roleIndex, STAT.sex) === 0 ? 0 : 1;
}

export function isGenderMatch(n1Value, roleSex) {
  const code = Number(n1Value) || 0;
  if (code > 300) return true;
  if (code > 200) return roleSex === 0;
  return roleSex === 1;
}

export function getEquipSlotFromGoods(info) {
  if (!info) return 0;
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  if (typeNum & 16) return 8;
  if (typeNum & 1) {
    const slot = Number(info.durability) % 100;
    return slot >= 1 && slot <= 9 ? slot : 0;
  }
  return 0;
}

export function canEquipGoods(state, roleIndex, goodsId) {
  const info = getGoodsById(goodsId);
  if (!info) return { ok: false, reason: '\u7269\u54c1\u4e0d\u5b58\u5728' };
  const slot = getEquipSlotFromGoods(info);
  if (!slot) return { ok: false, reason: '\u8be5\u7269\u54c1\u4e0d\u80fd\u88c5\u5907' };

  const n1 = getGoodsStat(info, 'n1');
  const levelReq = getGoodsStat(info, 'y1');
  const roleSex = getRoleSex(state, roleIndex);
  const roleLevel = getRoleLevel(state, roleIndex);

  if (!isGenderMatch(n1, roleSex)) {
    return { ok: false, reason: '\u6027\u522b\u4e0d\u5339\u914d' };
  }

  const slotMod = n1 % 100;
  if (slotMod < 5 && levelReq > roleLevel) {
    return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
  }

  if ((Number(info.typeNum ?? info.type) || 0) & 16) {
    if (levelReq > roleLevel) {
      return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
    }
  }

  return { ok: true, slot };
}

function clampVitals(state, roleIndex) {
  const life = readValues(state, roleIndex, STAT.life);
  const maxLife = readValues(state, roleIndex, STAT.gdsmz27);
  if (life > maxLife) writeValues(state, roleIndex, STAT.life, maxLife);

  const tili = readValues(state, roleIndex, STAT.tili);
  const maxTili = readValues(state, roleIndex, STAT.gdtl25);
  if (tili > maxTili) writeValues(state, roleIndex, STAT.tili, maxTili);

  const lingli = readValues(state, roleIndex, STAT.lingli);
  const maxLingli = readValues(state, roleIndex, STAT.gdll26);
  if (lingli > maxLingli) writeValues(state, roleIndex, STAT.lingli, maxLingli);
}

export function applyEquipStats(state, roleIndex, goodsId, add) {
  if (!goodsId) return;
  const info = getGoodsById(goodsId);
  if (!info) return;
  const sign = add ? 1 : -1;
  const changes = [
    [STAT.luck, 'y1'],
    [STAT.speed, 's1'],
    [STAT.attack, 'g1'],
    [STAT.intellect, 'z1'],
    [STAT.defend, 'f1'],
    [STAT.gdtl25, 't1'],
    [STAT.gdll26, 'L1'],
    [STAT.gdsmz27, 'm1'],
  ];
  for (const [stat, field] of changes) {
    const delta = getGoodsStat(info, field) * sign;
    if (delta) writeValues(state, roleIndex, stat, readValues(state, roleIndex, stat) + delta);
  }
  if (!add) clampVitals(state, roleIndex);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

export function applyConsumableStats(state, roleIndex, goodsId) {
  const info = getGoodsById(goodsId);
  if (!info) return;
  const changes = [
    [STAT.luck, 'y1'],
    [STAT.speed, 's1'],
    [STAT.attack, 'g1'],
    [STAT.intellect, 'z1'],
    [STAT.defend, 'f1'],
    [STAT.tili, 't1'],
    [STAT.lingli, 'L1'],
    [STAT.life, 'm1'],
  ];
  for (const [stat, field] of changes) {
    const delta = getGoodsStat(info, field);
    if (delta) writeValues(state, roleIndex, stat, readValues(state, roleIndex, stat) + delta);
  }
  clampVitals(state, roleIndex);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

export function getGoodsCountByName(state, name) {
  return state.player?.goods?.[name] || 0;
}

export function clampGoodsStack(count) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return 0;
  return Math.min(MAX_GOODS_STACK, n);
}

/** Clamp every stack when loading saves or imports. */
export function normalizePlayerGoods(player) {
  if (!player?.goods || typeof player.goods !== 'object') return;
  for (const [name, count] of Object.entries(player.goods)) {
    const clamped = clampGoodsStack(count);
    if (clamped <= 0) delete player.goods[name];
    else player.goods[name] = clamped;
  }
}

/**
 * Change inventory count by name. Returns applied delta (may be less than requested when capped at 999).
 */
export function changeGoodsByName(state, name, delta) {
  if (!state.player.goods) state.player.goods = {};
  const cur = getGoodsCountByName(state, name);
  const d = Math.floor(Number(delta) || 0);
  if (d === 0) return 0;

  if (d > 0) {
    const room = MAX_GOODS_STACK - cur;
    if (room <= 0) return 0;
    const applied = Math.min(d, room);
    state.player.goods[name] = cur + applied;
    return applied;
  }

  const next = cur + d;
  if (next <= 0) {
    delete state.player.goods[name];
    return -cur;
  }
  state.player.goods[name] = next;
  return d;
}

export function resolveGoodsId(nameOrId) {
  if (typeof nameOrId === 'number') return nameOrId;
  const n = Number(nameOrId);
  if (n > 0 && getGoodsById(n)) return n;
  return getGoodsInfo(nameOrId).id || 0;
}

export function listInventoryByCategory(state) {
  const goods = state.player?.goods || {};
  const buckets = {
    weapon: [],
    equipment: [],
    medicine: [],
    craft: [],
    special: [],
  };

  for (const [name, count] of Object.entries(goods)) {
    if (!count) continue;
    const info = getGoodsInfo(name);
    const typeNum = Number(info.typeNum ?? info.type) || 0;
    const entry = { name, count, info, id: info.id || resolveGoodsId(name) };
    if (typeNum & 16) buckets.weapon.push(entry);
    else if (typeNum & 1) buckets.equipment.push(entry);
    else if (typeNum & 2) buckets.medicine.push(entry);
    else if (typeNum & 8) buckets.craft.push(entry);
    else if (typeNum & 128 || typeNum & 64 || typeNum & 4 || typeNum & 256) buckets.special.push(entry);
    else buckets.special.push(entry);
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  return buckets;
}

export function getEquippedGoods(state, roleIndex) {
  const role = state.party?.[roleIndex];
  if (!role) return {};
  ensureRoleArrays(role);
  const out = {};
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = role.equip[slot] || 0;
    if (id) out[slot] = getGoodsById(id);
  }
  return out;
}

export function equipGoods(state, roleIndex, goodsName) {
  const role = state.party?.[roleIndex];
  if (!role) return { ok: false, reason: '\u89d2\u8272\u4e0d\u5b58\u5728' };
  ensureRoleArrays(role);

  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };

  const goodsId = resolveGoodsId(goodsName);
  const check = canEquipGoods(state, roleIndex, goodsId);
  if (!check.ok) return check;

  const slot = check.slot;
  const prev = role.equip[slot] || 0;
  if (prev) {
    applyEquipStats(state, roleIndex, prev, false);
    const prevInfo = getGoodsById(prev);
    if (prevInfo?.name) changeGoodsByName(state, prevInfo.name, 1);
  }

  changeGoodsByName(state, goodsName, -1);
  role.equip[slot] = goodsId;
  applyEquipStats(state, roleIndex, goodsId, true);
  return { ok: true, slot };
}

export function unequipSlot(state, roleIndex, slot) {
  const role = state.party?.[roleIndex];
  if (!role) return { ok: false, reason: '\u89d2\u8272\u4e0d\u5b58\u5728' };
  ensureRoleArrays(role);
  const goodsId = role.equip[slot] || 0;
  if (!goodsId) return { ok: false, reason: '\u6ca1\u6709\u88c5\u5907' };

  applyEquipStats(state, roleIndex, goodsId, false);
  role.equip[slot] = 0;
  const info = getGoodsById(goodsId);
  if (info?.name) changeGoodsByName(state, info.name, 1);
  return { ok: true };
}

export function dropGoods(state, goodsName, dropAll = true) {
  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  changeGoodsByName(state, goodsName, dropAll ? -count : -1);
  return { ok: true };
}

export function useMedicine(state, roleIndex, goodsName) {
  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  const info = getGoodsInfo(goodsName);
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  if (!(typeNum & 2)) return { ok: false, reason: '\u4e0d\u662f\u836f\u54c1' };

  changeGoodsByName(state, goodsName, -1);
  applyConsumableStats(state, roleIndex, info.id || resolveGoodsId(goodsName));
  return { ok: true };
}

export function addJi(role, goodsId) {
  ensureRoleArrays(role);
  for (let i = 0; i < role.ji.length; i += 1) {
    if (!role.ji[i]) {
      role.ji[i] = encodeSkillEntry(goodsId, 1);
      return true;
    }
    if (decodeSkillId(role.ji[i]) === goodsId) return false;
  }
  return false;
}

export function addFa(role, goodsId) {
  ensureRoleArrays(role);
  for (let i = 0; i < role.fa.length; i += 1) {
    if (!role.fa[i]) {
      role.fa[i] = encodeSkillEntry(goodsId, 1);
      return true;
    }
    if (decodeSkillId(role.fa[i]) === goodsId) return false;
  }
  return false;
}

export function learnSkillBook(state, roleIndex, bookName) {
  const count = getGoodsCountByName(state, bookName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };

  const book = getGoodsInfo(bookName);
  const typeNum = Number(book.typeNum ?? book.type) || 0;
  if (!(typeNum & 128)) return { ok: false, reason: '\u4e0d\u662f\u79d8\u7c4d' };

  const skillId = resolveGoodsId(book.name);
  const skillInfo = getGoodsById(skillId) || book;
  const sexReq = getGoodsStat(skillInfo, 'f1');
  const roleSex = getRoleSex(state, roleIndex);
  if (sexReq !== 3 && roleSex !== sexReq) {
    return { ok: false, reason: sexReq === 1 ? '\u53ea\u9002\u5408\u7537\u6027' : '\u53ea\u9002\u5408\u5973\u6027' };
  }

  const levelReq = getGoodsStat(skillInfo, 'n1');
  if (levelReq > getRoleLevel(state, roleIndex)) {
    return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
  }

  const role = state.party[roleIndex];
  ensureRoleArrays(role);
  const isJi = getGoodsStat(skillInfo, 'j1') === 3;
  const learned = isJi ? addJi(role, skillId) : addFa(role, skillId);
  if (!learned) return { ok: false, reason: '\u5df2\u7ecf\u5b66\u4f1a' };

  changeGoodsByName(state, bookName, -1);
  return { ok: true, kind: isJi ? 'ji' : 'fa' };
}

export function listSkills(role) {
  ensureRoleArrays(role);
  const ji = [];
  const fa = [];
  for (const entry of role.ji) {
    if (!entry) continue;
    const id = decodeSkillId(entry);
    const info = getGoodsById(id);
    ji.push({ id, level: decodeSkillLevel(entry), name: info?.name || `#${id}`, info });
  }
  for (const entry of role.fa) {
    if (!entry) continue;
    const id = decodeSkillId(entry);
    const info = getGoodsById(id);
    fa.push({ id, level: decodeSkillLevel(entry), name: info?.name || `#${id}`, info });
  }
  return { ji, fa };
}

export function applyTemplateEquipment(state, roleIndex, role) {
  ensureRoleArrays(role);
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = role.equip[slot] || 0;
    if (id) applyEquipStats(state, roleIndex, id, true);
  }
}

export function initRoleFromTemplate(role, tpl, displayName) {
  ensureRoleArrays(role);
  if (tpl?.equip?.length) {
    for (let i = 0; i < 10; i += 1) {
      role.equip[i] = Number(tpl.equip[i]) || 0;
    }
  }
  if (tpl?.ji?.length) {
    for (let i = 0; i < 24; i += 1) role.ji[i] = Number(tpl.ji[i]) || 0;
  }
  if (tpl?.fa?.length) {
    for (let i = 0; i < 64; i += 1) role.fa[i] = Number(tpl.fa[i]) || 0;
  }
  if (displayName) role.name = displayName;
  if (tpl?.oldName) role.oldName = tpl.oldName;
}

export async function useSpecialGoods(api, roleIndex, goodsName) {
  const script = getSpecialItemScript(goodsName);
  if (!script) return { ok: false, reason: '\u8be5\u7269\u54c1\u4e0d\u80fd\u5728\u6b64\u4f7f\u7528' };
  if (getGoodsCountByName(api.state, goodsName) <= 0) {
    return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  }

  changeGoodsByName(api.state, goodsName, -1);
  const prepared = script.replace(/\$P\$/g, String(roleIndex + 1));
  await api.runScript(prepared);
  api.ui.refreshStatus();
  api.persist();
  return { ok: true };
}
