import { loadScene, peekSceneMeta, preprocessSceneHtml, wireGameLinks, normalizeGameLinks } from './scene-parser.js';
import {
  CITY_TRAVEL_STAMINA_PERCENT,
  shouldApplyCityTravelStaminaCost,
} from './city-travel.js';
import { hydrateGpicElements } from './gpic-renderer.js';
import { DialogueEngine } from './dialogue-engine.js';
import { isOnlineSceneId, isExternalUrl, sanitizeChatForOffline, OFFLINE_MSG } from './offline-filter.js';
import { learnSkillFromItem } from './craft-panel.js';
import { changeGoodsByName } from './inventory-system.js';
import {
  ensureParty,
  findRoleIndex,
  readValues,
  writeValues,
  syncPlayerFromRole,
  syncRoleFromPlayer,
  getRoleCount,
  getRoleDisplayName,
  bootstrapRoleStats,
  createRoleFromTemplate,
  createJoinedRole,
  findDepartedFriend,
  storeDepartedFriend,
  deductPartyTiliForMazeTravel,
  deductPartyTiliForCityTravel,
  sceneEventValue,
  resEventValue,
  parseEventIdList,
  STAT,
  gameRandomChance,
  gameBaseRandomZero,
} from './game-runtime.js';
import {
  bindGameHandlers,
  parseGameCall,
  evalCondition,
  evalTemplate,
  evalGameExpr,
  buildResGoodsHtml,
  renderIncludeHtml,
} from './game-script.js';
import { getReadTextLine, getIncludeCache } from './game-config.js';
import { applyTaskRewards, getTaskDescription } from './task-system.js';
import {
  countNonEmptySlots,
  persistSave,
  findMostRecentSlot,
  getActiveSlotId,
} from './save-manager.js';
import { loadSlotIntoGame } from './save-transfer.js';

/** Original game_pop_a return code: defer remaining script until word quiz finishes (maze html_pop). */
export const POP_DEFER_CODE = 1881;

const MAX_TIME_EXE_QUEUE = 512;
const MAX_TIME_EXE_SECONDS = 60000;

export class SceneEngine {
  constructor(hostEl, chatEl, api) {
    this.hostEl = hostEl;
    this.chatEl = chatEl;
    this.api = api;
    this.current = null;
    this.hostEl.addEventListener('click', (e) => this.onClick(e));
    this.hostEl.addEventListener('mouseover', (e) => this.onHover(e));
  }

  async showScene(id) {
    try {
      const scene = await loadScene(id);
      this.current = scene;
      this.api.state.currentScene = id;
      this.api.state.currentSceneAttr = Number(scene.attr) || 0;
      this.api.ui.setSceneTitle(scene.name || `\u573a\u666f ${id}`);

      const ctx = this.api.createSceneContext();
      ctx.sideEffects = [];
      ctx.queueScript = (script) => {
        if (script) ctx.sideEffects.push(script);
      };

      let html = preprocessSceneHtml(scene.html, ctx);
      html = `<div class="scene-inner">${html}</div>`;
      html += `
      <div id="layer_chat1" class="scene-chat-bridge hidden">
        <div id="cell_chat1"></div>
      </div>`;

      this.hostEl.innerHTML = html;
      this.chatEl.innerHTML = '';
      this.api.ui.hideChat();
      document.querySelectorAll('.scene-bgm').forEach((el) => {
        if (el !== this.hostEl.querySelector('.scene-bgm')) {
          el.pause();
          el.remove();
        }
      });

      normalizeGameLinks(this.hostEl);
      await hydrateGpicElements(this.hostEl, {
        defaultWidth: Math.max(320, this.hostEl.clientWidth - 24),
        defaultHeight: 120,
      });

      if (scene.beforeLoad) await this.api.runScript(scene.beforeLoad);
      if (scene.afterLoad) await this.api.runScript(scene.afterLoad);

      if (ctx.sideEffects?.length) {
        for (const script of ctx.sideEffects) {
          await this.api.runScript(script);
        }
      }

      if (scene.chatScript) {
        this.api.dialogue.loadScript(scene.chatScript);
      }
    } catch (err) {
      this.api.ui.toast(`\u573a\u666f ${id} \u65e0\u6cd5\u52a0\u8f7d\uff1a${err.message}`);
      console.error(err);
    }
  }

  onClick(e) {
    const link = e.target.closest('[data-game-link]');
    if (!link) return;
    e.preventDefault();
    const href = decodeURIComponent(link.getAttribute('data-game-link'));
    this.api.handleLink(href);
  }

  onHover(e) {
    const el = e.target.closest('[data-game-hover]');
    if (!el) return;
    const href = decodeURIComponent(el.getAttribute('data-game-hover'));
    this.api.handleLink(href);
  }

  getAction(code) {
    return this.current?.actions?.[code] || null;
  }
}

export class GameAPI {
  constructor({ state, settings, sceneEngine, wordPopup, minigame, ui, persist, panels }) {
    this.state = state;
    this.settings = settings;
    this.sceneEngine = sceneEngine;
    this.wordPopup = wordPopup;
    this.minigame = minigame;
    this.ui = ui;
    this.persist = persist;
    this.panels = panels || {};
    this.dialogue = new DialogueEngine(this);
    this.talkName = '';
    this.handlers = {};
    this._timeExeTimers = new Set();
    bindGameHandlers(this);
  }

  normalizeTimeExeSeconds(raw) {
    let seconds = Math.floor(Number(raw) || 0);
    if (seconds <= 0) seconds = 1;
    if (seconds > MAX_TIME_EXE_SECONDS) {
      this.ui.toast('\u5b9a\u65f6\u51fd\u6570\u53c2\u6570\u8fc7\u5927\uff0c\u5df2\u6539\u4e3a 60 \u79d2');
      seconds = 60;
    }
    return seconds;
  }

  /** Match Timer_exe: parameter N fires after max(1, N-1) seconds at 1 Hz. */
  timeExeDelayMs(seconds) {
    const sec = this.normalizeTimeExeSeconds(seconds);
    return Math.max(1, sec - 1) * 1000;
  }

  createSceneContext() {
    ensureParty(this.state);
    const ctx = {
      sceneEvents: this.state.sceneEvents,
      resEvents: this.state.resEvents,
      saveCount: countNonEmptySlots(),
      currentScene: this.state.currentScene,
      sideEffects: [],
    };
    ctx.evalCondition = (expr) => evalCondition(this, expr);
    ctx.evalTemplate = (expr) => evalTemplate(this, expr, ctx);
    ctx.queueScript = (script) => {
      if (script) ctx.sideEffects.push(script);
    };
    return ctx;
  }

  renderInclude(file, ctx) {
    return renderIncludeHtml(this, file, ctx || this.createSceneContext());
  }

  async handleLink(href) {
    try {
      const h = href.trim();
      if (isExternalUrl(h)) {
        this.ui.toast(OFFLINE_MSG);
        return;
      }
      if (/^\d+$/.test(h)) {
        if (isOnlineSceneId(Number(h))) {
          this.ui.toast(OFFLINE_MSG);
          return;
        }
        return await this.game_page(Number(h));
      }
      if (/^D\d+$/i.test(h)) {
        const script = this.sceneEngine.getAction(h.toUpperCase()) || this.sceneEngine.getAction(h);
        if (script) return await this.runScript(script);
        return this.ui.toast(`\u672a\u627e\u5230\u52a8\u4f5c\u7801 ${h}`);
      }
      if (h.startsWith('game_') || h.includes('(')) return await this.runScript(h);
      return await this.runScript(h);
    } catch (err) {
      console.error(err);
      this.ui.toast(err.message || '\u64cd\u4f5c\u5931\u8d25');
    }
  }

  async runScript(script) {
    const parts = splitScript(script);
    try {
      for (let i = 0; i < parts.length; i += 1) {
        const result = await this.runOne(parts[i].trim());
        const code = Number(result);
        if (code === 0) break;
        if (code === POP_DEFER_CODE) {
          const rest = parts.slice(i + 1).join(';').trim();
          this.state.deferredScript = rest || '';
          break;
        }
      }
    } finally {
      this.state.pendingMazeWordTravelCost = 0;
    }
  }

  runDeferredScript() {
    const script = String(this.state.deferredScript || '').trim();
    this.state.deferredScript = '';
    if (script) return this.runScript(script);
    return Promise.resolve();
  }

  useMazePopDefer() {
    const attr = Number(this.state.currentSceneAttr) || 0;
    return (attr & 2) === 2 && !this.settings?.mgPop;
  }

  isMazeScene() {
    return ((Number(this.state.currentSceneAttr) || 0) & 2) === 2;
  }

  applyPendingMazeWordTravelCost() {
    const wordCount = Number(this.state.pendingMazeWordTravelCost) || 0;
    if (!wordCount || !this.isMazeScene()) return;
    deductPartyTiliForMazeTravel(this.state, wordCount);
    this.state.pendingMazeWordTravelCost = 0;
    this.ui.refreshStatus();
    this.persist();
  }

  async applyCityTravelStaminaCost(toId, rawPageId) {
    if (!this.state.started) return;
    const fromId = Number(this.state.currentScene);
    const targetId = Number(toId);
    if (!fromId || !targetId || fromId === targetId) return;

    const toMeta = await peekSceneMeta(targetId);
    const fromAttr = Number(this.state.currentSceneAttr) || 0;
    const toAttr = Number(toMeta.attr) || 0;
    if (!shouldApplyCityTravelStaminaCost(fromId, targetId, fromAttr, toAttr, rawPageId)) return;

    deductPartyTiliForCityTravel(this.state, CITY_TRAVEL_STAMINA_PERCENT);
    this.ui.refreshStatus();
    this.persist();
  }

  async runOne(expr) {
    if (!expr) return 1;

    if (expr.toLowerCase().startsWith('if ')) {
      return this.runIfStatement(expr);
    }

    if (/^D\d+$/i.test(expr)) {
      const script = this.sceneEngine.getAction(expr.toUpperCase()) || this.sceneEngine.getAction(expr);
      if (script) return this.runScript(script);
      return 1;
    }

    const call = parseGameCall(expr);
    if (call) {
      return this.invokeGame(call.name, call.args);
    }

    if (expr.includes(';')) return this.runScript(expr);
    return 1;
  }

  async runIfStatement(expr) {
    const m = expr.match(/^if\s+([\s\S]+?)\s*then(?![A-Za-z0-9_])\s*([\s\S]+)$/i);
    if (!m) return 1;
    let body = m[2].trim().replace(/\s*end\s*$/i, '').trim();
    const elseIdx = findElseInBody(body);
    if (elseIdx >= 0) {
      const truePart = body.slice(0, elseIdx).trim();
      const falsePart = body.slice(elseIdx + 4).trim();
      if (await evalCondition(this, m[1].trim())) return this.runScript(truePart);
      return this.runScript(falsePart);
    }
    if (await evalCondition(this, m[1].trim())) return this.runScript(body);
  }

  evalCondition(expr) {
    return evalCondition(this, expr);
  }

  resolvePageId(id) {
    const n = Number(id);
    if (n === 0) return 0;
    if (n < 10000) return this.state.currentScene + n;
    return n;
  }

  game_page(id) {
    const target = this.resolvePageId(id);
    if (target === 0) return Promise.resolve();
    if (isOnlineSceneId(target)) {
      this.ui.toast(OFFLINE_MSG);
      return Promise.resolve();
    }
    return this.game_show_scene(target, Number(id));
  }

  async game_show_scene(id, rawPageId = null) {
    this.applyPendingMazeWordTravelCost();
    const targetId = Number(id);
    const raw = rawPageId != null ? Number(rawPageId) : targetId;
    if (targetId && this.state.currentScene !== targetId) {
      await this.applyCityTravelStaminaCost(targetId, raw);
    }
    if (targetId !== this.state.currentScene) {
      this.state.oldScene = this.state.currentScene;
    }
    return this.sceneEngine.showScene(targetId);
  }

  game_goto_oldpage() {
    return this.game_page(this.state.oldScene || this.state.currentScene);
  }

  game_goto_home() {
    if (this.state.chatLocked || this.state.noGoHome) {
      this.ui.toast('\u56de\u57ce\u5931\u8d25\uff0c\u5f53\u524d\u73af\u5883\u4e0d\u5141\u8bb8\u56de\u57ce\u3002');
      return Promise.resolve(0);
    }
    if (!this.state.homeScene) return Promise.resolve(0);
    return this.game_page(this.state.homeScene);
  }

  game_write_home_id() {
    this.state.homeScene = this.state.currentScene;
    this.persist();
    return 1;
  }

  game_allow_gohome(v) {
    this.state.noGoHome = v === 0;
    return 1;
  }

  game_reload_direct() {
    return this.sceneEngine.showScene(this.state.currentScene);
  }

  game_start_now() {
    ensureParty(this.state);
    syncRoleFromPlayer(this.state, 0);
    bootstrapRoleStats(this.state, 0);
    this.state.party.forEach((role, idx) => bootstrapRoleStats(this.state, idx));
    this.state.started = true;
    this.state.slotId = null;
    sessionStorage.setItem('wordgame-in-progress', '1');
    this.ui.refreshStatus();
    return 1;
  }

  canSaveInCurrentScene({ allowMaze = false } = {}) {
    if (!this.state.started) {
      this.ui.toast('\u6e38\u620f\u6ca1\u6709\u5f00\u59cb\uff0c\u8bf7\u5148\u5f00\u59cb\u6e38\u620f\u6216\u8bfb\u6863\u3002');
      return false;
    }
    if (this.isMazeScene() && !allowMaze) {
      this.ui.toast('\u8ff7\u5bab\u5185\u4e0d\u80fd\u5b58\u76d8\uff0c\u9700\u8981\u9000\u51fa\u8ff7\u5bab\u6216\u8005\u4f7f\u7528\u6e38\u620f\u9053\u5177\u5b58\u50a8\u5361\u5b58\u76d8\u3002');
      return false;
    }
    return true;
  }

  async game_save_continue() {
    const count = countNonEmptySlots();
    if (count <= 0) {
      this.ui.toast('\u8fd8\u6ca1\u6709\u5b58\u6863\uff0c\u8bf7\u5148\u5f00\u59cb\u6e38\u620f\u5e76\u4fdd\u5b58\u8fdb\u5ea6\u3002');
      this.panels.save?.open({ mode: 'load' });
      return 0;
    }
    const slotId = getActiveSlotId() ?? findMostRecentSlot();
    try {
      await loadSlotIntoGame(this._saveAppRef(), slotId);
      sessionStorage.setItem('wordgame-in-progress', '1');
      this.ui.toast('\u65e7\u68a6\u518d\u7eed\uff0c\u5df2\u8bfb\u5165\u6863\u6848');
      return 1;
    } catch (err) {
      this.ui.toast(err.message || '\u8bfb\u6863\u5931\u8d25');
      this.panels.save?.open({ mode: 'load' });
      return 0;
    }
  }

  game_save_quick() {
    if (!this.state.started) {
      this.ui.toast('\u6e38\u620f\u6ca1\u6709\u5f00\u59cb\uff0c\u8bf7\u5148\u5f00\u59cb\u6e38\u620f\u6216\u8bfb\u6863\u3002');
      return 0;
    }
    const sceneName = this.sceneEngine.current?.name || '\u5b58\u6863';
    persistSave(this.state, { sceneName });
    sessionStorage.setItem('wordgame-in-progress', '1');
    this.ui.toast('\u6e38\u620f\u5df2\u4fdd\u5b58');
    return 1;
  }

  _saveAppRef() {
    return {
      state: this.state,
      api: this,
      ui: this.ui,
      settings: this.settings,
      wordEngine: this.wordPopup?.wordEngine,
    };
  }

  game_get_pscene_id(i) {
    return this.state.currentScene + Number(i);
  }

  game_read_temp(id) {
    return Number(this.state.temp[String(id)]) || 0;
  }

  game_write_temp(id, value) {
    this.state.temp[String(id)] = Number(value);
    this.persist();
    return 1;
  }

  game_clear_temp() {
    this.state.temp = {};
    this.state.tempStrings = {};
    this.persist();
    return 1;
  }

  game_check_temp(id, value) {
    return this.game_read_temp(id) >= Number(value) ? 1 : 0;
  }

  game_read_temp_string(id) {
    return this.state.tempStrings[String(id)] || ' ';
  }

  game_write_temp_string(id, value) {
    this.state.tempStrings[String(id)] = value;
    this.persist();
    return 1;
  }

  game_read_scene_integer(id) {
    return sceneEventValue(this.state, id);
  }

  game_write_scene_integer(id, value) {
    this.state.sceneEvents[String(id)] = Number(value);
    this.persist();
    return 1;
  }

  game_inc_scene_event(id, v) {
    const cur = sceneEventValue(this.state, id);
    this.state.sceneEvents[String(id)] = cur + Number(v);
    this.persist();
    return 1;
  }

  game_dec_scene_event(id, v) {
    const cur = sceneEventValue(this.state, id);
    this.state.sceneEvents[String(id)] = Math.max(0, cur - Number(v));
    this.persist();
    return 1;
  }

  game_add_scene_event(id) {
    this.state.sceneEvents[String(id)] = 1;
    this.persist();
    return 1;
  }

  game_del_scene_event(id) {
    delete this.state.sceneEvents[String(id)];
    this.persist();
    return 1;
  }

  game_check_scene_event(id) {
    return sceneEventValue(this.state, id);
  }

  game_not_scene_event(id) {
    return sceneEventValue(this.state, id) === 0 ? 1 : 0;
  }

  game_add_res_event(id) {
    this.state.resEvents[String(id)] = 1;
    this.persist();
    return 1;
  }

  game_del_res_event(id) {
    delete this.state.resEvents[String(id)];
    this.persist();
    return 1;
  }

  game_check_res_event(id) {
    return resEventValue(this.state, id);
  }

  game_not_res_event(id) {
    return resEventValue(this.state, id) === 0 ? 1 : 0;
  }

  game_check_res_event_and(list) {
    return parseEventIdList(list).every((id) => resEventValue(this.state, id) !== 0) ? 1 : 0;
  }

  game_check_res_event_or(list) {
    return parseEventIdList(list).some((id) => resEventValue(this.state, id) !== 0) ? 1 : 0;
  }

  game_not_res_event_and(list) {
    return parseEventIdList(list).every((id) => resEventValue(this.state, id) === 0) ? 1 : 0;
  }

  game_not_res_event_or(list) {
    return parseEventIdList(list).some((id) => resEventValue(this.state, id) === 0) ? 1 : 0;
  }

  game_check_scene_event_and(list) {
    return parseEventIdList(list).every((id) => sceneEventValue(this.state, id) !== 0) ? 1 : 0;
  }

  game_check_scene_event_or(list) {
    return parseEventIdList(list).some((id) => sceneEventValue(this.state, id) !== 0) ? 1 : 0;
  }

  game_not_scene_event_and(list) {
    return parseEventIdList(list).every((id) => sceneEventValue(this.state, id) === 0) ? 1 : 0;
  }

  game_not_scene_event_or(list) {
    return parseEventIdList(list).some((id) => sceneEventValue(this.state, id) === 0) ? 1 : 0;
  }

  game_attribute_change(p, statId, delta) {
    const apply = (roleIndex) => {
      const cur = readValues(this.state, roleIndex, statId);
      writeValues(this.state, roleIndex, statId, cur + Number(delta));
    };
    if (Number(p) === 0) {
      for (let i = 0; i < getRoleCount(this.state); i += 1) apply(i);
    } else if (p <= getRoleCount(this.state)) {
      apply(Number(p) - 1);
    } else return 0;
    syncPlayerFromRole(this.state, 0);
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_lingli_add(p, percent) {
    const pct = Number(percent) || 0;
    const apply = (roleIndex) => {
      const maxMp = readValues(this.state, roleIndex, STAT.gdll26);
      let mp = readValues(this.state, roleIndex, STAT.lingli);
      mp += Math.round(maxMp * pct / 100);
      mp = Math.max(0, Math.min(maxMp, mp));
      writeValues(this.state, roleIndex, STAT.lingli, mp);
    };
    if (Number(p) === 0) {
      for (let i = 0; i < getRoleCount(this.state); i += 1) apply(i);
    } else if (p <= getRoleCount(this.state)) {
      apply(Number(p) - 1);
    } else return 0;
    syncPlayerFromRole(this.state, 0);
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_run_off_no(i) {
    this.state.cannotRunOff = Number(i) === 0;
    return 1;
  }

  game_role_value_half(id) {
    const apply = (roleIndex) => {
      const cur = readValues(this.state, roleIndex, STAT.life);
      writeValues(this.state, roleIndex, STAT.life, Math.floor(cur / 2));
    };
    if (Number(id) === 0) {
      for (let i = 0; i < getRoleCount(this.state); i += 1) apply(i);
    } else if (id <= getRoleCount(this.state)) {
      apply(Number(id) - 1);
    } else return 0;
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_grade(name, level) {
    const idx = findRoleIndex(this.state, name);
    if (idx < 0) return 0;
    return readValues(this.state, idx, STAT.grade) >= Number(level) ? 1 : 0;
  }

  game_check_role_values(name, statId, value) {
    const idx = findRoleIndex(this.state, name);
    if (idx < 0) return false;
    return readValues(this.state, idx, statId) >= Number(value);
  }

  game_check_role_values_byid(id, statId, valueToken) {
    let roleId = Number(id);
    if (roleId <= 0) roleId = 1;
    const idx = roleId - 1;
    if (idx < 0 || idx >= getRoleCount(this.state)) return 0;
    const threshold = evalGameExpr(this, valueToken);
    return readValues(this.state, idx, Number(statId)) >= threshold ? 1 : 0;
  }

  game_id_is_name(id, name) {
    let roleId = Number(id);
    if (roleId <= 0) roleId = 1;
    const role = this.state.party[roleId - 1];
    if (!role) return 0;
    return role.oldName === name ? 1 : 0;
  }

  game_can_fly() {
    const attr = Number(this.state.currentSceneAttr) || 0;
    if (attr & 8) return 0;
    if (this.state.gameTimer) return 0;
    if (this.state.noGoHome) return 0;
    return 1;
  }

  game_sex_from_id(id) {
    const male = readValues(this.state, 0, STAT.sex) === 1;
    return Number(id) === 1 ? (male ? 1 : 0) : (male ? 0 : 1);
  }

  game_get_newname_at_id(id) {
    let x = Number(id);
    if (x <= 0) x = 1;
    return getRoleDisplayName(this.state, x);
  }

  game_get_oldname_at_id(id) {
    let x = Number(id);
    if (x <= 0) x = 1;
    const role = this.state.party[x - 1];
    return role?.oldName || ' ';
  }

  game_newname_from_oldname(name) {
    const idx = findRoleIndex(this.state, name);
    if (idx < 0) return name;
    return getRoleDisplayName(this.state, idx + 1);
  }

  game_add_friend(name, mode = 1) {
    if (findRoleIndex(this.state, name) >= 0) return 0;
    if (this.state.friendList.includes(name)) return 0;
    const restored = Number(mode) === 0 && !!findDepartedFriend(this.state, name);
    const role = createJoinedRole(this.state, name, mode);
    this.state.party.push(role);
    if (!restored) bootstrapRoleStats(this.state, this.state.party.length - 1);
    this.state.friendList.push(role.oldName || name);
    this.state.partyCount = this.state.party.length;
    this.ui.toast(`${name} \u52a0\u5165\u4e86\u961f\u4f0d\u3002`);
    this.persist();
    return 1;
  }

  game_del_friend(name, showMsg = 1) {
    const idx = findRoleIndex(this.state, name);
    if (idx <= 0) return 0;
    const role = this.state.party[idx];
    storeDepartedFriend(this.state, role);
    this.state.party.splice(idx, 1);
    const aliases = new Set([name, role.oldName, role.name].filter(Boolean));
    this.state.friendList = this.state.friendList.filter((n) => !aliases.has(n));
    this.state.partyCount = this.state.party.length;
    if (showMsg) this.ui.toast(`${name} \u79bb\u5f00\u4e86\u961f\u4f0d\u3002`);
    this.persist();
    return 1;
  }

  game_role_only_show(name) {
    this.state.party.forEach((role, idx) => {
      role.savedHidden = readValues(this.state, idx, STAT.hide);
      const show = role.oldName === name || role.name === name ? 1 : 0;
      writeValues(this.state, idx, STAT.hide, show);
    });
    this.state.onlyShow = name;
    return 1;
  }

  game_role_reshow() {
    this.state.party.forEach((role, idx) => {
      writeValues(this.state, idx, STAT.hide, role.savedHidden ?? 1);
    });
    this.state.onlyShow = null;
    return 1;
  }

  game_set_role_0_hide(name, value) {
    const idx = findRoleIndex(this.state, name);
    if (idx < 0) return 0;
    writeValues(this.state, idx, STAT.hide, Number(value));
    this.persist();
    return 1;
  }

  game_inner_html(id, html) {
    const key = String(id).startsWith('biao_') ? String(id) : `bo_${id}`;
    const el = document.getElementById(key);
    if (el) el.innerHTML = html || '';
    return 1;
  }

  game_biao_html(flag) {
    const sceneId = this.game_get_pscene_id(0);
    const html = Number(flag) === 0
      ? `<a href="game_write_temp(${sceneId},0);game_biao_html(0)" title="\u53d6\u6d88\u6807\u8bb0"><img src="data/img/img_flag.gif" border="0">${this.state.currentScene - 10000}</a>`
      : `<a href="game_write_temp(${sceneId},1);game_biao_html(1)" title="\u5728\u8fd9\u91cc\u505a\u4e2a\u6807\u8bb0\uff0c\u8868\u660e\u5230\u8fc7\u8fd9\u91cc\u4e86\u3002">\u70b9\u6b64<b>\u505a\u4e2a\u6807\u8bb0</b></a>`;
    const el = document.getElementById('biao_1');
    if (el) el.innerHTML = html;
    return 1;
  }

  game_include_str(file) {
    const base = String(file || '').replace(/\.upp$/i, '').replace(/^dat[/\\]/i, '');
    return getIncludeCache(base) || getIncludeCache('biao_yuedu') || '';
  }

  game_get_read_txt(index) {
    const line = getReadTextLine(Number(index), this.state);
    return line ? `<br>${line}` : ' ';
  }

  game_res_goods(i, sl, name) {
    return this.game_res_goods_html(i, sl, name, this.createSceneContext());
  }

  game_res_goods_html(i, sl, name, ctx) {
    return buildResGoodsHtml(this, i, sl, name, ctx);
  }

  game_change_money(v) {
    writeValues(this.state, 0, STAT.money, readValues(this.state, 0, STAT.money) + Number(v));
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_bet(id, flag) {
    const key = String(id);
    let amount;
    if (Object.prototype.hasOwnProperty.call(this.state.temp, key)) {
      amount = Number(this.state.temp[key]) || 0;
    } else {
      amount = readValues(this.state, 0, STAT.money);
      this.game_write_temp(id, amount);
    }
    return this.game_pop(1).then((ok) => {
      if (!ok) return 0;
      const curMoney = readValues(this.state, 0, STAT.money);
      if (amount <= 0 || curMoney < amount) {
        this.ui.toast('\u94b1\u4e0d\u591f\uff0c\u65e0\u6cd5\u4e0b\u6ce8\u3002');
        return 0;
      }
      const roll = gameBaseRandomZero(3);
      const win = Number(flag) === 1 ? roll === 1 : roll === 0;
      if (win) {
        this.game_change_money(amount);
        return 1;
      }
      this.game_change_money(-amount);
      return 0;
    });
  }

  async game_bubble(count) {
    if (!this.state.started) {
      this.ui.toast('\u6e38\u620f\u6ca1\u6709\u5f00\u59cb\uff0c\u8bf7\u5148\u5f00\u59cb\u5355\u673a\u6e38\u620f\u6216\u5b58\u53d6\u8fdb\u5ea6\u3002');
      return 0;
    }
    if (!this.minigame) {
      this.ui.toast('\u6ce1\u6ce1\u9f99\u672a\u5c31\u7eea');
      return 0;
    }
    const ok = await this.minigame.openBubble(Number(count) || 60, this.state);
    return ok ? 1 : 0;
  }

  async game_wuziqi(level) {
    if (!this.state.started) {
      this.ui.toast('\u6e38\u620f\u6ca1\u6709\u5f00\u59cb\uff0c\u8bf7\u5148\u5f00\u59cb\u5355\u673a\u6e38\u620f\u6216\u5b58\u53d6\u8fdb\u5ea6\u3002');
      return 0;
    }
    if (!this.minigame) {
      this.ui.toast('\u4e94\u5b50\u68cb\u672a\u5c31\u7eea');
      return 0;
    }
    const ok = await this.minigame.openWuziqi(Number(level) || 1, this.state);
    return ok ? 1 : 0;
  }

  game_pop_dig(count) {
    const c = Number(count) || 100;
    const finish = (payload = {}) => {
      this.persist();
      if (c >= 1000) {
        const kaoshi = Number(payload.gameKaoshi) || 0;
        return kaoshi <= 35 ? (Number(payload.correctCount) || 0) : 0;
      }
      return payload.success ? 1 : 0;
    };
    return new Promise((resolve) => {
      this.wordPopup.openDig(c, this.state, {
        onComplete: (payload) => resolve(finish({ ...payload, success: true })),
        onFail: (payload) => {
          if (typeof payload === 'string') {
            resolve(finish({ success: false }));
            return;
          }
          resolve(finish({ ...payload, success: false }));
        },
      });
    });
  }

  game_pop_game(count, type) {
    return this.game_pop_fight(Math.max(1, Number(count) || 1), Number(type) || 1);
  }

  game_over() {
    this.game_kill_game_time();
    this.state.party = [createRoleFromTemplate('\u65e0\u540d', '\u65e0\u540d')];
    this.state.friendList = [];
    this.state.departedFriends = {};
    this.state.started = false;
    sessionStorage.removeItem('wordgame-in-progress');
    return this.game_page(14444);
  }

  game_kill_game_time() {
    if (this.state.gameTimer) {
      clearInterval(this.state.gameTimer);
      this.state.gameTimer = null;
    }
    this.state.gameTimeLeft = 0;
    this.state.gameTimePage = 0;
    this.ui.updateGameTimer?.(null);
    return 1;
  }

  game_set_game_time(seconds, page) {
    this.game_kill_game_time();
    let left = Math.floor(Number(seconds) || 0);
    if (left <= 0) left = 1;
    const target = Number(page) || this.state.currentScene;
    this.state.gameTimeLeft = left;
    this.state.gameTimePage = target;
    this.ui.updateGameTimer?.(left);
    this.state.gameTimer = setInterval(() => {
      left -= 1;
      this.state.gameTimeLeft = left;
      this.ui.updateGameTimer?.(left);
      if (left <= 0) {
        this.game_kill_game_time();
        this.game_page(target);
      }
    }, 1000);
    return 1;
  }

  async game_delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
    return 1;
  }

  game_can_stop_chat(v) {
    this.state.chatLocked = Number(v) === 0;
    this.ui.setChatClosable?.(!this.state.chatLocked);
    return 1;
  }

  game_chat_cleans2() {
    if (this.state.chatLocked) {
      this.game_chat('\u672c\u6b21\u5bf9\u8bdd\u7981\u6b62\u4e2d\u9014\u9000\u51fa\uff0c\u8bf7\u5148\u7ed3\u675f\u5bf9\u8bdd\u3002');
      return 0;
    }
    return this.game_talk_stop();
  }

  game_talk_stop() {
    this.game_chat_cleans();
    this.dialogue.reset();
    this.talkName = '';
    this.state.chatLocked = false;
    this.ui.setChatClosable?.(true);
    return 1;
  }

  game_add_message(msg) {
    if (!Array.isArray(this.state.messages)) this.state.messages = [];
    this.state.messages.push(String(msg));
    this.persist();
    this.panels?.tasks?.renderIfOpen?.();
    return 1;
  }

  game_infobox(msg) {
    let text = String(msg ?? '');
    if (/string\s+game_/i.test(text) || /^game_\w+\(/i.test(text)) {
      text = evalTemplate(this, text.replace(/^string\s+/i, ''), this.createSceneContext());
    }
    if (this.ui.showInfobox) {
      this.ui.showInfobox(text);
    } else {
      this.ui.toast(text);
    }
    return 1;
  }

  game_role_sex_count(sex) {
    ensureParty(this.state);
    return this.state.party.filter((_, idx) => readValues(this.state, idx, STAT.sex) === Number(sex)).length;
  }

  game_role_all_mtl(p) {
    const restore = (idx) => {
      writeValues(this.state, idx, STAT.life, readValues(this.state, idx, STAT.gdsmz27));
      writeValues(this.state, idx, STAT.tili, readValues(this.state, idx, STAT.gdtl25));
      writeValues(this.state, idx, STAT.lingli, readValues(this.state, idx, STAT.gdll26));
    };
    if (Number(p) === 0) {
      for (let i = 0; i < getRoleCount(this.state); i += 1) restore(i);
    } else if (p <= getRoleCount(this.state)) {
      restore(Number(p) - 1);
    }
    syncPlayerFromRole(this.state, 0);
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_id_from_oldname(name) {
    const idx = findRoleIndex(this.state, name);
    return idx >= 0 ? idx + 1 : 0;
  }

  game_get_fm_1(sex) {
    for (let i = 0; i < getRoleCount(this.state); i += 1) {
      if (readValues(this.state, i, STAT.sex) === Number(sex)) return i + 1;
    }
    return 1;
  }

  game_sex_from_name(name) {
    const idx = findRoleIndex(this.state, name);
    if (idx < 0) return 0;
    return readValues(this.state, idx, STAT.sex);
  }

  game_read_factor() {
    return this.state.mazeFactor ?? 0;
  }

  game_write_factor(v) {
    const n = Number(v);
    this.state.mazeFactor = Number.isFinite(n) ? n : 0;
    this.persist();
    return 1;
  }

  game_weather(i) {
    this.state.weather = Number(i);
    this.persist();
    return 1;
  }

  game_chat_spk_add(_text) {
    return 1;
  }

  game_show_set() {
    if (this.ui.openSettings) this.ui.openSettings();
    else this.ui.toast('\u8bf7\u4ece\u5de5\u5177\u680f\u6253\u5f00\u6e38\u620f\u8bbe\u7f6e');
    return 1;
  }

  game_clear_money() {
    writeValues(this.state, 0, STAT.money, 0);
    syncPlayerFromRole(this.state, 0);
    this.ui.refreshStatus();
    this.persist();
    return 1;
  }

  game_not_rename(id) {
    const idx = (Number(id) || 1) - 1;
    const role = this.state.party[idx];
    if (!role) return 0;
    return role.name === role.oldName ? 1 : 0;
  }

  game_checkname_abc(name) {
    return /^[\u4e00-\u9fa5a-zA-Z0-9_]{1,8}$/.test(String(name || '')) ? 1 : 0;
  }

  game_time_exe(seconds, script) {
    if (this._timeExeTimers.size >= MAX_TIME_EXE_QUEUE) {
      this.ui.toast('\u5b9a\u65f6\u5668\u6570\u91cf\u8fc7\u591a\uff0c\u540c\u65f6\u8fd0\u884c\u7684\u4e0d\u80fd\u591a\u4e8e 512 \u4e2a');
      return 0;
    }
    const body = String(script || '').trim();
    if (!body) return 1;
    const delayMs = this.timeExeDelayMs(seconds);
    const timerId = setTimeout(() => {
      this._timeExeTimers.delete(timerId);
      this.runScript(body);
    }, delayMs);
    this._timeExeTimers.add(timerId);
    return 1;
  }

  game_integer_comp(a, op, b) {
    const left = Number(a);
    const right = Number(b);
    switch (String(op).trim()) {
      case '=': return left === right ? 1 : 0;
      case '>': return left > right ? 1 : 0;
      case '<': return left < right ? 1 : 0;
      case '<>': return left !== right ? 1 : 0;
      case '>=': return left >= right ? 1 : 0;
      case '<=': return left <= right ? 1 : 0;
      default: return 0;
    }
  }

  game_del_friend_byid(a, b) {
    const idx = Number(b) || Number(a);
    const role = this.state.party[idx];
    if (!role || idx <= 0) return 0;
    return this.game_del_friend(role.oldName, 1);
  }

  game_rename(oldName) {
    const next = window.prompt('\u8bf7\u8f93\u5165\u65b0\u59d3\u540d\uff1a', oldName || '');
    if (!next || !this.game_checkname_abc(next)) return 0;
    const idx = findRoleIndex(this.state, oldName);
    if (idx >= 0) this.state.party[idx].name = next;
    if (idx === 0) this.state.player.name = next;
    this.persist();
    return 1;
  }

  game_rename_byid(id, name) {
    const idx = Number(id) - 1;
    if (idx < 0 || !this.state.party[idx]) return 0;
    this.state.party[idx].name = name;
    if (idx === 0) this.state.player.name = name;
    this.persist();
    return 1;
  }

  game_get_accoutre(role, slot) {
    const idx = Number(role) - 1;
    const roleObj = this.state.party[idx];
    if (!roleObj) return 0;
    const s = Number(slot);
    return roleObj.equip?.[s] || 0;
  }

  game_chat(msg) {
    this.renderChatLine(msg, true);
  }

  renderChatLine(msg, linkify = true) {
    this.ui.showChat();
    const p = document.createElement('p');
    p.innerHTML = sanitizeChatForOffline(msg);
    if (linkify) {
      wireGameLinks(p, (href) => this.handleLink(href));
      p.querySelectorAll('[data-dialogue-opt]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = Number(el.getAttribute('data-dialogue-opt'));
          this.dialogue.selectOption(idx);
        });
      });
    }
    this.ui.chatBody.appendChild(p);
    this.ui.chatBody.scrollTop = this.ui.chatBody.scrollHeight;
  }

  game_chat_cleans() {
    this.ui.chatBody.innerHTML = '';
    this.ui.hideChat();
    this.dialogue.currentOptions = [];
  }

  async game_npc_talk(name) {
    this.talkName = name;
    this.ui.setChatClosable?.(!this.state.chatLocked);
    await this.dialogue.startTalk(name);
    this.persist();
    return 1;
  }

  game_write_name(name) {
    this.talkName = name;
    return 1;
  }

  game_reload_chatlist() {
    const name = this.talkName || this.dialogue.npcName;
    return this.sceneEngine.showScene(this.state.currentScene).then(() => {
      if (name) this.game_npc_talk(name);
    });
  }

  getPlayerDisplayName(text) {
    return this.state.player.name;
  }

  game_add_task(id) {
    const tid = String(id);
    if (this.game_not_res_event(id) === 1) {
      this.state.resEvents[tid] = 1;
      const prev = this.state.tasks[tid];
      if (!prev || prev.completed) {
        this.state.tasks[tid] = { active: true, completed: false };
      } else {
        this.state.tasks[tid].active = true;
      }
      this.ui.toast(`\u5df2\u63a5\u53d7\u4efb\u52a1 ${id}`);
      this.persist();
      this.game_reload_chatlist();
    }
    return 1;
  }

  game_comp_task(id) {
    if (this.game_not_res_event(id) === 1) return 0;

    this.game_del_res_event(id);
    const tid = String(id);
    this.state.tasks[tid] = { active: false, completed: true };

    const desc = getTaskDescription(id);
    if (!desc) {
      this.game_chat('\u8bfb\u53d6\u4efb\u52a1\u5931\u8d25\uff0c\u53ef\u80fd\u4efb\u52a1\u6587\u4ef6\u88ab\u5220\u9664\u3002');
      this.persist();
      return 0;
    }

    applyTaskRewards(this, desc);
    this.game_attribute_change(1, STAT.morality, 1);
    this.ui.toast(`\u4efb\u52a1 ${id} \u5df2\u5b8c\u6210`);
    this.persist();
    this.game_reload_chatlist();
    return 1;
  }

  game_spk_string(_text) {
    return 1;
  }

  game_save(mode = 0) {
    const m = Number(mode) || 0;
    if (m === 1) return this.game_save_quick();
    if (!this.state.started) return this.game_save_continue();
    if (!this.canSaveInCurrentScene()) return 0;
    this.panels.save?.open({ mode: 'save' });
    return 1;
  }

  game_save_panel() {
    if (!this.state.started) {
      this.panels.save?.open({ mode: 'load' });
      return 1;
    }
    if (!this.canSaveInCurrentScene()) return 0;
    this.panels.save?.open({ mode: 'both' });
    return 1;
  }

  game_save_count() {
    return countNonEmptySlots();
  }

  game_goods_change_n(name, delta) {
    const applied = changeGoodsByName(this.state, name, delta);
    if (applied > 0) learnSkillFromItem(this, name);
    if (applied > 0) {
      this.game_chat(`\u83b7\u5f97\u4e86 ${applied} \u4e2a${name}\u3002`);
    } else if (applied < 0) {
      this.game_chat(`\u4e22\u5931\u4e86 ${Math.abs(applied)} \u4e2a${name}\u3002`);
    } else if (Number(delta) > 0) {
      this.game_chat(`${name}\u5df2\u8fbe\u4e0a\u9650\uff08999\uff09\u3002`);
    }
    this.persist();
    return 1;
  }

  game_trade(id, flag) {
    if (this.panels.trade) this.panels.trade.open(id, flag);
    else this.ui.toast('\u4ea4\u6613\u7cfb\u7edf\u672a\u5c31\u7eea');
  }

  game_accouter1_wid() {
    if (!this.state.started) {
      this.ui.toast('\u6e38\u620f\u6ca1\u6709\u5f00\u59cb\uff0c\u8bf7\u5148\u5f00\u59cb\u5355\u673a\u6e38\u620f\u6216\u5b58\u53d6\u8fdb\u5ea6\u3002');
      return 0;
    }
    if (this.panels.player) this.panels.player.open();
    return 1;
  }

  game_check_money(v) {
    return this.state.player.money >= v;
  }

  game_question(text) {
    return window.confirm(text);
  }

  game_change_sex(name, sex) {
    const idx = findRoleIndex(this.state, name);
    if (idx >= 0) {
      if (name && name !== '\u65e0\u540d') this.state.party[idx].name = name;
      writeValues(this.state, idx, STAT.sex, sex === 1 ? 1 : 0);
      writeValues(this.state, idx, STAT.iconIndex, sex === 1 ? 0 : 1);
      syncPlayerFromRole(this.state, 0);
    } else if (name && name !== '\u65e0\u540d') {
      this.state.player.name = name;
      this.state.player.sex = sex === 1 ? 1 : 0;
    }
    this.persist();
    return 1;
  }

  game_pop(count) {
    return new Promise((resolve) => {
      this.wordPopup.openStudy(count, this.state, {
        onComplete: () => { this.persist(); resolve(true); },
        onFail: () => resolve(false),
      });
    });
  }

  game_pop_a(count) {
    const n = Math.max(1, Number(count) || 1);
    const onStudyComplete = () => {
      if (this.isMazeScene()) {
        this.state.pendingMazeWordTravelCost = n;
      }
      this.persist();
    };
    const onStudyFail = () => {
      this.state.pendingMazeWordTravelCost = 0;
      this.persist();
    };
    if (this.useMazePopDefer()) {
      this.state.deferredScript = '';
      this.wordPopup.openStudy(n, this.state, {
        onComplete: () => {
          onStudyComplete();
          this.runDeferredScript();
        },
        onFail: () => {
          this.state.deferredScript = '';
          onStudyFail();
        },
      });
      return POP_DEFER_CODE;
    }
    return this.game_pop(n).then((ok) => {
      if (ok) onStudyComplete();
      else onStudyFail();
      return ok;
    });
  }

  game_pop_fight(count, type) {
    return new Promise((resolve) => {
      this.wordPopup.openFight(count, type, this.state, {
        onComplete: (payload) => {
          const rewards = payload?.rewards || { exp: 0, money: 0, items: [] };
          if (rewards.exp) {
            writeValues(this.state, 0, STAT.experience, readValues(this.state, 0, STAT.experience) + rewards.exp);
          }
          if (rewards.money) {
            this.game_change_money(rewards.money);
          } else {
            syncPlayerFromRole(this.state, 0);
          }
          for (const item of rewards.items || []) {
            const gained = this.game_goods_change_n(item.name, item.count);
            if (gained > 0) {
              this.game_chat(`\u83b7\u5f97\u7269\u54c1\uff1a${item.name}\u00d7${gained}`);
            }
          }
          this.ui.refreshStatus();
          this.persist();
          resolve(true);
        },
        onFail: (reason) => {
          if (reason !== 'fight-lose') this.persist();
          resolve(false);
        },
      });
    });
  }
}

function splitScript(script) {
  const out = [];
  let rest = String(script || '').trim();
  while (rest.length) {
    rest = rest.trim();
    if (/^if\s+/i.test(rest)) {
      const block = extractIfEndBlock(rest);
      if (block) {
        out.push(block.text.trim());
        rest = block.rest.trim();
        if (rest.startsWith(';')) rest = rest.slice(1).trim();
        continue;
      }
    }
    const semi = findTopLevelSemicolon(rest);
    if (semi < 0) {
      if (rest.trim()) out.push(rest.trim());
      break;
    }
    out.push(rest.slice(0, semi).trim());
    rest = rest.slice(semi + 1);
  }
  return out.filter(Boolean);
}

function findTopLevelSemicolon(text) {
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) return i;
  }
  return -1;
}

function extractIfEndBlock(text) {
  const lower = text.toLowerCase();
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < text.length - 3; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth !== 0) continue;
    if (lower.startsWith(' end', i) && (i + 4 >= text.length || /\s/.test(text[i + 4]))) {
      return { text: text.slice(0, i + 4), rest: text.slice(i + 4) };
    }
  }
  return null;
}

function findElseInBody(body) {
  const lower = body.toLowerCase();
  let depth = 0;
  for (let i = 0; i < body.length - 3; i += 1) {
    const ch = body[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && lower.startsWith('else', i)) {
      const before = i === 0 ? '' : body[i - 1];
      const after = body[i + 4] || '';
      if ((i === 0 || /\s/.test(before)) && (!after || /\s/.test(after))) return i;
    }
  }
  return -1;
}
