import { loadSettings, saveSettings, DEFAULT_SETTINGS, REP_OPTIONS, PAGE_THEME_OPTIONS, loadSetTxtDefaults, applyPageTheme, normalizePageTheme } from './settings.js';
import { createDefaultSave, persistSave, loadSlot, getActiveSlotId } from './save-manager.js';
import { applySaveToGame } from './save-transfer.js';
import { WordEngine, WORD_COLOR_OPTIONS } from './word-engine.js';
import { loadWordAffixes } from './word-affix.js';
import { SceneEngine, GameAPI } from './game-api.js';
import { WordPopup } from './word-popup.js';
import { loadGpicEffects } from './gpic-renderer.js';
import { loadGameData } from './goods-data.js';
import { loadGameConfig } from './game-config.js';
import { ensureParty, syncPlayerFromRole } from './game-runtime.js';
import { PlayerPanel } from './player-panel.js';
import { TasksPanel } from './tasks-panel.js';
import { TradePanel } from './trade-panel.js';
import { CraftPanel } from './craft-panel.js';
import { SavePanel } from './save-panel.js';
import { MinigamePanel } from './minigame-panel.js';

const IN_PROGRESS_KEY = 'wordgame-in-progress';

export class App {
  constructor() {
    this.settings = loadSettings();
    applyPageTheme(this.settings.pageTheme);
    this.state = createDefaultSave();
    this.wordEngine = new WordEngine();

    this.ui = this.createUi();
    this.sceneEngine = new SceneEngine(
      document.getElementById('scene-host'),
      document.getElementById('chat-body'),
      null,
    );
    this.wordPopup = new WordPopup(document.getElementById('word-modal'), {
      wordEngine: this.wordEngine,
      settings: this.settings,
    });
    this.minigame = new MinigamePanel(document.getElementById('minigame-modal'), {
      wordEngine: this.wordEngine,
      settings: this.settings,
    });

    this.panels = {
      player: new PlayerPanel(document.getElementById('player-modal'), null),
      tasks: new TasksPanel(document.getElementById('tasks-modal'), null),
      trade: new TradePanel(document.getElementById('trade-modal'), null),
      craft: new CraftPanel(document.getElementById('craft-modal'), null),
      save: new SavePanel(document.getElementById('save-modal'), this),
    };

    this.api = new GameAPI({
      state: this.state,
      settings: this.settings,
      sceneEngine: this.sceneEngine,
      wordPopup: this.wordPopup,
      minigame: this.minigame,
      ui: this.ui,
      persist: () => {
        if (!this.state.started) return;
        const sceneName = this.api?.sceneEngine?.current?.name;
        persistSave(this.state, { sceneName });
        sessionStorage.setItem(IN_PROGRESS_KEY, '1');
      },
      panels: this.panels,
    });

    Object.values(this.panels).forEach((panel) => { panel.api = this.api; });
    this.sceneEngine.api = this.api;
    this.wordPopup.setApi(this.api);
    this.minigame.setApi(this.api);

    this.bindToolbar();
    this.bindSettingsModal();
    this.populateRepSelect();
    this.populateWordSettingSelects();
  }

  populateWordSettingSelects() {
    const theme = document.getElementById('set-page-theme');
    if (theme) {
      theme.innerHTML = PAGE_THEME_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    }
    const color = document.getElementById('set-word-color');
    if (color) {
      color.innerHTML = WORD_COLOR_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    }
  }

  populateRepSelect() {
    const sel = document.getElementById('set-rep-index');
    if (!sel) return;
    sel.innerHTML = REP_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  }

  createUi() {
    const chatLayer = document.getElementById('chat-layer');
    const chatBody = document.getElementById('chat-body');
    const infoboxModal = document.getElementById('infobox-modal');
    const infoboxBody = document.getElementById('infobox-body');
    const infoboxOk = document.getElementById('infobox-ok');
    let infoboxResolver = null;

    infoboxOk?.addEventListener('click', () => {
      infoboxModal?.classList.add('hidden');
      if (infoboxResolver) {
        infoboxResolver();
        infoboxResolver = null;
      }
    });

    const gameTimeEl = document.getElementById('game-time-countdown');

    return {
      setSceneTitle: (t) => { document.getElementById('scene-title').textContent = t; },
      refreshStatus: () => {
        document.getElementById('status-money').textContent = `\u91d1\u94b1: ${this.state.player.money}`;
        document.getElementById('status-hp').textContent = `\u751f\u547d: ${this.state.player.hp}/${this.state.player.maxHp}`;
      },
      updateGameTimer: (seconds) => {
        if (!gameTimeEl) return;
        if (seconds == null || seconds <= 0) {
          gameTimeEl.textContent = '';
          gameTimeEl.classList.add('hidden');
          return;
        }
        gameTimeEl.textContent = `\u5269\u4f59\uff1a${seconds}\u79d2`;
        gameTimeEl.classList.remove('hidden');
      },
      showChat: () => {
        chatLayer.classList.remove('hidden');
        const closeBtn = document.getElementById('chat-close');
        if (closeBtn) closeBtn.disabled = !!this.state.chatLocked;
      },
      hideChat: () => chatLayer.classList.add('hidden'),
      setChatClosable: (ok) => {
        const closeBtn = document.getElementById('chat-close');
        if (closeBtn) closeBtn.disabled = !ok;
      },
      chatBody,
      toast: (msg) => {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
      },
      showInfobox: (msg) => new Promise((resolve) => {
        if (!infoboxModal || !infoboxBody) {
          resolve();
          return;
        }
        infoboxBody.textContent = String(msg ?? '');
        infoboxModal.classList.remove('hidden');
        infoboxResolver = resolve;
      }),
      openSettings: () => this.openSettings(),
    };
  }

  async init() {
    await loadGameData();
    await loadGameConfig();
    if (!localStorage.getItem('wordgame-settings')) {
      const fromSet = await loadSetTxtDefaults();
      if (fromSet) {
        this.settings = { ...this.settings, ...fromSet };
        saveSettings(this.settings);
      }
    }
    ensureParty(this.state);
    syncPlayerFromRole(this.state, 0);
    await loadWordAffixes();
    this.wordEngine.resetErrorList(this.settings);
    await this.loadLibraries();
    this.ui.refreshStatus();
    this.wordPopup.updateSettings(this.settings);
    this.minigame.updateSettings(this.settings);

    const active = getActiveSlotId();
    const resume = sessionStorage.getItem(IN_PROGRESS_KEY) === '1';
    const slotSave = Number.isInteger(active) ? loadSlot(active) : null;
    if (resume && slotSave?.started) {
      applySaveToGame(this, slotSave, { slotId: active, persist: false });
      sessionStorage.setItem(IN_PROGRESS_KEY, '1');
      await this.api.game_show_scene(this.state.currentScene || 10001);
    } else {
      sessionStorage.removeItem(IN_PROGRESS_KEY);
      await this.api.game_show_scene(10000);
    }
  }

  async loadLibraries() {
    const select = document.getElementById('word-lib');
    let libs = [];
    try {
      const res = await fetch('data/lib/manifest.json');
      if (res.ok) libs = await res.json();
    } catch {
      libs = [];
    }
    if (!libs.length) {
      libs = [DEFAULT_SETTINGS.defaultLib];
    }
    select.innerHTML = libs.map((l) => `<option value="${l}">${l.replace('.ini', '')}</option>`).join('');
    select.value = this.settings.defaultLib || DEFAULT_SETTINGS.defaultLib;
    select.addEventListener('change', async () => {
      this.settings.defaultLib = select.value;
      saveSettings(this.settings);
      await this.wordEngine.loadLib(`data/lib/${select.value}`);
      this.wordEngine.resetErrorList(this.settings);
      this.ui.toast(`\u5df2\u52a0\u8f7d\u8bcd\u5e93\uff1a${select.value}`);
    });
    await this.wordEngine.loadLib(`data/lib/${select.value}`);
  }

  bindToolbar() {
    document.querySelector('[data-action="save"]').addEventListener('click', () => this.panels.save.open());
    document.querySelector('[data-action="settings"]').addEventListener('click', () => this.openSettings());
    document.querySelector('[data-action="player"]').addEventListener('click', () => this.panels.player.open());
    document.querySelector('[data-action="craft"]').addEventListener('click', () => this.panels.craft.open());
    document.querySelector('[data-action="tasks"]').addEventListener('click', () => this.panels.tasks.open());
    document.getElementById('chat-close')?.addEventListener('click', () => this.api.game_chat_cleans2());
  }

  openSettings() {
    const modal = document.getElementById('settings-modal');
    document.getElementById('set-en-color').value = this.settings.enColor;
    document.getElementById('set-cn-color').value = this.settings.cnColor;
    document.getElementById('set-en-size').value = this.settings.enSize;
    document.getElementById('set-cn-size').value = this.settings.cnSize;
    document.getElementById('set-choice-bg').value = this.settings.choiceCnBg || this.settings.choiceEnBg || '#ffffff';
    document.getElementById('set-delay').value = Math.max(1000, this.settings.delayShowWord);
    document.getElementById('set-sequential').checked = this.settings.sequential;
    document.getElementById('set-abhs').checked = this.settings.abhs;
    document.getElementById('set-rep-index').value = String(this.settings.repIndex ?? 3);
    document.getElementById('set-reverse-learn').checked = !!this.settings.reverseLearn;
    document.getElementById('set-part-size').value = this.settings.partSize ?? 50;
    document.getElementById('set-page-theme').value = normalizePageTheme(this.settings.pageTheme);
    document.getElementById('set-word-color').value = String(this.settings.wordColorMode ?? 0);
    document.getElementById('set-prefix-color').value = this.settings.prefixColor || '#6495ed';
    document.getElementById('set-suffix-color').value = this.settings.suffixColor || '#ee82ee';
    modal.classList.remove('hidden');
  }

  bindSettingsModal() {
    document.querySelector('[data-close="settings"]').addEventListener('click', () => {
      applyPageTheme(this.settings.pageTheme);
      document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('set-page-theme')?.addEventListener('change', (ev) => {
      applyPageTheme(ev.target.value);
    });
    document.getElementById('save-settings').addEventListener('click', () => {
      this.settings.enColor = document.getElementById('set-en-color').value;
      this.settings.cnColor = document.getElementById('set-cn-color').value;
      this.settings.enSize = Number(document.getElementById('set-en-size').value);
      this.settings.cnSize = Number(document.getElementById('set-cn-size').value);
      this.settings.delayShowWord = Math.max(1000, Number(document.getElementById('set-delay').value));
      this.settings.sequential = document.getElementById('set-sequential').checked;
      this.settings.abhs = document.getElementById('set-abhs').checked;
      this.settings.repIndex = Number(document.getElementById('set-rep-index').value);
      this.settings.reverseLearn = document.getElementById('set-reverse-learn').checked;
      const choiceBg = document.getElementById('set-choice-bg').value;
      this.settings.choiceEnBg = choiceBg;
      this.settings.choiceCnBg = choiceBg;
      this.settings.partSize = Number(document.getElementById('set-part-size').value);
      this.settings.pageTheme = normalizePageTheme(document.getElementById('set-page-theme').value);
      applyPageTheme(this.settings.pageTheme);
      this.settings.wordColorMode = Number(document.getElementById('set-word-color').value);
      this.settings.prefixColor = document.getElementById('set-prefix-color').value;
      this.settings.suffixColor = document.getElementById('set-suffix-color').value;
      saveSettings(this.settings);
      this.wordEngine.resetErrorList(this.settings);
      this.wordPopup.updateSettings(this.settings);
    this.minigame.updateSettings(this.settings);
      document.getElementById('settings-modal').classList.add('hidden');
      this.ui.toast('\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
    });
  }
}

export async function boot() {
  const splash = document.getElementById('splash');
  const appRoot = document.getElementById('app');
  const info = document.getElementById('splash-info');

  try {
    info.textContent = '\u52a0\u8f7d\u8bcd\u5e93\u4e0e\u573a\u666f\u6570\u636e\u2026';
    await loadGpicEffects();
    const app = new App();
    await app.init();
    splash.classList.add('hidden');
    appRoot.classList.remove('hidden');
  } catch (err) {
    info.textContent = `\u542f\u52a8\u5931\u8d25\uff1a${err.message}`;
    console.error(err);
  }
}
