/** 15x15 Gomoku with mouse placement and simple AI. */

export const WUZIQI_LEVELS = [
  '\u767d\u75f4\u7ea7',
  '\u5165\u95e8\u7ea7',
  '\u4e2d\u7ea7',
  '\u9ad8\u7ea7',
  '\u5927\u5e08\u7ea7',
];

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

export class WuziqiGame {
  constructor(canvas, { level = 1, onWin, onLose, onStatus } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = Math.max(0, Math.min(4, Number(level) || 1));
    this.onWin = onWin;
    this.onLose = onLose;
    this.onStatus = onStatus;

    this.size = 15;
    this.cell = 32;
    this.pad = 24;
    this.board = [];
    this.finished = false;
    this.pendingCell = null;
    this.aiThinking = false;

    this._onClick = (e) => this.handleClick(e);
  }

  start() {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(EMPTY));
    this.finished = false;
    this.pendingCell = null;
    this.aiThinking = false;
    this.resize();
    this.canvas.addEventListener('click', this._onClick);
    this.setStatus(WUZIQI_LEVELS[this.level] + ' \u00b7 \u9ed1\u68cb\u5148\u624b\uff0c\u70b9\u51fb\u4ea4\u53c9\u70b9\u843d\u5b50\u3002');
    this.draw();
  }

  stop() {
    this.canvas.removeEventListener('click', this._onClick);
  }

  resize() {
    const w = this.pad * 2 + this.cell * (this.size - 1);
    this.canvas.width = w;
    this.canvas.height = w;
  }

  setStatus(msg) {
    this.onStatus?.(msg);
  }

  boardToPixel(row, col) {
    return {
      x: this.pad + col * this.cell,
      y: this.pad + row * this.cell,
    };
  }

  pixelToCell(x, y) {
    const col = Math.round((x - this.pad) / this.cell);
    const row = Math.round((y - this.pad) / this.cell);
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return null;
    const { x: cx, y: cy } = this.boardToPixel(row, col);
    if (Math.hypot(x - cx, y - cy) > this.cell * 0.45) return null;
    return { row, col };
  }

  handleClick(ev) {
    if (this.finished || this.aiThinking) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const cell = this.pixelToCell(x, y);
    if (!cell || this.board[cell.row][cell.col] !== EMPTY) return;
    this.pendingCell = cell;
    this.onPendingMove?.(cell);
  }

  confirmMove(cell) {
    if (!cell || this.finished) return false;
    if (this.board[cell.row][cell.col] !== EMPTY) return false;
    this.board[cell.row][cell.col] = BLACK;
    this.pendingCell = null;
    this.draw();
    if (this.checkWin(BLACK)) {
      this.finish(true);
      return true;
    }
    this.aiThinking = true;
    this.setStatus('\u7535\u8111\u601d\u8003\u4e2d\u2026');
    setTimeout(() => {
      this.aiMove();
      this.aiThinking = false;
      this.draw();
      if (this.checkWin(WHITE)) this.finish(false);
      else this.setStatus('\u8f6e\u5230\u60a8\u843d\u5b50\u3002');
    }, 400 + this.level * 200);
    return true;
  }

  cancelPending() {
    this.pendingCell = null;
    this.draw();
  }

  aiMove() {
    const move = this.findBestMove(WHITE, BLACK) || this.randomNearCenter();
    if (move) this.board[move.row][move.col] = WHITE;
  }

  randomNearCenter() {
    for (let i = 0; i < 80; i += 1) {
      const row = 7 + Math.floor(Math.random() * 5) - 2;
      const col = 7 + Math.floor(Math.random() * 5) - 2;
      if (this.board[row][col] === EMPTY) return { row, col };
    }
    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        if (this.board[r][c] === EMPTY) return { row: r, col: c };
      }
    }
    return null;
  }

  findBestMove(aiColor, humanColor) {
    let best = null;
    let bestScore = -Infinity;
    const depth = this.level >= 3 ? 2 : 1;
    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        if (this.board[r][c] !== EMPTY) continue;
        if (!this.hasNeighbor(r, c, 2)) continue;
        this.board[r][c] = aiColor;
        let score = this.evaluateBoard(aiColor, humanColor);
        if (depth > 1) {
          const reply = this.findHumanReply(humanColor, aiColor, r, c);
          if (reply) {
            this.board[reply.row][reply.col] = humanColor;
            score -= this.evaluateBoard(humanColor, aiColor) * 0.85;
            this.board[reply.row][reply.col] = EMPTY;
          }
        }
        this.board[r][c] = EMPTY;
        if (score > bestScore) {
          bestScore = score;
          best = { row: r, col: c };
        }
      }
    }
    return best;
  }

  findHumanReply(humanColor, aiColor, skipR, skipC) {
    let best = null;
    let bestScore = -Infinity;
    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        if (this.board[r][c] !== EMPTY) continue;
        if (r === skipR && c === skipC) continue;
        if (!this.hasNeighbor(r, c, 2)) continue;
        this.board[r][c] = humanColor;
        const score = this.evaluateBoard(humanColor, aiColor);
        this.board[r][c] = EMPTY;
        if (score > bestScore) {
          bestScore = score;
          best = { row: r, col: c };
        }
      }
    }
    return best;
  }

  hasNeighbor(row, col, dist) {
    for (let r = row - dist; r <= row + dist; r += 1) {
      for (let c = col - dist; c <= col + dist; c += 1) {
        if (r < 0 || c < 0 || r >= this.size || c >= this.size) continue;
        if (this.board[r][c] !== EMPTY) return true;
      }
    }
    return row >= 6 && row <= 8 && col >= 6 && col <= 8;
  }

  evaluateBoard(me, opp) {
    let score = 0;
    score += this.lineScore(me, 5) * 100000;
    score += this.lineScore(opp, 4) * 8000;
    score += this.lineScore(me, 4) * 5000;
    score += this.lineScore(opp, 3) * 600;
    score += this.lineScore(me, 3) * 400;
    score += this.lineScore(opp, 2) * 40;
    score += this.lineScore(me, 2) * 25;
    return score;
  }

  lineScore(color, need) {
    let total = 0;
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        if (this.board[r][c] !== color) continue;
        for (const [dr, dc] of dirs) {
          total += this.countLine(r, c, dr, dc, color, need);
        }
      }
    }
    return total;
  }

  countLine(row, col, dr, dc, color, need) {
    let count = 1;
    let open = 0;
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && c >= 0 && r < this.size && c < this.size && this.board[r][c] === color) {
      count += 1;
      r += dr;
      c += dc;
    }
    if (r >= 0 && c >= 0 && r < this.size && c < this.size && this.board[r][c] === EMPTY) open += 1;
    r = row - dr;
    c = col - dc;
    while (r >= 0 && c >= 0 && r < this.size && c < this.size && this.board[r][c] === color) {
      count += 1;
      r -= dr;
      c -= dc;
    }
    if (r >= 0 && c >= 0 && r < this.size && c < this.size && this.board[r][c] === EMPTY) open += 1;
    if (count >= need) return open + 1;
    return 0;
  }

  checkWin(color) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        if (this.board[r][c] !== color) continue;
        for (const [dr, dc] of dirs) {
          let n = 1;
          for (let k = 1; k < 5; k += 1) {
            const nr = r + dr * k;
            const nc = c + dc * k;
            if (nr < 0 || nc < 0 || nr >= this.size || nc >= this.size) break;
            if (this.board[nr][nc] !== color) break;
            n += 1;
          }
          if (n >= 5) return true;
        }
      }
    }
    return false;
  }

  finish(won) {
    this.finished = true;
    if (won) {
      this.setStatus('\u606d\u559c\u80dc\u5229\uff01\u8fde\u6210\u4e94\u5b50\u3002');
      this.onWin?.();
    } else {
      this.setStatus('\u60a8\u8f93\u4e86\uff0c\u7535\u8111\u8fde\u6210\u4e94\u5b50\u3002');
      this.onLose?.();
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = '#4a3728';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.size; i += 1) {
      const p = this.pad + i * this.cell;
      ctx.beginPath();
      ctx.moveTo(this.pad, p);
      ctx.lineTo(w - this.pad, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, this.pad);
      ctx.lineTo(p, w - this.pad);
      ctx.stroke();
    }

    const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    ctx.fillStyle = '#4a3728';
    for (const [r, c] of stars) {
      const { x, y } = this.boardToPixel(r, c);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let r = 0; r < this.size; r += 1) {
      for (let c = 0; c < this.size; c += 1) {
        const v = this.board[r][c];
        if (!v) continue;
        const { x, y } = this.boardToPixel(r, c);
        const grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, this.cell * 0.42);
        if (v === BLACK) {
          grad.addColorStop(0, '#666');
          grad.addColorStop(1, '#111');
        } else {
          grad.addColorStop(0, '#fff');
          grad.addColorStop(1, '#ccc');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, this.cell * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.pendingCell) {
      const { x, y } = this.boardToPixel(this.pendingCell.row, this.pendingCell.col);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, this.cell * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
