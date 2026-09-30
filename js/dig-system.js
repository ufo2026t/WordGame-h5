import { gameBaseRandom } from './game-runtime.js';
import { getGameConfig } from './game-config.js';

/** Roll one drop from const.upp / const_cy.upp tables (first weight match wins). */
export function rollDigDrop(table) {
  for (const entry of table || []) {
    const weight = Number(entry.weight) || 1;
    if (gameBaseRandom(weight) === 1) return entry.name;
  }
  return null;
}

export function getMineTable() {
  return getGameConfig()?.mineOres || [];
}

export function getHerbTable() {
  return getGameConfig()?.herbOres || [];
}

export function calcDigCloseBonusExp(correctCount) {
  let n = Math.max(0, Number(correctCount) || 0);
  if (n > 100) n = 100;
  return Math.floor((n * n) / 10);
}
