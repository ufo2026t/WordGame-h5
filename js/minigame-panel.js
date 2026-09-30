import { BubbleShooterGame } from './bubble-shooter.js';
import { WuziqiGame, WUZIQI_LEVELS } from './wuziqi.js';
import { writeValues, readValues, STAT, syncPlayerFromRole, gameBaseRandomZero } from './game-runtime.js';

export class MinigamePanel {
  constructor(root, { wordEngine, settings, api = null }) {
    this.root = root;
    this.wordEngine = wordEngine;
    this.settings = settings;
    this.api = api;

    this.modal = root;
    this.titleEl = root.querySelector('#minigame-title');
    this.statusEl = root.querySelector('#minigame-status');
    this.canvas = root.querySelector('#minigame-canvas');
    this.gameLayer = root.querySelector('#minigame-game-layer');
    this.wordLayer = root.querySelector('#minigame-word-layer');
    this.promptEl = root.querySelector('#minigame-word-prompt');
    this.choicesEl = root.querySelector('#minigame-word-choices');
    this.feedbackEl = root.querySelector('#minigame-word-feedback');

    this.mode = null;
    this.game = null;
    this.saveRef = null;
    this.resolveSession = null;
    this.currentQuestion = null;
    this.pendingWuziCell = null;

    root.querySelector('[data-close="minigame"]')?.addEventListener('click', () => this.cancelSession());
  }

  setApi(api) {
    this.api = api;
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  openBubble(bubbleBudget, save) {
    return this.openSession('bubble', bubbleBudget, save);
  }

  openWuziqi(level, save) {
    return this.openSession('wuziqi', level, save);
  }

  openSession(mode, param, save) {
    if (this.resolveSession) this.finishSession(false);
    this.mode = mode;
    this.saveRef = save;
    this.param = param;
    this.modal.classList.remove('hidden');
    this.modal.setAttribute('aria-hidden', 'false');
    this.gameLayer.classList.add('hidden');
    this.wordLayer.classList.remove('hidden');

    if (mode === 'bubble') {
      this.titleEl.textContent = '\u6ce1\u6ce1\u9f99 \u00b7 ' + param;
    } else {
      const lv = Math.max(0, Math.min(4, Number(param) || 1));
      this.titleEl.textContent = '\u4e94\u5b50\u68cb \u00b7 ' + WUZIQI_LEVELS[lv];
    }

    this.setStatus('\u7b54\u5bf9\u5355\u8bcd\u540e\u5f00\u59cb\u6e38\u620f\u3002');
    return new Promise((resolve) => {
      this.resolveSession = resolve;
      this.showWordQuestion(() => this.startGame(), {
        retryOnWrong: true,
        invalidMessage: '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u64cd\u4f5c\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u7b54\u9898\u540e\u518d\u5f00\u59cb\u3002',
      });
    });
  }

  startGame() {
    this.wordLayer.classList.add('hidden');
    this.gameLayer.classList.remove('hidden');
    this.stopGame();

    if (this.mode === 'bubble') {
      this.game = new BubbleShooterGame(this.canvas, {
        bubbleBudget: Number(this.param) || 60,
        onWin: () => this.handleBubbleWin(),
        onLose: () => this.finishSession(false),
        onStatus: (msg) => this.setStatus(msg),
      });
      this.game.grantShots(2);
      this.game.start();
      this.watchBubbleWords();
    } else {
      this.game = new WuziqiGame(this.canvas, {
        level: Number(this.param) || 1,
        onWin: () => this.handleWuziWin(),
        onLose: () => this.finishSession(false),
        onStatus: (msg) => this.setStatus(msg),
      });
      this.game.onPendingMove = (cell) => {
        this.pendingWuziCell = cell;
        this.wordLayer.classList.remove('hidden');
        this.showWordQuestion(() => {
          if (this.pendingWuziCell && this.game?.confirmMove(this.pendingWuziCell)) {
            this.pendingWuziCell = null;
            this.wordLayer.classList.add('hidden');
          } else {
            this.game?.cancelPending?.();
            this.pendingWuziCell = null;
            this.wordLayer.classList.add('hidden');
          }
        }, {
          onInvalid: () => {
            this.game?.cancelPending?.();
            this.pendingWuziCell = null;
            this.wordLayer.classList.add('hidden');
            this.setStatus('\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u843d\u5b50\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u9009\u70b9\u3002');
          },
          invalidMessage: '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u843d\u5b50\u65e0\u6548\u3002',
        });
      };
      this.game.start();
    }
  }

  watchBubbleWords() {
    const tick = () => {
      if (!this.game?.running || this.game.finished) return;
      if (this.game.needsWord()) {
        this.game.running = false;
        this.wordLayer.classList.remove('hidden');
        this.showWordQuestion(
          () => {
            this.game.grantShots(2);
            this.game.running = true;
            this.wordLayer.classList.add('hidden');
            this.gameLayer.style.pointerEvents = '';
            this.game.loop();
            tick();
          },
          {
            retryOnWrong: true,
            invalidMessage: '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u53d1\u5c04\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u7b54\u9898\u540e\u518d\u7ee7\u7eed\u3002',
          },
        );
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  handleBubbleWin() {
    if (Math.random() < 0.5) {
      const money = gameBaseRandomZero(9009) + 2000;
      this.api?.game_change_money?.(money);
      this.api?.ui?.toast?.('\u6316\u6398\u6210\u529f\uff0c\u5956\u52b1\u91d1\u94b1 ' + money);
    } else {
      const exp = gameBaseRandomZero(4009) + 500;
      writeValues(this.saveRef, 0, STAT.experience, readValues(this.saveRef, 0, STAT.experience) + exp);
      syncPlayerFromRole(this.saveRef, 0);
      this.api?.ui?.toast?.('\u6316\u6398\u6210\u529f\uff0c\u5168\u4f53\u52a0\u7ecf\u9a8c ' + exp);
    }
    this.api?.ui?.refreshStatus?.();
    this.api?.persist?.();
    setTimeout(() => this.finishSession(true), 1200);
  }

  handleWuziWin() {
    const exp = gameBaseRandomZero(4009) + 500;
    writeValues(this.saveRef, 0, STAT.experience, readValues(this.saveRef, 0, STAT.experience) + exp);
    syncPlayerFromRole(this.saveRef, 0);
    this.api?.ui?.refreshStatus?.();
    this.api?.ui?.toast?.('\u80dc\u5229\uff01\u5168\u4f53\u52a0\u7ecf\u9a8c ' + exp);
    this.api?.persist?.();
    setTimeout(() => this.finishSession(true), 1200);
  }

  showWordQuestion(onCorrect, options = {}) {
    this._wordOptions = {
      retryOnWrong: false,
      invalidMessage: '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u64cd\u4f5c\u65e0\u6548\u3002',
      onInvalid: null,
      ...options,
    };
    this.gameLayer.style.pointerEvents = 'none';
    const q = this.wordEngine.pick(this.settings, this.saveRef.wordProgress, this.saveRef);
    if (!q) {
      this.feedbackEl.textContent = '\u8bcd\u5e93\u4e3a\u7a7a\u3002';
      this.gameLayer.style.pointerEvents = '';
      onCorrect();
      return;
    }
    this.currentQuestion = q;
    this.feedbackEl.textContent = '';
    this.promptEl.textContent = q.prompt;
    this.promptEl.style.color = q.reverse ? this.settings.cnColor : this.settings.enColor;
    this.promptEl.style.fontSize = (q.reverse ? this.settings.cnSize : this.settings.enSize) + 'px';

    this.choicesEl.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'minigame-choice';
      btn.style.fontSize = (q.reverse ? this.settings.enSize : this.settings.cnSize) + 'px';
      btn.style.color = q.reverse ? this.settings.enColor : this.settings.cnColor;
      btn.textContent = (idx + 1) + '. ' + choice;
      btn.addEventListener('click', () => this.submitWord(choice, onCorrect));
      this.choicesEl.appendChild(btn);
    });
  }

  submitWord(choice, onCorrect) {
    const q = this.currentQuestion;
    const opts = this._wordOptions || {};
    const correct = choice === q.answer;
    this.wordEngine.recordResult(q.entry, correct, this.saveRef.wordProgress, this.settings, q.wordIndex, this.saveRef);
    this.saveRef.wordStats[correct ? 'correct' : 'wrong'] += 1;
    this.api?.persist?.();

    [...this.choicesEl.querySelectorAll('button')].forEach((btn) => {
      btn.disabled = true;
      if (btn.textContent.includes(q.answer)) btn.classList.add('correct');
      if (btn.textContent.includes(choice) && !correct) btn.classList.add('wrong');
    });

    if (correct) {
      this.feedbackEl.textContent = '\u7b54\u5bf9\u4e86\uff01';
      setTimeout(() => {
        this.gameLayer.style.pointerEvents = '';
        onCorrect?.();
      }, 500);
    } else {
      this.feedbackEl.textContent = opts.invalidMessage;
      setTimeout(() => {
        if (opts.retryOnWrong) {
          this.setStatus(opts.invalidMessage);
          this.showWordQuestion(onCorrect, opts);
          return;
        }
        this.gameLayer.style.pointerEvents = '';
        opts.onInvalid?.();
      }, 900);
    }
  }

  setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  cancelSession() {
    if (this.mode === 'bubble' && this.game?.running && !this.game.finished) {
      if (!window.confirm('\u786e\u5b9a\u9000\u51fa\u6ce1\u6ce1\u9f99\u5417\uff1f')) return;
    }
    if (this.mode === 'wuziqi' && this.game && !this.game.finished) {
      if (!window.confirm('\u786e\u5b9a\u9000\u51fa\u4e94\u5b50\u68cb\u5417\uff1f')) return;
    }
    this.finishSession(false);
  }

  stopGame() {
    this.game?.stop?.();
    this.game = null;
  }

  finishSession(won) {
    this.stopGame();
    this.pendingWuziCell = null;
    this.modal.classList.add('hidden');
    this.modal.setAttribute('aria-hidden', 'true');
    this.wordLayer.classList.add('hidden');
    this.gameLayer.classList.add('hidden');
    const resolve = this.resolveSession;
    this.resolveSession = null;
    this.mode = null;
    resolve?.(!!won);
  }
}
