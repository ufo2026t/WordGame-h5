import {
  exportSaveString,
  importSaveString,
  getSaveSummary,
  copyText,
  readClipboardText,
  applySaveToGame,
  loadSlotIntoGame,
} from './save-transfer.js';
import {
  listSaveSlots,
  persistSaveToSlot,
  deleteSlot,
  getActiveSlotId,
  setActiveSlotId,
  findFirstEmptySlot,
  countNonEmptySlots,
  loadSlot,
  buildSlotLabel,
} from './save-manager.js';

export class SavePanel {
  constructor(modalEl, app) {
    this.modal = modalEl;
    this.app = app;
    this.mode = 'both';
    this.selectedSlotId = null;
    this.textarea = modalEl.querySelector('#save-transfer-text');
    this.summaryEl = modalEl.querySelector('#save-summary');
    this.slotListEl = modalEl.querySelector('#save-slot-list');

    modalEl.querySelector('[data-close="save"]')?.addEventListener('click', () => this.close());
    modalEl.querySelector('#save-to-slot')?.addEventListener('click', () => this.saveToSelectedSlot());
    modalEl.querySelector('#save-load-slot')?.addEventListener('click', () => this.loadSelectedSlot());
    modalEl.querySelector('#save-delete-slot')?.addEventListener('click', () => this.deleteSelectedSlot());
    modalEl.querySelector('#save-export-clipboard')?.addEventListener('click', () => this.exportClipboard());
    modalEl.querySelector('#save-copy-code')?.addEventListener('click', () => this.copyCode());
    modalEl.querySelector('#save-paste-clipboard')?.addEventListener('click', () => this.pasteClipboard());
    modalEl.querySelector('#save-import')?.addEventListener('click', () => this.importFromTextarea());
  }

  open(options = {}) {
    this.mode = options.mode || 'both';
    if (!this.app.state.started && this.mode === 'save') {
      this.mode = 'load';
    }
    const active = getActiveSlotId();
    this.selectedSlotId = Number.isInteger(active) ? active : findFirstEmptySlot() ?? 0;
    this.textarea.value = '';
    this.refresh();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  refresh() {
    this.renderSlotList();
    this.refreshSummary();
  }

  renderSlotList() {
    if (!this.slotListEl) return;
    const slots = listSaveSlots();
    const active = getActiveSlotId();
    this.slotListEl.innerHTML = slots.map((slot) => {
      const selected = slot.slotId === this.selectedSlotId;
      const activeMark = slot.slotId === active ? ' \u25cf' : '';
      const title = slot.empty
        ? `\u7a7a\u69fd\u4f4d ${slot.slotId + 1}`
        : `${slot.playerName} \u00b7 Lv.${slot.level} \u00b7 \u573a\u666f ${slot.scene}${activeMark}`;
      const sub = slot.empty
        ? '\u70b9\u51fb\u9009\u4e2d\u540e\u53ef\u4fdd\u5b58'
        : `${escapeHtml(slot.label)} \u00b7 ${slot.savedAt ? new Date(slot.savedAt).toLocaleString() : ''}`;
      return `<button type="button" class="save-slot-item${selected ? ' selected' : ''}${slot.empty ? ' empty' : ''}" data-slot-id="${slot.slotId}">
        <span class="save-slot-title">${escapeHtml(title)}</span>
        <span class="save-slot-sub">${sub}</span>
      </button>`;
    }).join('');

    this.slotListEl.querySelectorAll('[data-slot-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedSlotId = Number(btn.dataset.slotId);
        this.renderSlotList();
        this.refreshSummary();
      });
    });
  }

  refreshSummary() {
    const slot = loadSlot(this.selectedSlotId);
    const s = slot || this.app.state;
    const summary = getSaveSummary(s);
    const modeHint = this.mode === 'load'
      ? '\u8bf7\u9009\u62e9\u69fd\u4f4d\u5e76\u70b9\u300c\u8bfb\u6863\u300d'
      : this.mode === 'save'
        ? '\u8bf7\u9009\u62e9\u69fd\u4f4d\u5e76\u70b9\u300c\u5b58\u6863\u300d'
        : '\u53ef\u5b58\u6863\u3001\u8bfb\u6863\u6216\u5bfc\u5165\u5bfc\u51fa';
    this.summaryEl.innerHTML = `
      <p class="panel-quote">${modeHint} \u00b7 \u5df2\u6709 ${countNonEmptySlots()} \u4e2a\u6863\u6848</p>
      <p><strong>\u69fd\u4f4d ${this.selectedSlotId + 1}</strong> \u00b7 ${slot ? `\u5df2\u5360\u7528` : `\u7a7a`}</p>
      <p><strong>${escapeHtml(summary.name)}</strong> \u00b7 Lv.${summary.level} \u00b7 \u91d1\u94b1 ${summary.money}</p>
      <p class="panel-quote">\u573a\u666f ${summary.scene} \u00b7 ${escapeHtml(summary.when)}</p>
    `;
  }

  getSceneName() {
    return this.app.api?.sceneEngine?.current?.name
      || document.getElementById('scene-title')?.textContent
      || '\u5b58\u6863';
  }

  saveToSelectedSlot() {
    if (!this.app.state.started) {
      this.app.ui.toast('\u8bf7\u5148\u5f00\u59cb\u6e38\u620f\u518d\u5b58\u6863');
      return;
    }
    if (this.app.api?.canSaveInCurrentScene?.() === false) {
      return;
    }
    const overwrite = loadSlot(this.selectedSlotId);
    if (overwrite && !window.confirm(`\u8986\u76d6\u69fd\u4f4d ${this.selectedSlotId + 1}\uff1a${overwrite.player?.name || ''}\uff1f`)) {
      return;
    }
    persistSaveToSlot(this.selectedSlotId, this.app.state, { sceneName: this.getSceneName() });
    setActiveSlotId(this.selectedSlotId);
    sessionStorage.setItem('wordgame-in-progress', '1');
    this.app.ui.toast(`\u5df2\u5b58\u5165\u69fd\u4f4d ${this.selectedSlotId + 1}`);
    this.refresh();
  }

  async loadSelectedSlot() {
    try {
      await loadSlotIntoGame(this.app, this.selectedSlotId);
      this.refresh();
      this.close();
      this.app.ui.toast(`\u5df2\u8bfb\u5165\u69fd\u4f4d ${this.selectedSlotId + 1}`);
    } catch (err) {
      this.app.ui.toast(err.message || '\u8bfb\u6863\u5931\u8d25');
    }
  }

  deleteSelectedSlot() {
    const slot = loadSlot(this.selectedSlotId);
    if (!slot) {
      this.app.ui.toast('\u8be5\u69fd\u4f4d\u662f\u7a7a\u7684');
      return;
    }
    if (!window.confirm(`\u786e\u5b9a\u5220\u9664\u69fd\u4f4d ${this.selectedSlotId + 1}\uff1f`)) return;
    deleteSlot(this.selectedSlotId);
    this.app.ui.toast('\u5df2\u5220\u9664\u6863\u6848');
    this.refresh();
  }

  async exportClipboard() {
    if (!this.app.state.started) {
      this.app.ui.toast('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6e38\u620f\u8fdb\u5ea6');
      return;
    }
    try {
      if (this.app.state.started) {
        persistSaveToSlot(this.selectedSlotId, this.app.state, { sceneName: this.getSceneName() });
      }
      const code = exportSaveString(this.app.state);
      this.textarea.value = code;
      await copyText(code);
      this.app.ui.toast('\u5b58\u6863\u5bfc\u51fa\u7801\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f');
      this.refresh();
    } catch (err) {
      this.app.ui.toast(`\u5bfc\u51fa\u5931\u8d25\uff1a${err.message}`);
    }
  }

  async copyCode() {
    const code = this.textarea.value.trim();
    if (!code) {
      this.app.ui.toast('\u8bf7\u5148\u751f\u6210\u6216\u7c98\u8d34\u5b58\u6863\u5185\u5bb9');
      return;
    }
    try {
      await copyText(code);
      this.app.ui.toast('\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f');
    } catch (err) {
      this.app.ui.toast(`\u590d\u5236\u5931\u8d25\uff1a${err.message}`);
    }
  }

  async pasteClipboard() {
    try {
      const text = await readClipboardText();
      this.textarea.value = text.trim();
      this.app.ui.toast('\u5df2\u4ece\u526a\u8d34\u677f\u7c98\u8d34');
    } catch (err) {
      this.app.ui.toast(err.message);
    }
  }

  async importFromTextarea() {
    const text = this.textarea.value.trim();
    if (!text) {
      this.app.ui.toast('\u8bf7\u5148\u7c98\u8d34\u6216\u8f93\u5165\u5bfc\u5165\u5b58\u6863\u5b57\u7b26\u4e32');
      return;
    }
    const overwrite = loadSlot(this.selectedSlotId);
    if (overwrite && !window.confirm(`\u5bfc\u5165\u5c06\u8986\u76d6\u69fd\u4f4d ${this.selectedSlotId + 1}\uff0c\u662f\u5426\u7ee7\u7eed\uff1f`)) return;

    try {
      const save = importSaveString(text);
      save.slotId = this.selectedSlotId;
      applySaveToGame(this.app, save, {
        slotId: this.selectedSlotId,
        sceneName: buildSlotLabel(save, '\u5bfc\u5165'),
      });
      await this.app.api.game_show_scene(save.currentScene || 10001);
      this.refresh();
      this.close();
      this.app.ui.toast('\u5bfc\u5165\u5e76\u8bfb\u6863\u6210\u529f');
    } catch (err) {
      this.app.ui.toast(`\u5bfc\u5165\u5931\u8d25\uff1a${err.message}`);
    }
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
