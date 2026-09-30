import {
  CombatState,
  applyMonsterAttack,
  applyMonsterSpellAttack,
  applyPlayerAttack,
  combatFinished,
  monsterAttackMultiplier,
  monsterWillUseSpell,
  getMonsterSpellInfo,
  monsterCanFlee,
  tryMonsterFlee,
  formatMonsterSpellFeedback,
  initCombatFromSave,
  calcVictoryRewards,
  attackStaminaCost,
  aliveMonsterCount,
  pickActiveMonster,
  advanceToNextActor,
  getSpeedOrderPreview,
} from './combat.js';
import { saveSettings } from './settings.js';
import { getMonsterIconUrl } from './goods-data.js';
import { readValues, writeValues, STAT, syncPlayerFromRole, getRoleDisplayName, getRoleCount } from './game-runtime.js';
import { changeGoodsByName } from './inventory-system.js';
import { rollDigDrop, getMineTable, getHerbTable, calcDigCloseBonusExp } from './dig-system.js';
import {
  listCombatSpells,
  listCombatItems,
  bumpSpellUse,
  calcHealAmount,
  applyHealToRole,
  calcAttackSpellMpCost,
  applySpellAttackToMonster,
  calcThrowableDamage,
  deductSpellMp,
  tryStealFromMonster,
  tryEscapeCombat,
} from './combat-actions.js';

/** Study-mode reward: each correct answer restores 1% max lingli (min 1) for every party member. */
function addPartyLingliByPercent(save, percent = 1) {
  for (let i = 0; i < getRoleCount(save); i += 1) {
    const max = readValues(save, i, STAT.gdll26);
    const cur = readValues(save, i, STAT.lingli);
    if (cur >= max || max <= 0) continue;
    const gain = Math.max(1, Math.floor((max * percent) / 100));
    writeValues(save, i, STAT.lingli, Math.min(max, cur + gain));
  }
  syncPlayerFromRole(save, 0);
}

export class WordPopup {
  constructor(root, { wordEngine, settings, api = null }) {
    this.root = root;
    this.wordEngine = wordEngine;
    this.settings = settings;
    this.api = api;
    this.onComplete = null;
    this.onFail = null;

    this.modal = document.getElementById('word-modal');
    this.titleEl = document.getElementById('word-modal-title');
    this.promptEl = document.getElementById('word-prompt');
    this.choicesEl = document.getElementById('word-choices');
    this.feedbackEl = document.getElementById('word-feedback');
    this.progressEl = document.getElementById('word-progress');
    this.fightBar = document.getElementById('fight-bar');
    this.fightActions = document.getElementById('fight-actions');
    this.fightPicker = document.getElementById('fight-picker');
    this.closeBtn = document.getElementById('word-modal-close');
    this.reverseCheckbox = document.getElementById('reverse-learn');

    this.mode = 'study';
    this.remaining = 0;
    this.combat = null;
    this.saveRef = null;
    this.canClose = true;
    this.currentQuestion = null;
    this.turnTimer = null;
    this.pendingTimer = null;
    this.digCount = 100;
    this.gameKaoshi = 0;
    this.digCorrect = 0;
    this.jitNum = 1;
    this.hintTimer = null;
    this.hintChoice = null;

    this.closeBtn.addEventListener('click', () => this.tryClose());
    this.reverseCheckbox.addEventListener('change', () => {
      this.settings.reverseLearn = this.reverseCheckbox.checked;
      saveSettings(this.settings);
    });
    this._onKeyDown = (ev) => this.handleKeyDown(ev);
    document.addEventListener('keydown', this._onKeyDown);

    this.fightActions?.querySelectorAll('[data-fight]').forEach((btn) => {
      btn.addEventListener('click', () => this.handlePlayerFight(btn.dataset.fight));
    });
    this.updateFightHotkeyLabels();
  }

  normalizeHotkey(value, fallback = '') {
    const key = String(value || fallback).trim();
    if (!key) return fallback.toUpperCase();
    if (key.toLowerCase() === 'del') return 'Del';
    return key.length === 1 ? key.toUpperCase() : key;
  }

  getFightKeyMap() {
    const s = this.settings || {};
    return {
      [this.normalizeHotkey(s.fightAttack, 'G')]: 'attack',
      [this.normalizeHotkey(s.fightDefend, 'F')]: 'defend',
      [this.normalizeHotkey(s.fightMagic, 'S')]: 'magic',
      [this.normalizeHotkey(s.fightItem, 'W')]: 'item',
      [this.normalizeHotkey(s.fightEscape, 'T')]: 'escape',
    };
  }

  getWordChoiceKeyMap() {
    const s = this.settings || {};
    return {
      [this.normalizeHotkey(s.wordChoice1, 'Y')]: 0,
      [this.normalizeHotkey(s.wordChoice2, 'H')]: 1,
      [this.normalizeHotkey(s.wordChoice3, 'N')]: 2,
      '1': 0,
      '2': 1,
      '3': 2,
    };
  }

  updateFightHotkeyLabels() {
    if (!this.fightActions) return;
    const labels = {
      attack: this.normalizeHotkey(this.settings?.fightAttack, 'G'),
      defend: this.normalizeHotkey(this.settings?.fightDefend, 'F'),
      magic: this.normalizeHotkey(this.settings?.fightMagic, 'S'),
      item: this.normalizeHotkey(this.settings?.fightItem, 'W'),
      escape: this.normalizeHotkey(this.settings?.fightEscape, 'T'),
    };
    this.fightActions.querySelectorAll('[data-fight]').forEach((btn) => {
      const mode = btn.dataset.fight;
      const key = labels[mode] || '';
      const text = btn.dataset.label || btn.textContent.trim().replace(/\s*\(.+\)$/, '');
      btn.dataset.label = text;
      btn.innerHTML = `${text}<span class="fight-key">${key}</span>`;
    });
  }

  isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  isPickerOpen() {
    return !!this.fightPicker && !this.fightPicker.classList.contains('hidden');
  }

  isFightPlayerTurn() {
    return this.mode === 'fight'
      && this.combat?.turn === 'player'
      && !this.fightActions?.classList.contains('hidden');
  }

  hasActiveChoices() {
    return !!this.choicesEl?.querySelector('button:not([disabled])');
  }

  eventHotkey(ev) {
    if (ev.key === 'Delete') return 'Del';
    if (/^Digit[1-9]$/.test(ev.code)) return ev.code.replace('Digit', '');
    if (/^Numpad[1-9]$/.test(ev.code)) return ev.code.replace('Numpad', '');
    return ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  }

  handlePickerHotkey(ev) {
    if (!this.isPickerOpen()) return false;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.hidePicker();
      if (this.isFightPlayerTurn()) this.schedulePlayerTurnResume();
      return true;
    }
    const num = Number(this.eventHotkey(ev));
    if (num >= 1 && num <= 9) {
      const btn = this.fightPicker.querySelector(`[data-pick="${num - 1}"]`);
      if (btn) {
        ev.preventDefault();
        btn.click();
        return true;
      }
    }
    return false;
  }

  handleFightActionHotkey(ev) {
    if (!this.isFightPlayerTurn() || this.isPickerOpen()) return false;
    const mode = this.getFightKeyMap()[this.eventHotkey(ev)];
    if (!mode) return false;
    ev.preventDefault();
    this.handlePlayerFight(mode);
    return true;
  }

  handleWordChoiceHotkey(ev) {
    if (!this.hasActiveChoices() || !this.currentQuestion) return false;
    const idx = this.getWordChoiceKeyMap()[this.eventHotkey(ev)];
    if (idx == null || idx >= this.currentQuestion.choices.length) return false;
    ev.preventDefault();
    const isMonsterTurn = this.mode === 'fight' && this.combat?.turn !== 'player';
    this.submitAnswer(this.currentQuestion.choices[idx], isMonsterTurn);
    return true;
  }

  handleKeyDown(ev) {
    if (this.modal.classList.contains('hidden')) return;
    if (this.isTypingTarget(ev.target) && !this.modal.contains(ev.target)) return;

    if (this.handlePickerHotkey(ev)) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.tryClose();
      return;
    }

    if (this.handleFightActionHotkey(ev)) return;
    this.handleWordChoiceHotkey(ev);
  }

  setApi(api) {
    this.api = api;
  }

  updateSettings(settings) {
    this.settings = settings;
    this.reverseCheckbox.checked = !!settings.reverseLearn;
    this.updateFightHotkeyLabels();
  }

  clearTimers() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.hintChoice = null;
  }

  openStudy(count, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'study';
    this.remaining = count;
    this.saveRef = save;
    this.combat = null;
    this.canClose = true;
    this.titleEl.textContent = '\u80cc\u5355\u8bcd ' + count + ' \u4e2a';
    this.fightBar?.classList.add('hidden');
    this.fightActions?.classList.add('hidden');
    this.hidePicker();
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.clearWeather();
    this.show();
    this.nextQuestion();
  }

  openFight(monsterCount, monsterType, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'fight';
    this.remaining = monsterCount;
    this.saveRef = save;
    this.combat = new CombatState(monsterCount, monsterType, save?.mazeFactor ?? 0);
    initCombatFromSave(this.combat, save);
    this.canClose = false;
    this.modal.querySelector('.modal-card')?.classList.add('fight-mode');
    this.applyWeather(save);
    this.updateFightTitle();
    this.fightBar?.classList.remove('hidden');
    this.fightActions?.classList.add('hidden');
    this.updateFightHotkeyLabels();
    this.renderFightBar();
    this.show();
    this.startFightRound();
  }

  openDig(count, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'dig';
    this.digCount = Number(count) || 100;
    this.saveRef = save;
    this.combat = null;
    this.canClose = true;
    this.digCorrect = 0;
    this.jitNum = 1;
    this.gameKaoshi = this.digCount >= 1000 ? (this.digCount - 1000) * 3 + 5 : 0;

    if (this.digCount === 200) {
      this.titleEl.textContent = '\u91c7\u836f\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    } else if (this.digCount === 300) {
      this.titleEl.textContent = '\u6253\u5750\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    } else if (this.digCount >= 1000) {
      this.titleEl.textContent = '\u8003\u8bd5 ' + (this.digCount - 1000) + ' \u4e2a';
    } else {
      this.titleEl.textContent = '\u6316\u77ff\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    }

    this.fightBar?.classList.add('hidden');
    this.fightActions?.classList.add('hidden');
    this.hidePicker();
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.applyWeather(save);
    this.show();
    this.nextQuestion();
  }

  applyWeather(save) {
    const card = this.modal?.querySelector('.modal-card');
    if (!card) return;
    this.clearWeather();
    const weather = Number(save?.weather ?? 0);
    if (weather < 0) return;

    let effect = weather;
    if (weather === 0) {
      if (Math.floor(Math.random() * 9) !== 0) return;
      effect = 1 + Math.floor(Math.random() * 4);
    }

    const map = {
      1: 'weather-snow',
      2: 'weather-rain',
      3: 'weather-leaves',
      4: 'weather-snow-light',
    };
    const cls = map[effect];
    if (cls) card.classList.add('weather-active', cls);
  }

  clearWeather() {
    const card = this.modal?.querySelector('.modal-card');
    if (!card) return;
    card.classList.remove(
      'weather-active',
      'weather-snow',
      'weather-rain',
      'weather-leaves',
      'weather-snow-light',
    );
  }

  digPayload(extra = {}) {
    return {
      correctCount: this.digCorrect,
      gameKaoshi: this.gameKaoshi,
      ...extra,
    };
  }

  finishDigExam() {
    this.feedbackEl.textContent = '\u8003\u8bd5\u7ed3\u675f\uff0c\u6b63\u786e' + this.digCorrect;
    setTimeout(() => {
      this.hide();
      this.onFail?.(this.digPayload({ examDone: true }));
    }, 900);
  }

  applyDigCloseBonus() {
    if (this.digCount >= 1000 || this.digCorrect <= 0) return;
    const exp = calcDigCloseBonusExp(this.digCorrect);
    if (exp > 0) {
      this.api?.game_attribute_change?.(0, STAT.experience, exp);
      this.api?.ui?.toast?.('\u989d\u5916\u5956\u52b1\u7ecf\u9a8c\u503c\uff1a' + exp);
    }
  }

  updateFightTitle() {
    const alive = this.combat ? aliveMonsterCount(this.combat) : 0;
    const actor = this.combat?.turn === 'player'
      ? getRoleDisplayName(this.saveRef, this.activeRoleIndex() + 1)
      : (pickActiveMonster(this.combat)?.name || '\u602a\u7269');
    this.titleEl.textContent = '\u6218\u6597 \u00b7 \u5269\u4f59\u602a\u7269 ' + alive + ' \u00b7 ' + actor + '\u7684\u56de\u5408';
  }

  startFightRound() {
    this.clearTimers();
    const result = combatFinished(this.combat, this.saveRef);
    if (result === 'win') {
      if (this.combat.monsterEscaped) {
        this.finishFightEscaped();
      } else {
        this.finishFightWin();
      }
      return;
    }
    if (result === 'lose') {
      this.finishFightLose();
      return;
    }

    advanceToNextActor(this.combat, this.saveRef);
    this.renderFightBar();
    this.updateFightTitle();

    if (this.combat.turn === 'player') {
      const ri = this.activeRoleIndex();
      const name = getRoleDisplayName(this.saveRef, ri + 1);
      this.feedbackEl.textContent = name + ' \u7684\u56de\u5408\uff1a\u653b / \u9632 / \u6cd5 / \u7269 / \u9003\uff08\u70ed\u952e\u53ef\u7528\uff09';
      this.fightActions?.classList.remove('hidden');
      this.promptEl.textContent = name + ' \u51fa\u624b';
      this.choicesEl.innerHTML = '';
      this.turnTimer = setTimeout(() => {
        this.feedbackEl.textContent = '\u672a\u64cd\u4f5c\uff0c\u81ea\u52a8\u9632\u5fa1';
        this.doDefend();
      }, 12000);
      return;
    }

    this.fightActions?.classList.add('hidden');
    const monster = pickActiveMonster(this.combat);
    this.feedbackEl.textContent = (monster?.name || '\u602a\u7269') + ' \u7684\u56de\u5408\uff1a\u7b54\u5bf9\u5355\u8bcd\u53ef\u51cf\u8f7b\u4f24\u5bb3\u4e0e\u9003\u8dd1\u6982\u7387\uff01';
    this.nextQuestion(true);
  }

  show() {
    this.modal.classList.remove('hidden');
    this.modal.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.clearTimers();
    this.modal.classList.add('hidden');
    this.modal.setAttribute('aria-hidden', 'true');
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.clearWeather();
    this.hidePicker();
  }

  tryClose() {
    if (this.mode === 'fight' && !this.canClose) {
      this.doEscape(true);
      return;
    }
    if (!this.canClose) return;
    if (this.mode === 'dig') {
      this.applyDigCloseBonus();
      this.hide();
      this.onFail?.(this.digPayload({ cancelled: true }));
      return;
    }
    this.hide();
    this.onFail?.('cancelled');
  }

  renderPrompt(q) {
    const promptIsEn = !q.reverse;
    this.promptEl.style.color = promptIsEn ? this.settings.enColor : this.settings.cnColor;
    this.promptEl.style.fontSize = (promptIsEn ? this.settings.enSize : this.settings.cnSize) + 'px';
    if (q.promptHtml) {
      this.promptEl.innerHTML = q.promptHtml;
    } else {
      this.promptEl.textContent = q.prompt;
    }
  }

  bindChoiceHint(btn, choice, q) {
    btn.addEventListener('mouseenter', () => {
      if (this.hintTimer) clearTimeout(this.hintTimer);
      this.hintChoice = choice;
      this.hintTimer = setTimeout(() => {
        if (this.hintChoice !== choice || btn.disabled) return;
        const money = this.saveRef?.player?.money ?? 0;
        if (money < 60) {
          this.feedbackEl.textContent = '金钱不足，不能显示提示（需60金币）';
          return;
        }
        if (choice === q.answer) {
          this.feedbackEl.textContent = '鼠标下答案正确。';
        } else {
          this.saveRef.player.money = money - 60;
          this.api?.ui?.refreshStatus?.();
          this.feedbackEl.textContent = `提示：正确答案是「${q.answer}」（已扣60金币）`;
        }
      }, 5000);
    });
    btn.addEventListener('mouseleave', () => {
      if (this.hintChoice === choice) {
        clearTimeout(this.hintTimer);
        this.hintTimer = null;
        this.hintChoice = null;
      }
    });
  }

  syncPlayerHpToRole() {
    if (!this.saveRef || !this.combat) return;
    const ri = this.combat.activeRoleIndex ?? 0;
    this.combat.playerHp = readValues(this.saveRef, ri, STAT.life);
    this.combat.playerMaxHp = readValues(this.saveRef, ri, STAT.gdsmz27);
    if (ri === 0) syncPlayerFromRole(this.saveRef, 0);
    this.api?.ui?.refreshStatus?.();
  }

  syncAllPartyHp() {
    if (!this.saveRef) return;
    syncPlayerFromRole(this.saveRef, 0);
    this.api?.ui?.refreshStatus?.();
  }

  activeRoleIndex() {
    return this.combat?.activeRoleIndex ?? 0;
  }

  renderFightBar() {
    if (!this.fightBar || !this.combat) return;

    const partyCards = this.combat.partySlots.map((roleIdx, slot) => {
      const name = getRoleDisplayName(this.saveRef, roleIdx + 1);
      const hp = readValues(this.saveRef, roleIdx, STAT.life);
      const maxHp = readValues(this.saveRef, roleIdx, STAT.gdsmz27) || 1;
      const active = this.combat.turn === 'player' && slot === this.combat.activeSlot;
      return (
        '<div class="fight-unit-card' + (active ? ' fight-unit-active' : '') + (hp <= 0 ? ' fight-unit-dead' : '') + '">' +
        '<strong>' + name + '</strong>' +
        '<div class="hp-bar"><span style="width:' + Math.max(0, (hp / maxHp) * 100) + '%"></span></div>' +
        '<div>' + hp + '/' + maxHp + '</div></div>'
      );
    }).join('');

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const monsterCards = this.combat.monsters.map((m, idx) => {
      if (m.hp <= 0) return '';
      const icon = getMonsterIconUrl(m.icon);
      const img = icon
        ? `<img class="fight-portrait" src="${icon}" alt="${m.name}" onerror="this.classList.add('missing')">`
        : '<div class="fight-portrait missing"></div>';
      const active = this.combat.turn === 'monster' && (5 + idx) === this.combat.activeSlot;
      return (
        '<div class="fight-monster-card' + (active ? ' fight-unit-active' : '') + '">' +
        img +
        '<div class="fight-monster-meta">' +
        '<strong>' + m.name + '</strong>' +
        '<div class="hp-bar"><span style="width:' + (m.hp / m.maxHp) * 100 + '%"></span></div>' +
        '<div>' + m.hp + '/' + m.maxHp + '</div>' +
        '</div></div>'
      );
    }).join('');

    const order = getSpeedOrderPreview(this.combat, this.saveRef)
      .filter((x) => x.alive)
      .sort((a, b) => b.meter - a.meter)
      .slice(0, 4)
      .map((x) => x.name + '(' + x.meter + ')')
      .join(' \u00b7 ');

    const playerSide =
      '<div class="fight-side fight-side-player">' +
      '<h3>\u6211\u65b9</h3>' +
      (partyCards || '<div class="panel-empty">\u5168\u706d</div>') +
      '</div>';

    const enemySide =
      '<div class="fight-side fight-side-enemy">' +
      '<h3>\u654c\u65b9</h3>' +
      (monsterCards || '<div class="panel-empty">\u5168\u706d</div>') +
      '</div>';

    this.fightBar.innerHTML = playerSide + enemySide +
      (order ? '<div class="fight-speed-order">\u901f\u5ea6\u6392\u5e8f\uff1a' + order + '</div>' : '');
  }

  hidePicker() {
    if (!this.fightPicker) return;
    this.fightPicker.classList.add('hidden');
    this.fightPicker.innerHTML = '';
  }

  showPicker(title, items, onPick) {
    if (!this.fightPicker) return;
    this.fightPicker.classList.remove('hidden');
    this.fightPicker.innerHTML = `
      <div class="fight-picker-head">
        <strong>${title}</strong>
        <button type="button" class="mini-btn" data-picker-cancel>\u53d6\u6d88</button>
      </div>
      <div class="fight-picker-list">${items.map((item, idx) => `
        <button type="button" class="fight-picker-btn" data-pick="${idx}">${item.label}</button>`).join('')}
      </div>`;
    this.fightPicker.querySelector('[data-picker-cancel]')?.addEventListener('click', () => this.hidePicker());
    this.fightPicker.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pick = items[Number(btn.dataset.pick)];
        this.hidePicker();
        onPick(pick);
      });
    });
  }

  handlePlayerFight(mode) {
    this.clearTimers();
    if (mode === 'defend') {
      this.doDefend();
      return;
    }
    if (mode === 'escape') {
      this.doEscape();
      return;
    }
    if (mode === 'magic') {
      this.openMagicPicker();
      return;
    }
    if (mode === 'item') {
      this.openItemPicker();
      return;
    }
    this.doAttack('attack');
  }

  doAttack(mode) {
    const ri = this.activeRoleIndex();
    const maxTili = readValues(this.saveRef, ri, STAT.gdtl25);
    const cost = attackStaminaCost(maxTili);
    const tili = readValues(this.saveRef, ri, STAT.tili);
    if (tili < cost) {
      this.feedbackEl.textContent = '\u4f53\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u653b\u51fb';
      this.schedulePlayerTurnResume();
      return;
    }
    writeValues(this.saveRef, ri, STAT.tili, tili - cost);
    if (ri === 0) syncPlayerFromRole(this.saveRef, 0);

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const pickTarget = (index) => {
      const { dmg, target } = applyPlayerAttack(this.combat, mode, index);
      this.feedbackEl.textContent = '\u5bf9 ' + (target?.name || '\u654c\u4eba') + ' \u9020\u6210 ' + dmg + ' \u70b9\u4f24\u5bb3';
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
    };

    if (alive.length > 1) {
      this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
        label: `${m.name} (${m.hp}/${m.maxHp})`,
        index: idx,
      })), (pick) => pickTarget(pick.index));
      return;
    }
    pickTarget(0);
  }

  doDefend() {
    const ri = this.activeRoleIndex();
    this.combat.defendBoostByRole[ri] = 2;
    this.feedbackEl.textContent = '\u91c7\u53d6\u9632\u5fa1\u59ff\u6001\uff0c\u4e0b\u6b21\u53d7\u4f24\u51cf\u8f7b';
    this.finishPlayerAction();
  }

  doEscape(fromClose = false) {
    const result = tryEscapeCombat(this.saveRef, this.combat, { confirmUseItem: true });
    if (result.ok) {
      this.feedbackEl.textContent = result.usedItem ? '\u4f7f\u7528\u8ff7\u8e2a\u86cf\uff0c\u9003\u8dd1\u6210\u529f\uff01' : '\u9003\u8dd1\u6210\u529f\uff01';
      this.canClose = true;
      this.syncPlayerHpToRole();
      setTimeout(() => {
        this.hide();
        this.onFail?.('escaped');
      }, 800);
      return;
    }
    const msg = result.message || (fromClose ? '\u9003\u8dd1\u5931\u8d25\u3002' : '\u9003\u8dd1\u5931\u8d25\uff0c\u7ee7\u7eed\u6218\u6597');
    this.feedbackEl.textContent = msg;
    if (result.reason === 'blocked') {
      this.schedulePlayerTurnResume();
      return;
    }
    this.finishPlayerAction();
  }

  openMagicPicker() {
    const ri = this.activeRoleIndex();
    const { heal, attack, steal } = listCombatSpells(this.saveRef, ri);
    const all = [
      ...heal.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u6062\u590d, \u7075${s.mpCost})`, kind: 'heal' })),
      ...steal.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u5077\u7a83, \u7075${s.mpCost})`, kind: 'steal' })),
      ...attack.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u653b\u51fb, \u7075${s.mpCost})`, kind: 'attack' })),
    ];
    if (!all.length) {
      this.feedbackEl.textContent = '\u672a\u5b66\u4f1a\u6cd5\u672f\u6216\u7075\u529b\u4e0d\u8db3';
      this.schedulePlayerTurnResume();
      return;
    }
    this.showPicker('\u9009\u62e9\u6cd5\u672f', all, (pick) => this.castSpell(pick));
  }

  castSpell(spell) {
    const ri = this.activeRoleIndex();
    const mp = readValues(this.saveRef, ri, STAT.lingli);
    const estCost = spell.isAttack ? calcAttackSpellMpCost(spell.info, spell.level) : spell.mpCost;
    if (mp < estCost) {
      this.feedbackEl.textContent = '\u7075\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u65bd\u6cd5';
      this.schedulePlayerTurnResume();
      return;
    }

    const level = bumpSpellUse(this.saveRef, ri, spell.id);
    const mpCost = spell.isAttack ? calcAttackSpellMpCost(spell.info, level) : spell.mpCost;
    if (mp < mpCost) {
      this.feedbackEl.textContent = '\u7075\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u65bd\u6cd5';
      this.schedulePlayerTurnResume();
      return;
    }

    deductSpellMp(this.saveRef, ri, mpCost);

    if (spell.isSteal) {
      const alive = this.combat.monsters.filter((m) => m.hp > 0);
      const castSteal = (targetIndex) => {
        const target = alive[targetIndex] || alive[0];
        if (!target) return;
        const result = tryStealFromMonster(this.saveRef, target, spell.info, level);
        this.feedbackEl.textContent = result.message;
        this.api?.ui?.refreshStatus?.();
        this.finishPlayerAction();
      };

      if (spell.singleTarget && alive.length > 1) {
        this.showPicker('\u9009\u62e9\u5077\u7a83\u76ee\u6807', alive.map((m, idx) => ({
          label: `${m.name} (${m.hp}/${m.maxHp})`,
          index: idx,
        })), (pick) => castSteal(pick.index));
        return;
      }
      castSteal(0);
      return;
    }

    if (!spell.isAttack) {
      const partyIndices = this.combat.partySlots;
      const targets = spell.singleTarget ? [ri] : partyIndices;
      for (const idx of targets) {
        const gains = calcHealAmount(this.saveRef, idx, spell.info, level);
        applyHealToRole(this.saveRef, idx, gains);
      }
      this.syncAllPartyHp();
      this.renderFightBar();
      this.feedbackEl.textContent = '\u65bd\u5c55 ' + spell.name + ' \u6062\u590d\u751f\u547d';
      this.finishPlayerAction();
      return;
    }

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const applyToMonster = (targetIndex) => {
      const target = alive[targetIndex] || alive[0];
      if (!target) return;
      const { dmg, debuffText } = applySpellAttackToMonster(target, spell.info, level);
      this.feedbackEl.textContent = spell.name + ' \u5bf9 ' + target.name + ' \u9020\u6210 ' + dmg + ' \u70b9\u4f24\u5bb3' + debuffText;
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
    };

    if (spell.singleTarget && alive.length > 1) {
      this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
        label: `${m.name} (${m.hp}/${m.maxHp})`,
        index: idx,
      })), (pick) => applyToMonster(pick.index));
      return;
    }

    if (!spell.singleTarget) {
      let total = 0;
      let debuffText = '';
      for (const m of alive) {
        const result = applySpellAttackToMonster(m, spell.info, level);
        total += result.dmg;
        if (result.debuffText) debuffText = result.debuffText;
      }
      this.feedbackEl.textContent = spell.name + ' \u5168\u4f53\u653b\u51fb\uff0c\u5171\u9020\u6210 ' + total + ' \u70b9\u4f24\u5bb3' + debuffText;
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
      return;
    }

    applyToMonster(0);
  }

  openItemPicker() {
    const { medicine, enhancement, throwable } = listCombatItems(this.saveRef);
    const items = [
      ...medicine.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u836f\u54c1)`, kind: 'medicine' })),
      ...enhancement.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u589e\u5f3a)`, kind: 'enhance' })),
      ...throwable.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u6697\u5668)`, kind: 'throw' })),
    ];
    if (!items.length) {
      this.feedbackEl.textContent = '\u6ca1\u6709\u53ef\u7528\u7269\u54c1';
      this.schedulePlayerTurnResume();
      return;
    }
    this.showPicker('\u9009\u62e9\u7269\u54c1', items, (pick) => this.useCombatItem(pick));
  }

  useCombatItem(item) {
    if (item.kind === 'throw') {
      if (item.name === '\u8ff7\u8e2a\u86cf') {
        changeGoodsByName(this.saveRef, item.name, -1);
        this.feedbackEl.textContent = '\u4f7f\u7528\u8ff7\u8e2a\u86cf\uff0c\u9003\u79bb\u6218\u6597';
        this.canClose = true;
        this.syncPlayerHpToRole();
        setTimeout(() => {
          this.hide();
          this.onFail?.('escaped');
        }, 700);
        return;
      }

      changeGoodsByName(this.saveRef, item.name, -1);
      const alive = this.combat.monsters.filter((m) => m.hp > 0);
      const speed = readValues(this.saveRef, this.activeRoleIndex(), STAT.speed) || this.combat.playerSpeed;
      const applyThrow = (targetIndex) => {
        const target = alive[targetIndex] || alive[0];
        const roll = calcThrowableDamage(item.info, target, speed);
        if (!roll.hit) {
          this.feedbackEl.textContent = item.name + ' \u672a\u547d\u4e2d ' + target.name;
          this.finishPlayerAction();
          return;
        }
        target.hp = Math.max(0, target.hp - roll.dmg);
        this.feedbackEl.textContent = item.name + ' \u547d\u4e2d ' + target.name + '\uff0c\u9020\u6210 ' + roll.dmg + ' \u70b9\u4f24\u5bb3';
        this.renderFightBar();
        this.updateFightTitle();
        this.finishPlayerAction();
      };

      if (alive.length > 1) {
        this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
          label: `${m.name} (${m.hp}/${m.maxHp})`,
          index: idx,
        })), (pick) => applyThrow(pick.index));
        return;
      }
      applyThrow(0);
      return;
    }

    changeGoodsByName(this.saveRef, item.name, -1);
    const ri = this.activeRoleIndex();
    const level = 1;
    const gains = calcHealAmount(this.saveRef, ri, item.info, level);
    if (gains.hpGain <= 0 && readValues(this.saveRef, ri, STAT.life) <= 0) {
      this.feedbackEl.textContent = '\u836f\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u6551\u6d3b';
      changeGoodsByName(this.saveRef, item.name, 1);
      this.schedulePlayerTurnResume();
      return;
    }
    applyHealToRole(this.saveRef, ri, gains);
    this.syncAllPartyHp();
    this.renderFightBar();
    this.feedbackEl.textContent = '\u4f7f\u7528\u4e86 ' + item.name;
    this.finishPlayerAction();
  }

  finishPlayerAction() {
    this.pendingTimer = setTimeout(() => this.startFightRound(), 700);
  }

  schedulePlayerTurnResume() {
    this.turnTimer = setTimeout(() => this.resumePlayerTurn(), 1200);
  }

  resumePlayerTurn() {
    if (!this.combat || this.combat.turn !== 'player') {
      this.startFightRound();
      return;
    }
    const ri = this.activeRoleIndex();
    const name = getRoleDisplayName(this.saveRef, ri + 1);
    this.feedbackEl.textContent = name + ' \u7684\u56de\u5408\uff1a\u653b / \u9632 / \u6cd5 / \u7269 / \u9003\uff08\u70ed\u952e\u53ef\u7528\uff09';
    this.fightActions?.classList.remove('hidden');
    this.promptEl.textContent = name + ' \u51fa\u624b';
    this.turnTimer = setTimeout(() => {
      this.feedbackEl.textContent = '\u672a\u64cd\u4f5c\uff0c\u81ea\u52a8\u9632\u5fa1';
      this.doDefend();
    }, 12000);
  }

  finishFightWin() {
    this.feedbackEl.textContent = '\u6218\u6597\u80dc\u5229\uff01';
    this.canClose = true;
    this.syncAllPartyHp();
    const rewards = calcVictoryRewards(this.combat);
    setTimeout(() => {
      this.hide();
      this.onComplete?.({ type: 'fight', result: 'win', rewards });
    }, 900);
  }

  finishFightEscaped() {
    this.feedbackEl.textContent = '\u654c\u4eba\u9003\u8dd1\u4e86\uff01';
    this.canClose = true;
    this.syncAllPartyHp();
    setTimeout(() => {
      this.hide();
      this.onFail?.('monster-escaped');
    }, 900);
  }

  finishFightLose() {
    this.feedbackEl.textContent = '\u6218\u6597\u5931\u8d25\u2026\u2026';
    this.canClose = true;
    for (const ri of this.combat.partySlots) {
      if (readValues(this.saveRef, ri, STAT.life) <= 0) {
        writeValues(this.saveRef, ri, STAT.life, 1);
      }
    }
    this.syncAllPartyHp();
    setTimeout(() => {
      this.hide();
      this.onFail?.('fight-lose');
      this.api?.game_over?.();
    }, 900);
  }

  digProgressText() {
    if (this.digCount >= 1000) {
      return '\u8003\u8bd5 \u00b7 \u5269\u4f59 ' + Math.max(0, this.digCount - 1000) + ' \u9898 \u00b7 \u6b63\u786e ' + this.digCorrect;
    }
    return '\u7b54\u5bf9 ' + this.digCorrect + ' \u9898 \u00b7 \u7b2c ' + this.jitNum + ' \u9898';
  }

  nextQuestion(isMonsterTurn = false) {
    const q = this.wordEngine.pick(this.settings, this.saveRef.wordProgress, this.saveRef);
    if (!q) {
      this.feedbackEl.textContent = '\u8bcd\u5e93\u4e3a\u7a7a\uff0c\u8bf7\u5148\u9009\u62e9\u8bcd\u5e93\u3002';
      return;
    }
    this.currentQuestion = q;
    this.renderPrompt(q);
    this.feedbackEl.textContent = isMonsterTurn
      ? '\u602a\u7269\u63d0\u95ee\u4e2d'
      : '\u9009\u9879\u70ed\u952e Y/H/N \u6216 1/2/3\uff0c\u9f20\u6807\u505c\u75595\u79d2\u663e\u793a\u63d0\u793a';
    this.progressEl.textContent = this.mode === 'study'
      ? '\u5269\u4f59 ' + this.remaining + ' \u9898'
      : this.mode === 'dig'
        ? this.digProgressText()
        : '\u602a\u7269\u63d0\u95ee \u00b7 ' + (pickActiveMonster(this.combat)?.name || '');

    const choiceBg = q.reverse ? (this.settings.choiceEnBg || '#ffffff') : (this.settings.choiceCnBg || '#ffffff');
    const renderChoices = () => {
      this.choicesEl.innerHTML = '';
      q.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.fontSize = (q.reverse ? this.settings.enSize : this.settings.cnSize) + 'px';
        btn.style.color = q.reverse ? this.settings.enColor : this.settings.cnColor;
        btn.style.backgroundColor = choiceBg;
        btn.textContent = (idx + 1) + '. ' + choice;
        btn.addEventListener('click', () => this.submitAnswer(choice, isMonsterTurn));
        this.bindChoiceHint(btn, choice, q);
        this.choicesEl.appendChild(btn);
      });
    };

    const turboLeft = this.saveRef ? readValues(this.saveRef, 0, STAT.yanchi30) : 0;
    const skipDelay = turboLeft > 0 && !isMonsterTurn;

    if (this.settings.delayShowWord > 0 && !skipDelay && !isMonsterTurn) {
      this.choicesEl.innerHTML = '<p style="text-align:center;color:inherit">\u9009\u9879\u52a0\u8f7d\u4e2d\u2026</p>';
      setTimeout(renderChoices, this.settings.delayShowWord);
    } else {
      renderChoices();
      if (skipDelay && this.saveRef) {
        writeValues(this.saveRef, 0, STAT.yanchi30, turboLeft - 1);
      }
    }
  }

  submitAnswer(choice, isMonsterTurn) {
    const q = this.currentQuestion;
    const correct = choice === q.answer;
    this.wordEngine.recordResult(q.entry, correct, this.saveRef.wordProgress, this.settings, q.wordIndex, this.saveRef);
    this.saveRef.wordStats[correct ? 'correct' : 'wrong'] += 1;
    this.api?.persist?.();

    [...this.choicesEl.querySelectorAll('button')].forEach((btn) => {
      btn.disabled = true;
      if (btn.textContent.includes(q.answer)) btn.classList.add('correct');
      if (btn.textContent.includes(choice) && !correct) btn.classList.add('wrong');
    });

    if (this.mode === 'study') {
      if (!correct) {
        this.feedbackEl.textContent = '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u80cc\u5355\u8bcd\u7ed3\u675f\u3002';
        setTimeout(() => { this.hide(); this.onFail?.('wrong'); }, 900);
        return;
      }
      this.remaining -= 1;
      addPartyLingliByPercent(this.saveRef);
      this.api?.ui?.refreshStatus?.();
      if (this.remaining <= 0) {
        this.feedbackEl.textContent = '\u5168\u90e8\u7b54\u5bf9\uff0c\u5e72\u5f97\u6f02\u4eae\uff01';
        setTimeout(() => { this.hide(); this.onComplete?.({ type: 'study' }); }, 900);
        return;
      }
      setTimeout(() => this.nextQuestion(), 700);
      return;
    }

    if (this.mode === 'dig') {
      this.handleDigAnswer(correct);
      return;
    }

    const mult = monsterAttackMultiplier(correct);
    const monster = pickActiveMonster(this.combat);
    let feedback;

    if (monster && monsterCanFlee(monster)) {
      if (correct) {
        this.feedbackEl.textContent = `\u7b54\u5bf9\u4e86\uff01${monster.name} \u9003\u8dd1\u5931\u8d25\u3002`;
        setTimeout(() => this.startFightRound(), 1000);
        return;
      }
      const flee = tryMonsterFlee(this.combat, this.saveRef, mult);
      if (flee.fled) {
        this.renderFightBar();
        this.updateFightTitle();
        feedback = `\u7b54\u9519\u4e86\uff01${flee.monster.name} \u9003\u8d70\u4e86\uff01`;
        this.feedbackEl.textContent = feedback;
        setTimeout(() => this.startFightRound(), 1000);
        return;
      }
    }

    if (monster && monsterWillUseSpell(monster)) {
      const spellInfo = getMonsterSpellInfo(monster);
      if (spellInfo) {
        const spellResult = applyMonsterSpellAttack(this.combat, this.saveRef, mult, spellInfo);
        this.renderFightBar();
        this.syncAllPartyHp();
        feedback = formatMonsterSpellFeedback(this.saveRef, correct, spellResult);
      }
    }

    if (!feedback) {
      const { dmg, monster: atkMonster, targetRoleIndex } = applyMonsterAttack(this.combat, this.saveRef, mult);
      const targetName = getRoleDisplayName(this.saveRef, targetRoleIndex + 1);
      this.renderFightBar();
      this.syncAllPartyHp();
      feedback = correct
        ? `\u7b54\u5bf9\u4e86\uff01${atkMonster.name} \u5bf9 ${targetName} \u7684\u653b\u51fb\u88ab\u524a\u5f31\uff0c\u4ec5\u53d7\u5230 ${dmg} \u70b9\u4f24\u5bb3`
        : `\u7b54\u9519\u4e86\uff01${targetName} \u53d7\u5230 ${atkMonster.name} \u7684\u731b\u70c8\u653b\u51fb ${dmg} \u70b9\u4f24\u5bb3`;
    }

    this.feedbackEl.textContent = feedback;

    setTimeout(() => {
      this.startFightRound();
    }, 1000);
  }

  handleDigAnswer(correct) {
    const isExam = this.digCount >= 1000;
    const isHerb = this.digCount === 200;
    const isMeditate = this.digCount === 300;

    if (isExam) this.gameKaoshi -= 3;

    if (!correct) {
      if (isHerb) this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u91c7\u836f\u7ed3\u675f\u3002';
      else if (isMeditate) this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u6253\u5750\u7ed3\u675f\u3002';
      else if (isExam) this.feedbackEl.textContent = '\u8003\u8bd5\u9519\u4e86\u4e00\u9898\u3002';
      else this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u6316\u77ff\u7ed3\u675f\u3002';

      if (!isExam) {
        setTimeout(() => {
          this.hide();
          this.onFail?.(this.digPayload({ wrong: true }));
        }, 900);
        return;
      }
    } else if (isMeditate) {
      this.feedbackEl.textContent = '\u6062\u590d\u7075\u529b1%';
    } else if (isExam) {
      this.feedbackEl.textContent =
        '\u8003\u8bd5\u6b63\u786e' + (this.digCorrect + 1) + '\u9898\u5269\u4f59' + (this.digCount - 1001) + '\u9898';
    } else {
      this.feedbackEl.textContent = '\u589e\u52a0\u7ecf\u9a8c\u503c5';
      const table = isHerb ? getHerbTable() : getMineTable();
      const item = rollDigDrop(table);
      if (item) {
        this.api?.game_goods_change_n?.(item, 1);
        this.feedbackEl.textContent = item + ' \u6316\u5230\u4e00';
      } else {
        this.feedbackEl.textContent = '\u9009\u62e9\u6b63\u786e\uff01 \u5f53\u524d ' + this.jitNum + ' \u4e2a';
      }
    }

    this.jitNum += 1;

    if (correct) {
      if (isMeditate) {
        this.api?.game_lingli_add?.(0, 1);
        syncPlayerFromRole(this.saveRef, 0);
        this.api?.ui?.refreshStatus?.();
      } else {
        this.api?.game_attribute_change?.(0, STAT.experience, 5);
        this.digCorrect += 1;
        if (!isExam && this.digCorrect === 100) {
          this.digCorrect = 0;
          this.api?.game_attribute_change?.(0, STAT.experience, 1000);
          this.feedbackEl.textContent = '\u5956\u52b1\u7ecf\u9a8c\u503c1000';
        }
      }
    }

    if (isExam && this.digCount > 1000) {
      this.digCount -= 1;
    }

    if (this.digCount === 1000) {
      this.finishDigExam();
      return;
    }

    const delay = isExam && !correct ? 1200 : 900;
    setTimeout(() => this.nextQuestion(), delay);
  }
}
