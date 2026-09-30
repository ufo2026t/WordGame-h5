import { getGoodsById, getGoodsInfo } from './goods-data.js';
import {
  changeGoodsByName,
  decodeSkillId,
  decodeSkillLevel,
  decodeSkillUses,
  ensureRoleArrays,
  getGoodsCountByName,
  listSkills,
} from './inventory-system.js';
import { gameBaseRandom, readValues, writeValues, STAT, syncPlayerFromRole } from './game-runtime.js';
import {
  pickActiveMonster,
  getRoleSpeed,
  getMonsterSpeed,
  getMonsterDefense,
  calcDamageAfterDefense,
  applySpellDebuffsToMonster,
  formatSpellDebuffText,
} from './combat.js';

const FULL_QI = 999999999;
const HALF_QI = 99999999;
const FULL = 9999999;
const HALF = 999999;

function statNum(info, key) {
  return Number(info?.[key]) || 0;
}

/** Effect strength (damage/debuff): +10% every 2 spell levels, max +40% at Lv10. */
export function spellEffectLevelScale(level) {
  const j = Math.max(1, Math.min(10, Number(level) || 1));
  return 1 + Math.floor((j - 1) / 2) * 0.1;
}

function levelScale(level) {
  return spellEffectLevelScale(level);
}

/** MP ∝ spell damage (luck). Baseline: 120 dmg → 25 MP (ratio 25/120). */
const MP_PER_DAMAGE = 25 / 120;
/** AoE hits all enemies; costs more MP per point of luck than single-target. */
const AOE_MP_PER_DAMAGE = 25 / 90;

function spellMpLevelBonus(level) {
  const j = Math.max(1, Math.min(10, Number(level) || 1));
  return 1 + Math.floor((j - 1) / 4) * 0.02;
}

export function calcAttackSpellMpCost(info, level = 1) {
  const luck = statNum(info, 'luck');
  if (luck <= 0) return Math.max(1, statNum(info, 'magic'));
  const singleTarget = statNum(info, 'fortune') === 1;
  const ratio = singleTarget ? MP_PER_DAMAGE : AOE_MP_PER_DAMAGE;
  const baseMp = Math.round(luck * ratio);
  return Math.max(1, Math.floor(baseMp * spellMpLevelBonus(level)));
}

function encodeSkillEntryFull(id, level, uses) {
  return ((level & 0xff) << 24) | ((uses & 0xff) << 16) | (Number(id) & 0xffff);
}

export function bumpSpellUse(state, roleIndex, goodsId) {
  const role = state.party?.[roleIndex];
  if (!role) return 10;
  ensureRoleArrays(role);

  const tryArr = (arr, isJi) => {
    for (let i = 0; i < arr.length; i += 1) {
      if (decodeSkillId(arr[i]) !== goodsId) continue;
      let level = decodeSkillLevel(arr[i]) || 1;
      let uses = decodeSkillUses(arr[i]) + 1;
      if (uses > 60) uses = 0;

      const thresholds = isJi ? [10, 10, 10] : [15, 35, 60];
      const tier = level <= 3 ? 0 : level <= 6 ? 1 : 2;
      if (uses === thresholds[tier] && level < 10) {
        level += 1;
        uses = 0;
      }
      if (level > 10) level = 10;
      arr[i] = encodeSkillEntryFull(goodsId, level, uses);
      return level;
    }
    return null;
  };

  return tryArr(role.fa, false) ?? tryArr(role.ji, true) ?? 10;
}

/** Steal-type spell (妙手道): intel/z1 === 3 in goods data. */
export function isStealSpell(info) {
  return statNum(info, 'intel') === 3;
}

export function listCombatSpells(state, roleIndex = 0) {
  const role = state.party?.[roleIndex];
  const mp = readValues(state, roleIndex, STAT.lingli);
  const heal = [];
  const attack = [];
  const steal = [];

  const pushSpell = (entry) => {
    const info = entry.info || getGoodsById(entry.id);
    if (!info || !(Number(info.typeNum ?? info.type) & 128)) return;
    const level = entry.level || 1;
    const isAttack = !isStealSpell(info) && statNum(info, 'price') === 1;
    const mpCost = isAttack ? calcAttackSpellMpCost(info, level) : statNum(info, 'magic');
    if (mpCost > mp) return;
    const spell = {
      id: entry.id,
      name: entry.name,
      level,
      info,
      mpCost,
      singleTarget: statNum(info, 'fortune') === 1,
      isSteal: isStealSpell(info),
      isAttack: !isStealSpell(info) && statNum(info, 'price') === 1,
    };
    if (spell.isSteal) steal.push(spell);
    else if (spell.isAttack) attack.push(spell);
    else heal.push(spell);
  };

  const { fa } = listSkills(role || {});
  for (const entry of fa) pushSpell(entry);
  return { heal, attack, steal, mp };
}

export function listCombatItems(state) {
  const goods = state.player?.goods || {};
  const medicine = [];
  const enhancement = [];
  const throwable = [];

  for (const [name, count] of Object.entries(goods)) {
    if (!count) continue;
    const info = getGoodsInfo(name);
    if (!info?.name) continue;
    const entry = { name, count, info };
    const typeNum = Number(info.typeNum ?? info.type) || 0;
    if (typeNum & 2) medicine.push(entry);
    else if (typeNum & 256) enhancement.push(entry);
    else if (typeNum & 4) throwable.push(entry);
  }

  const sort = (a, b) => a.name.localeCompare(b.name, 'zh-CN');
  medicine.sort(sort);
  enhancement.sort(sort);
  throwable.sort(sort);
  return { medicine, enhancement, throwable };
}

export function calcHealAmount(state, roleIndex, info, level = 1) {
  const scale = levelScale(level);
  const maxHp = readValues(state, roleIndex, STAT.gdsmz27);
  const curHp = readValues(state, roleIndex, STAT.life);
  const maxTili = readValues(state, roleIndex, STAT.gdtl25);
  const curTili = readValues(state, roleIndex, STAT.tili);
  const maxMp = readValues(state, roleIndex, STAT.gdll26);
  const curMp = readValues(state, roleIndex, STAT.lingli);

  const hpGain = (() => {
    const v = statNum(info, 'luck');
    if (curHp <= 0 && v < HALF_QI) return 0;
    if (v === FULL || v === FULL_QI) return maxHp - curHp;
    if (v === HALF || v === HALF_QI) return Math.floor(maxHp / 2) - curHp;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  const tiliGain = (() => {
    const v = statNum(info, 'hp');
    if (v === FULL || v === FULL_QI) return maxTili - curTili;
    if (v === HALF || v === HALF_QI) return Math.floor(maxTili / 2) - curTili;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  const mpGain = (() => {
    const v = statNum(info, 'magic');
    if (v === FULL || v === FULL_QI) return maxMp - curMp;
    if (v === HALF || v === HALF_QI) return Math.floor(maxMp / 2) - curMp;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  return { hpGain, tiliGain, mpGain };
}

export function applyHealToRole(state, roleIndex, gains) {
  if (gains.hpGain) {
    const maxHp = readValues(state, roleIndex, STAT.gdsmz27);
    writeValues(state, roleIndex, STAT.life, Math.min(maxHp, readValues(state, roleIndex, STAT.life) + gains.hpGain));
  }
  if (gains.tiliGain) {
    const maxTili = readValues(state, roleIndex, STAT.gdtl25);
    writeValues(state, roleIndex, STAT.tili, Math.min(maxTili, readValues(state, roleIndex, STAT.tili) + gains.tiliGain));
  }
  if (gains.mpGain) {
    const maxMp = readValues(state, roleIndex, STAT.gdll26);
    writeValues(state, roleIndex, STAT.lingli, Math.min(maxMp, readValues(state, roleIndex, STAT.lingli) + gains.mpGain));
  }
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

/**
 * Per-spell debuff profile: base values at Lv1, scaled by spell level and power tier.
 * effectName shown in combat feedback; stat emphasis matches spell theme.
 */
const SPELL_DEBUFF_PROFILES = {
  // 单体
  '\u98de\u8757\u672f': { defense: 0, speed: 2, attack: 1, effectName: '\u866b\u8680\u7f20\u8eab' },
  '\u964d\u5996\u5492': { defense: 3, speed: 0, attack: 1, effectName: '\u7834\u90aa\u964d\u4f0f' },
  '\u8d8a\u5973\u5251': { defense: 1, speed: 2, attack: 2, effectName: '\u5251\u6c14\u8680\u9aa8' },
  '\u51cc\u6ce2\u65a9': { defense: 0, speed: 3, attack: 1, effectName: '\u51cc\u6ce2\u6c14\u6ede' },
  '\u5343\u5251\u98d8\u96e8': { defense: 2, speed: 1, attack: 3, effectName: '\u5343\u521b\u767e\u5b54' },
  '\u7389\u5973\u5251': { defense: 2, speed: 2, attack: 2, effectName: '\u7389\u5973\u8ff7\u5fc3' },
  '\u4e00\u9633\u6307': { defense: 0, speed: 1, attack: 3, effectName: '\u70b9\u7a74\u5c01\u8109' },
  '\u516d\u8109\u795e\u5251': { defense: 1, speed: 2, attack: 4, effectName: '\u516d\u8109\u65ad\u7ecf' },
  '\u718a\u5954\u864e\u5578': { defense: 1, speed: 1, attack: 4, effectName: '\u864e\u5578\u9707\u615c' },
  '\u4eba\u5251\u5408\u4e00': { defense: 3, speed: 2, attack: 3, effectName: '\u4eba\u5251\u5408\u9e23' },
  '\u5929\u5916\u98de\u4ed9': { defense: 2, speed: 4, attack: 2, effectName: '\u98de\u4ed9\u7948\u9b45' },
  '\u5343\u9b54\u722a': { defense: 3, speed: 1, attack: 5, effectName: '\u9b54\u722a\u88c2\u4f53' },
  '\u8fbe\u6469\u795e\u638c': { defense: 4, speed: 2, attack: 4, effectName: '\u8fbe\u6469\u4f0f\u9b54' },
  // 全体
  '\u72ee\u738b\u4e89\u9738': { defense: 1, speed: 1, attack: 2, effectName: '\u72ee\u5a01\u9707\u615c' },
  '\u767e\u5251\u5e7b\u5f71': { defense: 3, speed: 1, attack: 1, effectName: '\u5e7b\u5f71\u4e71\u5fc3' },
  '\u5996\u6cd5\u65e0\u8fb9': { defense: 1, speed: 2, attack: 2, effectName: '\u5996\u6cd5\u8680\u4f53' },
  '\u9ed1\u5c71\u566c\u6708': { defense: 2, speed: 1, attack: 3, effectName: '\u566c\u6708\u9ed1\u715e' },
  '\u5929\u5973\u6563\u82b1': { defense: 1, speed: 3, attack: 1, effectName: '\u6563\u82b1\u8ff7\u76ee' },
  '\u4e07\u5251\u98de\u96ea': { defense: 3, speed: 2, attack: 3, effectName: '\u98de\u96ea\u5c01\u5589' },
  '\u5578\u6d77\u795e\u529f': { defense: 2, speed: 2, attack: 3, effectName: '\u5578\u6d77\u6380\u6d6a' },
  '\u98ce\u5377\u6b8b\u4e91': { defense: 2, speed: 4, attack: 2, effectName: '\u98ce\u5377\u6b8b\u4e91' },
  '\u5929\u4e0b\u96f7\u884c': { defense: 1, speed: 4, attack: 4, effectName: '\u96f7\u884c\u9ebb\u75f9' },
  '\u5927\u60b2\u5492': { defense: 4, speed: 2, attack: 3, effectName: '\u5927\u60b2\u964d\u9b54' },
};

/** Debuff strength tuned vs typical enemy stats (fallback for unmapped spells). */
function calcAutoSpellDebuffs(power, scale) {
  let defense = Math.min(20, Math.max(1, Math.floor((power / 55) * scale)));
  let speed = Math.min(15, Math.max(0, Math.floor((power / 95) * scale)));
  let attack = Math.min(15, Math.max(0, Math.floor((power / 120) * scale)));
  if (power >= 300) defense = Math.max(defense, Math.floor(3 * scale));
  if (power >= 500) speed = Math.max(speed, Math.floor(4 * scale));
  if (power >= 700) attack = Math.max(attack, Math.floor(5 * scale));
  if (power >= 1000) {
    defense = Math.max(defense, Math.floor(8 * scale));
    speed = Math.max(speed, Math.floor(6 * scale));
  }
  return { defense, speed, attack };
}

function spellDebuffPowerTier(power) {
  return Math.max(0.8, Math.min(2.2, power / 180));
}

function scaleNamedSpellDebuffs(profile, level, power) {
  const scale = spellEffectLevelScale(level);
  const tier = spellDebuffPowerTier(power);
  return {
    defense: Math.max(0, Math.floor((profile.defense || 0) * scale * tier)),
    speed: Math.max(0, Math.floor((profile.speed || 0) * scale * tier)),
    attack: Math.max(0, Math.floor((profile.attack || 0) * scale * tier)),
    effectName: profile.effectName || '',
  };
}

export function calcSpellDebuffs(info, level) {
  if (isStealSpell(info) || statNum(info, 'price') !== 1) return null;

  const scale = spellEffectLevelScale(level);
  const power = statNum(info, 'luck');
  const name = info?.name || '';

  let defense = statNum(info, 'intel');
  if (defense === 3) defense = 0;
  let speed = statNum(info, 'speed');
  let attack = statNum(info, 'attack');

  if (defense || speed || attack) {
    const explicitScale = scale * 3;
    return {
      defense: Math.max(0, Math.floor(defense * explicitScale)),
      speed: Math.max(0, Math.floor(speed * explicitScale)),
      attack: Math.max(0, Math.floor(attack * explicitScale)),
      effectName: '\u5e7d\u51a5\u5e7b\u60d1',
    };
  }

  const profile = SPELL_DEBUFF_PROFILES[name];
  if (profile) {
    const debuffs = scaleNamedSpellDebuffs(profile, level, power);
    if (debuffs.defense || debuffs.speed || debuffs.attack) return debuffs;
  }

  if (power >= 100) {
    return { ...calcAutoSpellDebuffs(power, scale), effectName: '' };
  }

  return null;
}

export function calcSpellAttackDamage(info, level, monster) {
  const scale = levelScale(level);
  const raw = statNum(info, 'luck') * scale;
  const defense = getMonsterDefense(monster);
  return calcDamageAfterDefense(Math.max(1, raw), defense);
}

export function applySpellAttackToMonster(monster, info, level) {
  const dmg = calcSpellAttackDamage(info, level, monster);
  monster.hp = Math.max(0, monster.hp - dmg);
  const debuffs = calcSpellDebuffs(info, level);
  const debuffText = applySpellDebuffsToMonster(monster, debuffs);
  return { dmg, debuffText: formatSpellDebuffText(debuffText) };
}

export function deductSpellMp(state, roleIndex, mpCost) {
  const cur = readValues(state, roleIndex, STAT.lingli);
  writeValues(state, roleIndex, STAT.lingli, Math.max(0, cur - mpCost));
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

export function calcThrowableDamage(info, monster, playerSpeed) {
  const defense = getMonsterDefense(monster);
  const speed = Math.max(1, Number(playerSpeed) || 1);
  const w = Math.round((defense / speed + 1) * 10);
  if (Math.floor(Math.random() * Math.max(1, w)) > 10) {
    return { hit: false, dmg: 0, tiliDmg: 0, mpDmg: 0 };
  }
  return {
    hit: true,
    dmg: Math.max(1, statNum(info, 'luck')),
    tiliDmg: statNum(info, 'hp'),
    mpDmg: statNum(info, 'magic'),
  };
}

/** 妙手道：仅消耗灵力，按成功率偷取敌人金钱或掉落物（无道德值判定）。 */
export function tryStealFromMonster(state, monster, info, level) {
  const power = Math.max(1, Math.floor(statNum(info, 'luck') * levelScale(level) / 10));
  if (gameBaseRandom(23) > power) {
    return { ok: false, message: '\u5999\u624b\u9053\u5931\u8d25\u3002' };
  }

  const magic = Number(monster?.magic) || 0;
  const preferMoney = magic > 0 || gameBaseRandom(2) === 0;

  if (preferMoney) {
    const amount = Number(monster?.dropMoney ?? monster?.dropMoneyNum) || 0;
    if (amount <= 0) {
      return { ok: false, message: '\u5bf9\u65b9\u8eab\u4e0a\u6ca1\u6709\u94b1\u8d22\u3002' };
    }
    const cur = readValues(state, 0, STAT.money);
    writeValues(state, 0, STAT.money, cur + amount);
    monster.dropMoney = 0;
    syncPlayerFromRole(state, 0);
    return { ok: true, message: `\u5077\u5230\u91d1\u94b1\uff1a${amount}` };
  }

  const itemId = Number(monster?.dropItem) || 0;
  const itemInfo = itemId ? getGoodsById(itemId) : null;
  const itemName = itemInfo?.name;
  if (!itemName) {
    return { ok: false, message: '\u6ca1\u6709\u7269\u54c1\u3002' };
  }

  const applied = changeGoodsByName(state, itemName, 1);
  if (applied <= 0) {
    return { ok: false, message: `${itemName}\u5df2\u8fbe\u4e0a\u9650\uff08999\uff09\u3002` };
  }
  monster.dropItem = 0;
  monster.dropCount = 0;
  if (applied > 0) syncPlayerFromRole(state, 0);
  return { ok: true, message: `\u5077\u5230\u7269\u54c1\uff1a${itemName}` };
}

export function tryEscapeCombat(state, combat, { confirmUseItem = true } = {}) {
  if (state.cannotRunOff) {
    return { ok: false, reason: 'blocked', message: '\u51b3\u4e00\u6b7b\u6218\uff0c\u575a\u51b3\u4e0d\u9003\u3002' };
  }

  if (getGoodsCountByName(state, '\u8ff7\u8e2a\u86cf') >= 1) {
    if (!confirmUseItem) {
      return { ok: false, reason: 'need-confirm', item: '\u8ff7\u8e2a\u86cf' };
    }
    const use = typeof window !== 'undefined'
      ? window.confirm('\u662f\u5426\u4f7f\u7528\u4e00\u4e2a\u8ff7\u8e2a\u86cf\u6765\u9003\u8dd1\uff1f')
      : true;
    if (use) {
      changeGoodsByName(state, '\u8ff7\u8e2a\u86cf', -1);
      return { ok: true, usedItem: true };
    }
  }

  const roleIndex = combat.activeRoleIndex ?? 0;
  const monsterIndex = combat.activeMonsterIndex ?? 0;
  const playerSpeed = getRoleSpeed(state, roleIndex);
  const monster = combat.monsters[monsterIndex] || pickActiveMonster(combat);
  const monsterSpeed = getMonsterSpeed(monster);
  const odds = playerSpeed > monsterSpeed ? 5 : 30;
  if (gameBaseRandom(odds) === 1) {
    return { ok: true };
  }
  return { ok: false, reason: 'failed', message: '\u9003\u8dd1\u5931\u8d25\u3002' };
}
