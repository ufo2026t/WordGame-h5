/** Staggered bubble-shooter grid (mouse aim + click to fire). */

export const BUBBLE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c',
];

export class BubbleShooterGame {
  constructor(canvas, { bubbleBudget = 60, onWin, onLose, onStatus } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bubbleBudget = bubbleBudget;
    this.onWin = onWin;
    this.onLose = onLose;
    this.onStatus = onStatus;

    this.cols = 11;
    this.rows = 14;
    this.radius = 14;
    this.grid = [];
    this.angle = -Math.PI / 2;
    this.currentColor = 0;
    this.nextColor = 0;
    this.shotsLeft = 2;
    this.moving = null;
    this.running = false;
    this.finished = false;

    this.shooterX = 0;
    this.shooterY = 0;
    this.dangerRow = 11;

    this._onMove = (e) => this.handleMove(e);
    this._onClick = (e) => this.handleClick(e);
  }

  cellCenter(row, col) {
    const dx = this.radius * 2;
    const dy = this.radius * 1.732;
    const offset = (row % 2) * this.radius;
    return {
      x: this.radius * 2 + col * dx + offset,
      y: this.radius * 2 + row * dy,
    };
  }

  initGrid() {
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    let placed = 0;
    const target = Math.min(this.bubbleBudget, this.cols * 6);
    while (placed < target) {
      const r = Math.floor(Math.random() * 6);
      const c = Math.floor(Math.random() * this.cols);
      if (this.grid[r][c] === 0 && Math.random() < 0.55) {
        this.grid[r][c] = 1 + Math.floor(Math.random() * BUBBLE_COLORS.length);
        placed += 1;
      }
    }
    this.currentColor = Math.floor(Math.random() * BUBBLE_COLORS.length);
    this.nextColor = Math.floor(Math.random() * BUBBLE_COLORS.length);
  }

  start() {
    this.initGrid();
    this.finished = false;
    this.running = true;
    this.resize();
    this.canvas.addEventListener('mousemove', this._onMove);
    this.canvas.addEventListener('click', this._onClick);
    this.setStatus('\u5de6\u53f3\u79fb\u52a8\u9f20\u6807\u8c03\u6574\u89d2\u5ea6\uff0c\u70b9\u51fb\u53d1\u5c04\u3002\u5269\u4f59\u53d1\u5c04\u6b21\u6570\uff1a' + this.shotsLeft);
    this.loop();
  }

  stop() {
    this.running = false;
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('click', this._onClick);
  }

  grantShots(n = 2) {
    this.shotsLeft = n;
    this.setStatus('\u7ee7\u7eed\u6316\u6398\uff01\u5269\u4f59\u53d1\u5c04\u6b21\u6570\uff1a' + this.shotsLeft);
  }

  needsWord() {
    return this.shotsLeft <= 0 && !this.finished;
  }

  resize() {
    const dx = this.radius * 2;
    const dy = this.radius * 1.732;
    this.canvas.width = this.radius * 4 + (this.cols - 1) * dx + this.radius;
    this.canvas.height = this.radius * 4 + (this.rows - 1) * dy + this.radius * 4;
    this.shooterX = this.canvas.width / 2;
    this.shooterY = this.canvas.height - this.radius * 2;
  }

  setStatus(msg) {
    this.onStatus?.(msg);
  }

  handleMove(ev) {
    if (!this.running || this.moving || this.finished || this.shotsLeft <= 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let a = Math.atan2(y - this.shooterY, x - this.shooterX);
    a = Math.max(-2.45, Math.min(-0.7, a));
    this.angle = a;
  }

  handleClick(ev) {
    if (!this.running || this.moving || this.finished || this.shotsLeft <= 0) return;
    ev.preventDefault();
    this.fire();
  }

  fire() {
    this.shotsLeft -= 1;
    const speed = 9;
    this.moving = {
      x: this.shooterX,
      y: this.shooterY,
      vx: Math.cos(this.angle) * speed,
      vy: Math.sin(this.angle) * speed,
      color: this.currentColor + 1,
    };
  }

  loop() {
    if (!this.running) return;
    this.update();
    this.draw();
    requestAnimationFrame(() => this.loop());
  }

  update() {
    if (!this.moving) return;
    const m = this.moving;
    m.x += m.vx;
    m.y += m.vy;

    if (m.x <= this.radius || m.x >= this.canvas.width - this.radius) {
      m.vx *= -1;
      m.x = Math.max(this.radius, Math.min(this.canvas.width - this.radius, m.x));
    }
    if (m.y <= this.radius) {
      this.attachBubble(m.x, m.y, m.color);
      return;
    }

    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const cell = this.grid[r][c];
        if (!cell) continue;
        const { x, y } = this.cellCenter(r, c);
        const dist = Math.hypot(m.x - x, m.y - y);
        if (dist < this.radius * 1.85) {
          this.attachBubble(m.x, m.y, m.color);
          return;
        }
      }
    }
  }

  attachBubble(x, y, color) {
    const cell = this.findNearestCell(x, y);
    if (!cell) {
      this.moving = null;
      return;
    }
    const { row, col } = cell;
    if (this.grid[row][col] !== 0) {
      this.moving = null;
      return;
    }
    this.grid[row][col] = color;
    this.moving = null;

    if (row >= this.dangerRow) {
      this.finish(false);
      return;
    }

    this.resolveMatches(row, col);
    this.dropFloating();
    this.currentColor = this.nextColor;
    this.nextColor = Math.floor(Math.random() * BUBBLE_COLORS.length);

    if (this.countBubbles() === 0) {
      this.finish(true);
      return;
    }

    if (this.shotsLeft <= 0) {
      this.setStatus('\u8bf7\u5148\u7b54\u9898\u7ee7\u7eed\u6316\u6398\u3002');
    } else {
      this.setStatus('\u5269\u4f59\u53d1\u5c04\u6b21\u6570\uff1a' + this.shotsLeft);
    }
  }

  findNearestCell(x, y) {
    let best = null;
    let bestD = Infinity;
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.grid[r][c] !== 0) continue;
        const { x: cx, y: cy } = this.cellCenter(r, c);
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestD) {
          bestD = d;
          best = { row: r, col: c };
        }
      }
    }
    return best;
  }

  neighbors(row, col) {
    const odd = row % 2 === 1;
    const deltas = odd
      ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
      : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
    return deltas
      .map(([dr, dc]) => [row + dr, col + dc])
      .filter(([r, c]) => r >= 0 && r < this.rows && c >= 0 && c < this.cols);
  }

  resolveMatches(row, col) {
    const color = this.grid[row][col];
    if (!color) return;
    const stack = [[row, col]];
    const group = [];
    const seen = new Set();
    while (stack.length) {
      const [r, c] = stack.pop();
      const key = r + ',' + c;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.grid[r][c] !== color) continue;
      group.push([r, c]);
      for (const [nr, nc] of this.neighbors(r, c)) {
        if (this.grid[nr][nc] === color) stack.push([nr, nc]);
      }
    }
    if (group.length < 3) return;
    for (const [r, c] of group) this.grid[r][c] = 0;
  }

  dropFloating() {
    const connected = new Set();
    const stack = [];
    for (let c = 0; c < this.cols; c += 1) {
      if (this.grid[0][c]) stack.push([0, c]);
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      const key = r + ',' + c;
      if (connected.has(key)) continue;
      connected.add(key);
      for (const [nr, nc] of this.neighbors(r, c)) {
        if (this.grid[nr][nc]) stack.push([nr, nc]);
      }
    }
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.grid[r][c] && !connected.has(r + ',' + c)) this.grid[r][c] = 0;
      }
    }
  }

  countBubbles() {
    let n = 0;
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) if (this.grid[r][c]) n += 1;
    }
    return n;
  }

  finish(won) {
    if (this.finished) return;
    this.finished = true;
    this.moving = null;
    if (won) {
      this.setStatus('\u6316\u6398\u6210\u529f\uff01\u6ce1\u6ce1\u5168\u90e8\u6e05\u9664\u3002');
      this.onWin?.();
    } else {
      this.setStatus('\u6316\u6398\u5931\u8d25\uff0c\u6ce1\u6ce1\u5806\u5230\u4e86\u5371\u9669\u533a\u3002');
      this.onLose?.();
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const dy = this.radius * 1.732;
    ctx.strokeStyle = 'rgba(255,80,80,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, this.radius * 2 + this.dangerRow * dy);
    ctx.lineTo(this.canvas.width, this.radius * 2 + this.dangerRow * dy);
    ctx.stroke();

    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const v = this.grid[r][c];
        if (!v) continue;
        this.drawBubble(this.cellCenter(r, c).x, this.cellCenter(r, c).y, BUBBLE_COLORS[v - 1]);
      }
    }

    if (this.moving) {
      this.drawBubble(this.moving.x, this.moving.y, BUBBLE_COLORS[this.moving.color - 1]);
    }

    if (!this.finished && this.shotsLeft > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(this.shooterX, this.shooterY);
      ctx.lineTo(
        this.shooterX + Math.cos(this.angle) * 120,
        this.shooterY + Math.sin(this.angle) * 120,
      );
      ctx.stroke();
      this.drawBubble(this.shooterX, this.shooterY, BUBBLE_COLORS[this.currentColor]);
      this.drawBubble(this.shooterX + 36, this.shooterY + 8, BUBBLE_COLORS[this.nextColor], 0.75);
    }
  }

  drawBubble(x, y, color, scale = 1) {
    const r = this.radius * scale;
    const g = this.ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, '#00000055');
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
