import { buildMonsterRoster, getGoodsById } from './goods-data.js';
import { readValues, writeValues, STAT, syncPlayerFromRole, getRoleDisplayName, gameBaseRandom } from './game-runtime.js';

/** Delphi Game_migong_xishu: when factor > 0, scale HP/attack/exp by factor/10 (20=2x, 5=half, 3=third). */
export function getMazeFactorMultiplier(mazeFactor) {
  const f = Number(mazeFactor) || 0;
  if (f <= 0) return 1;
  if (f === 1) return 1; // legacy save default before fix
  return f / 10;
}

export function applyMazeFactorToMonster(monster, multiplier) {
  const mult = Number(multiplier) || 1;
  if (mult === 1) return { ...monster };
  const baseHp = Number(monster.maxHp ?? monster.hp) || 1;
  const hp = Math.max(1, Math.floor(baseHp * mult));
  return {
    ...monster,
    hp,
    maxHp: hp,
    attack: Math.max(1, Math.floor(Number(monster.attack) * mult)),
    exp: Math.max(0, Math.floor(Number(monster.exp ?? 0) * mult)),
  };
}

export class CombatState {
  constructor(monsterCount = 1, monsterType = 1, mazeFactor = 0) {
    const mult = getMazeFactorMultiplier(mazeFactor);
    this.mazeFactor = Number(mazeFactor) || 0;
    this.monsters = buildMonsterRoster(monsterType, monsterCount).map((m, i) => {
      const scaled = applyMazeFactorToMonster(m, mult);
      return {
        ...scaled,
        id: i + 1,
        maxHp: scaled.maxHp ?? scaled.hp,
      };
    });
    this.monsterType = monsterType;
    this.monsterCount = monsterCount;
    this.partySlots = [0];
    this.speedMeters = new Array(10).fill(0);
    this.speedLimit = 200;
    this.firstTurnPending = true;
    this.activeSlot = 0;
    this.activeRoleIndex = 0;
    this.activeMonsterIndex = 0;
    this.turn = 'player';
    this.defendBoostByRole = {};
    this.monsterEscaped = false;
  }
}

/** Party members allowed in battle (hide=1), up to 5 slots like???. */
export function getBattlePartySlots(save) {
  const slots = [];
  for (let i = 0; i < (save?.party?.length || 0) && slots.length < 5; i += 1) {
    if (readValues(save, i, STAT.hide) === 1) slots.push(i);
  }
  if (!slots.length) slots.push(0);
  return slots;
}

export function getRoleSpeed(save, roleIndex) {
  if (readValues(save, roleIndex, STAT.life) <= 0) return 0;
  return readValues(save, roleIndex, STAT.speed) || 10;
}

function ensureMonsterDebuffs(monster) {
  if (!monster.debuffs) {
    monster.debuffs = { defense: 0, speed: 0, attack: 0 };
  }
  return monster.debuffs;
}

export function getMonsterDefense(monster) {
  const base = Number(monster?.defense ?? monster?.defenseNum) || 0;
  const penalty = monster?.debuffs?.defense || 0;
  return Math.max(0, base - penalty);
}

export function getMonsterAttack(monster) {
  const base = Number(monster?.attack ?? monster?.attackNum) || 10;
  const penalty = monster?.debuffs?.attack || 0;
  return Math.max(1, base - penalty);
}

export function getMonsterSpeed(monster) {
  if (!monster || (monster.hp ?? 0) <= 0) return 0;
  const base = Number(monster.speed ?? monster.speedNum) || 10;
  const penalty = monster?.debuffs?.speed || 0;
  return Math.max(1, base - penalty);
}

export function applySpellDebuffsToMonster(monster, debuffs) {
  if (!monster || !debuffs) return null;
  if (!debuffs.defense && !debuffs.speed && !debuffs.attack) return null;
  const state = ensureMonsterDebuffs(monster);
  const baseDef = Number(monster.defense ?? monster.defenseNum) || 0;
  const baseSpd = Number(monster.speed ?? monster.speedNum) || 10;
  const baseAtk = Number(monster.attack ?? monster.attackNum) || 10;
  state.defense = Math.min(state.defense + (debuffs.defense || 0), baseDef);
  state.speed = Math.min(state.speed + (debuffs.speed || 0), Math.max(0, baseSpd - 1));
  state.attack = Math.min(state.attack + (debuffs.attack || 0), Math.max(0, baseAtk - 1));
  return debuffs;
}

export function formatSpellDebuffText(debuffs) {
  if (!debuffs) return '';
  const parts = [];
  if (debuffs.defense > 0) parts.push(`\u9632-${debuffs.defense}`);
  if (debuffs.speed > 0) parts.push(`\u901f-${debuffs.speed}`);
  if (debuffs.attack > 0) parts.push(`\u653b-${debuffs.attack}`);
  if (!parts.length) return '';
  const label = debuffs.effectName ? `\u3010${debuffs.effectName}\u3011` : '';
  return `\uff0c${label}${parts.join('\u3001')}`;
}

function slotToRoleIndex(combat, slot) {
  return combat.partySlots[slot] ?? combat.partySlots[0] ?? 0;
}

function isSlotAlive(combat, save, slot) {
  if (slot <= 4) {
    const roleIdx = slotToRoleIndex(combat, slot);
    return slot < combat.partySlots.length && readValues(save, roleIdx, STAT.life) > 0;
  }
  const monster = combat.monsters[slot - 5];
  return !!monster && monster.hp > 0;
}

function pickRandomAliveRoleIndex(save, partySlots) {
  const alive = partySlots.filter((ri) => readValues(save, ri, STAT.life) > 0);
  if (!alive.length) return partySlots[0] ?? 0;
  return alive[Math.floor(Math.random() * alive.length)];
}

export function initCombatFromSave(combat, save) {
  combat.partySlots = getBattlePartySlots(save);
  combat.speedMeters = new Array(10).fill(0);
  combat.defendBoostByRole = {};
  combat.firstTurnPending = true;
  combat.monsterEscaped = false;

  const leadRole = combat.partySlots[0] ?? 0;
  const leadSpeed = getRoleSpeed(save, leadRole);
  combat.speedLimit = Math.max(20, leadSpeed * 20);

  combat.speedMeters[0] -= getRoleSpeed(save, slotToRoleIndex(combat, 0));
  if (combat.monsters[0]) {
    combat.speedMeters[5] -= getMonsterSpeed(combat.monsters[0]);
  }

  combat.activeRoleIndex = pickRandomAliveRoleIndex(save, combat.partySlots);
  combat.activeMonsterIndex = 0;
  syncCombatHpCache(combat, save);
}

function syncCombatHpCache(combat, save) {
  const ri = combat.activeRoleIndex ?? 0;
  combat.playerHp = readValues(save, ri, STAT.life);
  combat.playerMaxHp = readValues(save, ri, STAT.gdsmz27) || combat.playerHp;
  combat.playerDefend = readValues(save, ri, STAT.defend);
  combat.playerSpeed = getRoleSpeed(save, ri);
}

export function syncAllRolesFromCombat(combat, save) {
  syncPlayerFromRole(save, 0);
}

function tickSpeedMeters(combat, save) {
  if (combat.speedMeters.some((v, i) => v >= combat.speedLimit && isSlotAlive(combat, save, i))) {
    return;
  }
  for (let i = 0; i < 10; i += 1) {
    if (i < 5) {
      if (i >= combat.partySlots.length) continue;
      const speed = getRoleSpeed(save, slotToRoleIndex(combat, i));
      if (speed > 0) combat.speedMeters[i] += speed;
    } else {
      const monster = combat.monsters[i - 5];
      const speed = getMonsterSpeed(monster);
      if (speed > 0) combat.speedMeters[i] += speed;
    }
  }
}

function pickSpeedSlot(combat, save) {
  let best = 0;
  for (let i = 1; i < 10; i += 1) {
    if (combat.speedMeters[i] > combat.speedMeters[best]) best = i;
  }
  if (best === 0 && combat.speedMeters[0] === 0) return -1;

  combat.speedMeters[best] = 0;

  if (!isSlotAlive(combat, save, best)) {
    return pickSpeedSlot(combat, save);
  }
  return best;
}

/** Advance to next actor: random opening like game_star_fight_message, then speed queue. */
export function advanceToNextActor(combat, save) {
  if (combat.firstTurnPending) {
    combat.firstTurnPending = false;
    const playerFirst = Math.random() < 0.5;
    if (playerFirst) {
      const slot = Math.max(0, combat.partySlots.indexOf(combat.activeRoleIndex));
      combat.activeSlot = slot >= 0 ? slot : 0;
      combat.turn = 'player';
    } else {
      const alive = combat.monsters.map((m, i) => i).filter((i) => combat.monsters[i].hp > 0);
      combat.activeMonsterIndex = alive[0] ?? 0;
      combat.activeSlot = 5 + combat.activeMonsterIndex;
      combat.turn = 'monster';
    }
  } else {
    let guard = 0;
    while (guard < 500) {
      guard += 1;
      if (combat.speedMeters.some((v, i) => v >= combat.speedLimit && isSlotAlive(combat, save, i))) break;
      tickSpeedMeters(combat, save);
    }
    let slot = pickSpeedSlot(combat, save);
    if (slot < 0) slot = combat.monsters.some((m) => m.hp > 0) ? 5 : 0;
    combat.activeSlot = slot;
    if (slot <= 4) {
      combat.activeRoleIndex = slotToRoleIndex(combat, slot);
      combat.turn = 'player';
    } else {
      combat.activeMonsterIndex = slot - 5;
      combat.turn = 'monster';
    }
  }

  if (combat.turn === 'player') {
    syncCombatHpCache(combat, save);
  }
  return combat.turn;
}

export function getSpeedOrderPreview(combat, save) {
  return combat.speedMeters.map((v, i) => {
    if (i <= 4) {
      const ri = slotToRoleIndex(combat, i);
      return {
        slot: i,
        side: 'player',
        name: getRoleDisplayName(save, ri + 1),
        meter: v,
        alive: isSlotAlive(combat, save, i),
      };
    }
    const m = combat.monsters[i - 5];
    return {
      slot: i,
      side: 'monster',
      name: m?.name || '-',
      meter: v,
      alive: isSlotAlive(combat, save, i),
    };
  });
}

export function monsterAttackMultiplier(correct) {
  return correct ? randomInt(2, 7) : randomInt(10, 15);
}

function statNum(info, key) {
  return Number(info?.[key]) || 0;
}

/** Original: Game_base_random(4) === 1 when fa_wu > 0. */
export function monsterWillUseSpell(monster) {
  const magic = Number(monster?.magic) || 0;
  return magic > 0 && gameBaseRandom(4) === 1;
}

export function getMonsterSpellInfo(monster) {
  const id = Number(monster?.magic) || 0;
  if (id <= 0) return null;
  return getGoodsById(id);
}

/** magic < 0: monster may attempt to flee (see tryMonsterFlee). */
export function monsterCanFlee(monster) {
  return Number(monster?.magic) < 0;
}

/**
 * Flee roll denominator. Success when gameBaseRandom(denom) === 1.
 * Max success rate is 1/|magic| (denom >= |magic|).
 * Speed mirrors player escape; quiz uses 10/mult on wrong answers only (correct = auto fail).
 */
export function calcMonsterFleeDenominator(combat, save, multiplier) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat);
  if (!monster || !monsterCanFlee(monster)) return null;

  const capDenom = Math.abs(Number(monster.magic));
  const roleIndex = combat.activeRoleIndex ?? 0;
  const playerSpeed = getRoleSpeed(save, roleIndex);
  const monsterSpeed = getMonsterSpeed(monster);
  const speedOdds = monsterSpeed > playerSpeed ? 5 : 30;
  let denom = Math.max(speedOdds, capDenom);
  const mult = Math.max(1, Number(multiplier) || 10);
  denom = Math.max(capDenom, Math.round(denom * 10 / mult));
  return { denom, monster, capDenom };
}

/** Attempt flee after monster-turn quiz. Returns { fled, monster? }. */
export function tryMonsterFlee(combat, save, multiplier) {
  const calc = calcMonsterFleeDenominator(combat, save, multiplier);
  if (!calc) return { fled: false };

  if (gameBaseRandom(calc.denom) !== 1) {
    return { fled: false, monster: calc.monster };
  }

  const target = calc.monster;
  target.hp = 0;
  target.escaped = true;
  target.dropMoney = 0;
  target.dropItem = 0;
  target.exp = 0;
  combat.monsterEscaped = true;
  return { fled: true, monster: target };
}

function scaleByQuizMultiplier(value, multiplier) {
  return Math.max(0, Math.floor(Number(value) * multiplier / 10));
}

function calcMonsterSpellDamageOnRole(save, roleIndex, spellInfo, multiplier, combat) {
  const defendBoost = combat.defendBoostByRole[roleIndex] || 1;
  const defend = (readValues(save, roleIndex, STAT.defend) || 0) * defendBoost;
  const typeNum = Number(spellInfo.typeNum ?? spellInfo.type) || 0;

  let hpDmg = 0;
  let tiliDmg = 0;
  let mpDmg = 0;

  const rawHp = scaleByQuizMultiplier(statNum(spellInfo, 'luck'), multiplier);
  if (rawHp > 0) {
    hpDmg = Math.max(1, rawHp - Math.floor(defend / 4));
  }

  if (typeNum & 128) {
    tiliDmg = scaleByQuizMultiplier(statNum(spellInfo, 'hp'), multiplier);
  } else if (typeNum & 4) {
    tiliDmg = scaleByQuizMultiplier(statNum(spellInfo, 'hp'), multiplier);
    mpDmg = scaleByQuizMultiplier(statNum(spellInfo, 'magic'), multiplier);
  }

  return { hpDmg, tiliDmg, mpDmg };
}

function applyMonsterSpellDamageToRole(save, roleIndex, damage, combat) {
  const { hpDmg, tiliDmg, mpDmg } = damage;
  if (hpDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.life);
    writeValues(save, roleIndex, STAT.life, Math.max(0, cur - hpDmg));
  }
  if (tiliDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.tili);
    writeValues(save, roleIndex, STAT.tili, Math.max(0, cur - tiliDmg));
  }
  if (mpDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.lingli);
    writeValues(save, roleIndex, STAT.lingli, Math.max(0, cur - mpDmg));
  }
  combat.defendBoostByRole[roleIndex] = 1;
  if (roleIndex === 0) syncPlayerFromRole(save, 0);
}

/**
 * Monster spell/item attack on player party. Quiz multiplier affects all components.
 */
export function applyMonsterSpellAttack(combat, save, multiplier, spellInfo) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat) || combat.monsters[0];
  const typeNum = Number(spellInfo.typeNum ?? spellInfo.type) || 0;
  const isAttackSpell = !(typeNum & 128) || statNum(spellInfo, 'price') === 1 || (typeNum & 4);

  if (!isAttackSpell) {
    return applyMonsterAttack(combat, save, multiplier);
  }

  const singleTarget = statNum(spellInfo, 'fortune') === 1;
  const aliveTargets = combat.partySlots.filter((ri) => readValues(save, ri, STAT.life) > 0);
  const targets = singleTarget
    ? [pickRandomAliveRoleIndex(save, combat.partySlots)]
    : (aliveTargets.length ? aliveTargets : [combat.partySlots[0] ?? 0]);

  let totalHp = 0;
  let totalTili = 0;
  let totalMp = 0;
  for (const target of targets) {
    const damage = calcMonsterSpellDamageOnRole(save, target, spellInfo, multiplier, combat);
    applyMonsterSpellDamageToRole(save, target, damage, combat);
    totalHp += damage.hpDmg;
    totalTili += damage.tiliDmg;
    totalMp += damage.mpDmg;
  }

  syncCombatHpCache(combat, save);
  return {
    monster,
    spellName: spellInfo.name || '\u6cd5\u672f',
    singleTarget,
    aoe: !singleTarget && targets.length > 1,
    totalHp,
    totalTili,
    totalMp,
    targetRoleIndex: targets[0],
  };
}

export function formatMonsterSpellFeedback(save, correct, result) {
  const { monster, spellName, aoe, totalHp, totalTili, totalMp, targetRoleIndex } = result;
  const extras = [];
  if (totalTili > 0) extras.push(`\u4f53\u529b${totalTili}`);
  if (totalMp > 0) extras.push(`\u7075\u529b${totalMp}`);
  const extraText = extras.length ? `\uff0c\u9644\u52a0\u51cf${extras.join('\u3001')}` : '';

  if (aoe) {
    return correct
      ? `\u7b54\u5bf9\u4e86\uff01${monster.name} \u7684${spellName}\u88ab\u524a\u5f31\uff0c\u6211\u65b9\u5171\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`
      : `\u7b54\u9519\u4e86\uff01${monster.name} \u65bd\u5c55${spellName}\uff0c\u6211\u65b9\u5171\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`;
  }

  const targetName = getRoleDisplayName(save, targetRoleIndex + 1);
  return correct
    ? `\u7b54\u5bf9\u4e86\uff01${monster.name} \u7684${spellName}\u88ab\u524a\u5f31\uff0c${targetName}\u4ec5\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`
    : `\u7b54\u9519\u4e86\uff01${targetName}\u88ab${monster.name} \u7684${spellName}\u547d\u4e2d\uff0c\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`;
}

export function playerDamage(base = 12) {
  return base + randomInt(0, 8);
}

export function applyMonsterAttack(combat, save, multiplier, targetRoleIndex = null) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat) || combat.monsters[0];
  const target = targetRoleIndex ?? pickRandomAliveRoleIndex(save, combat.partySlots);
  const defendBoost = combat.defendBoostByRole[target] || 1;
  const defend = (readValues(save, target, STAT.defend) || 0) * defendBoost;
  const raw = Math.max(1, Math.round(getMonsterAttack(monster) * multiplier / 10));
  const dmg = Math.max(1, raw - Math.floor(defend / 4));
  const cur = readValues(save, target, STAT.life);
  writeValues(save, target, STAT.life, Math.max(0, cur - dmg));
  combat.defendBoostByRole[target] = 1;
  if (target === 0) syncPlayerFromRole(save, 0);
  syncCombatHpCache(combat, save);
  return { dmg, monster, targetRoleIndex: target };
}

export function calcDamageAfterDefense(rawDmg, defense) {
  let dmg = -Math.max(1, rawDmg);
  const q = Math.round((defense / Math.max(1, rawDmg) + 1) * 10);
  if (gameBaseRandom(Math.max(1, q)) > 10) {
    dmg += defense;
  } else {
    dmg += Math.floor(defense / (5 + gameBaseRandom(6)));
  }
  if (dmg > 0) dmg = 0;
  return Math.abs(dmg);
}

export function applyPlayerAttack(combat, mode = 'attack', targetIndex = 0) {
  const alive = combat.monsters.filter((m) => m.hp > 0);
  const target = alive[targetIndex] || alive[0];
  if (!target) return { dmg: 0, target: null };
  let base = 14;
  if (mode === 'magic') base = 18;
  if (mode === 'item') base = 10;
  const raw = playerDamage(base);
  const dmg = calcDamageAfterDefense(raw, getMonsterDefense(target));
  target.hp = Math.max(0, target.hp - dmg);
  return { dmg, target };
}

export function pickActiveMonster(combat) {
  if (combat.activeMonsterIndex != null && combat.monsters[combat.activeMonsterIndex]?.hp > 0) {
    return combat.monsters[combat.activeMonsterIndex];
  }
  return combat.monsters.find((m) => m.hp > 0) || null;
}

export function aliveMonsterCount(combat) {
  return combat.monsters.filter((m) => m.hp > 0).length;
}

export function anyPlayerAlive(combat, save) {
  return combat.partySlots.some((ri) => readValues(save, ri, STAT.life) > 0);
}

export function combatFinished(combat, save) {
  const monstersAlive = combat.monsters.some((m) => m.hp > 0);
  const playersAlive = anyPlayerAlive(combat, save);
  if (monstersAlive && playersAlive) return null;
  if (monstersAlive && !playersAlive) return 'lose';
  return 'win';
}

/** Roll one monster's item drop (Delphi: drop when dropChance<=1 or random(chance)===1). */
export function rollMonsterItemDrop(monster) {
  if (monster?.escaped) return null;
  const itemId = Number(monster?.dropItem) || 0;
  let count = Number(monster?.dropCount) || 0;
  const chance = Number(monster?.dropChance) || 0;
  if (itemId <= 0 || count <= 0) return null;
  if (chance > 1 && gameBaseRandom(chance) !== 1) return null;
  const info = getGoodsById(itemId);
  if (!info?.name) return null;
  return { id: itemId, name: info.name, count };
}

export function calcVictoryRewards(combat) {
  let exp = 0;
  let money = 0;
  const itemTotals = new Map();
  for (const m of combat.monsters) {
    if (m.escaped) continue;
    exp += Number(m.exp ?? m.expNum) || 0;
    money += Number(m.dropMoney ?? m.dropMoneyNum) || 0;
    const drop = rollMonsterItemDrop(m);
    if (!drop) continue;
    itemTotals.set(drop.name, (itemTotals.get(drop.name) || 0) + drop.count);
  }
  const items = [...itemTotals.entries()].map(([name, count]) => ({ name, count }));
  return { exp, money, items };
}

export function attackStaminaCost(maxTili) {
  return Math.max(1, Math.floor(Number(maxTili || 50) / 50) + 1);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
