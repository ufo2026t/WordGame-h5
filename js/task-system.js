import { getTaskInfo } from './game-config.js';
import { readValues, writeValues, syncPlayerFromRole, STAT } from './game-runtime.js';

/** Parse reward numbers from task description (same order as Delphi game_comp_task). */
export function parseTaskRewards(text) {
  const rewards = { money: 0, exp: 0, itemName: '', itemCount: 0 };
  if (!text) return rewards;

  let field = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      if (start < 0) start = i;
    } else if (start >= 0 && i > start) {
      const n = parseInt(text.slice(start, i), 10);
      field += 1;
      if (field === 1) rewards.money = n;
      else if (field === 2) rewards.exp = n;
      else if (field === 3) rewards.itemCount = n;
      start = -1;
    }
  }

  const quotePairs = [
    ['\u201c', '\u201d'],
    ['\u2018', '\u2019'],
    ['"', '"'],
    ['\u300c', '\u300d'],
  ];
  for (const [open, close] of quotePairs) {
    const j = text.indexOf(open);
    const k = text.indexOf(close, j + 1);
    if (j >= 0 && k > j) {
      rewards.itemName = text.slice(j + open.length, k).trim();
      break;
    }
  }

  return rewards;
}

function gameBaseRandom(mod) {
  const m = mod > 0 ? mod : 1;
  return Math.floor(Math.random() * m);
}

/** Simplified port of Unit_pop.game_upgrade for role index 0-based. */
export function tryRoleUpgrade(state, roleIndex = 0) {
  let upgraded = 0;
  const loop = () => {
    const exp = readValues(state, roleIndex, STAT.experience);
    let need = readValues(state, roleIndex, STAT.upgrade);
    if (need <= 0) {
      need = 500;
      writeValues(state, roleIndex, STAT.upgrade, need);
    }
    if (exp < need) return;

    writeValues(state, roleIndex, STAT.experience, exp - need);
    const grade = readValues(state, roleIndex, STAT.grade) + 1;
    writeValues(state, roleIndex, STAT.grade, grade);
    upgraded = grade;

    const r = gameBaseRandom(5) + 8;
    writeValues(state, roleIndex, STAT.gdtl25, readValues(state, roleIndex, STAT.gdtl25) + 9 + gameBaseRandom(5));
    writeValues(state, roleIndex, STAT.tili, readValues(state, roleIndex, STAT.gdtl25));
    if (grade * 12 > readValues(state, roleIndex, STAT.gdtl25)) {
      writeValues(state, roleIndex, STAT.gdtl25, grade * 14 + 60);
      writeValues(state, roleIndex, STAT.tili, readValues(state, roleIndex, STAT.gdtl25));
    }

    writeValues(state, roleIndex, STAT.gdll26, readValues(state, roleIndex, STAT.gdll26) + 40 + gameBaseRandom(15));
    writeValues(state, roleIndex, STAT.lingli, readValues(state, roleIndex, STAT.gdll26));
    if (grade * 44 > readValues(state, roleIndex, STAT.gdll26)) {
      writeValues(state, roleIndex, STAT.gdll26, grade * 45 + 100);
      writeValues(state, roleIndex, STAT.lingli, readValues(state, roleIndex, STAT.gdll26));
    }

    writeValues(state, roleIndex, STAT.gdsmz27, readValues(state, roleIndex, STAT.gdsmz27) + 20 + gameBaseRandom(8));
    writeValues(state, roleIndex, STAT.life, readValues(state, roleIndex, STAT.gdsmz27));
    if (grade * 23 > readValues(state, roleIndex, STAT.gdsmz27)) {
      writeValues(state, roleIndex, STAT.gdsmz27, grade * 25 + 130);
      writeValues(state, roleIndex, STAT.life, readValues(state, roleIndex, STAT.gdsmz27));
    }

    writeValues(state, roleIndex, STAT.upgrade, Math.floor((grade * 500 * r) / 10));
    writeValues(state, roleIndex, STAT.speed, readValues(state, roleIndex, STAT.speed) + 1);
    writeValues(state, roleIndex, STAT.attack, readValues(state, roleIndex, STAT.attack) + 5);
    writeValues(state, roleIndex, STAT.intellect, readValues(state, roleIndex, STAT.intellect) + 1);
    writeValues(state, roleIndex, STAT.defend, readValues(state, roleIndex, STAT.defend) + 2);

    if (readValues(state, roleIndex, STAT.experience) >= readValues(state, roleIndex, STAT.upgrade)) {
      loop();
    }
  };
  loop();
  return upgraded;
}

/** Grant task completion rewards and chat feedback (Delphi game_comp_task). */
export function applyTaskRewards(api, taskText) {
  const rewards = parseTaskRewards(taskText);

  if (rewards.money > 0) {
    api.game_change_money(rewards.money);
    api.game_chat(`\u91d1\u94b1\u589e\u52a0\uff1a${rewards.money}`);
  }
  if (rewards.exp > 0) {
    api.game_attribute_change(1, STAT.experience, rewards.exp);
    api.game_chat(`\u7ecf\u9a8c\u503c\u589e\u52a0\uff1a${rewards.exp}`);
    const newLevel = tryRoleUpgrade(api.state, 0);
    if (newLevel > 0) {
      api.game_chat(`\u7b49\u7ea7\u63d0\u5347\u5230\uff1a${newLevel}`);
      syncPlayerFromRole(api.state, 0);
      api.ui.refreshStatus();
    }
  }
  if (rewards.itemCount > 0 && rewards.itemName) {
    api.game_goods_change_n(rewards.itemName, rewards.itemCount);
  }
}

export function getTaskDescription(id) {
  return getTaskInfo(id)?.text || '';
}
