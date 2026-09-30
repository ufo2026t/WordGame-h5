import {
  getShop,
  getGoodsInfo,
  getShopQuote,
  canSellInShop,
  calcBuyPrice,
  calcSellPrice,
  randomDiscount,
  formatGoodsSummary,
  getGoodsIconUrl,
} from './goods-data.js';
import { MAX_GOODS_STACK } from './inventory-system.js';

export class TradePanel {
  constructor(modalEl, api) {
    this.modal = modalEl;
    this.api = api;
    this.tradeId = 10;
    this.mode = 'buy';
    this.discount = 9;
    this.quantities = {};

    this.modal.querySelector('[data-close="trade"]').addEventListener('click', () => this.close());
    this.modal.querySelector('#trade-confirm').addEventListener('click', () => this.confirm());
    this.modal.querySelectorAll('.trade-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });
  }

  open(tradeId, flag) {
    if (!this.api.state.started) {
      this.api.ui.toast('\u8bf7\u5148\u5f00\u59cb\u6e38\u620f');
      return;
    }
    this.tradeId = tradeId;
    this.mode = flag === 1 ? 'sell' : 'buy';
    this.discount = this.mode === 'buy' ? randomDiscount(7, 12) : randomDiscount(3, 6);
    this.quantities = {};
    this.render();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  switchMode(mode) {
    this.mode = mode;
    this.discount = this.mode === 'buy' ? randomDiscount(7, 12) : randomDiscount(3, 6);
    this.quantities = {};
    this.render();
  }

  getShopInfo() {
    return getShop(this.tradeId);
  }

  getBuyItems() {
    const shop = this.getShopInfo();
    return shop.items.map((name) => {
      const info = getGoodsInfo(name);
      const price = calcBuyPrice(info.priceNum ?? info.price, this.discount);
      const owned = this.api.state.player.goods[name] || 0;
      return { name, desc: formatGoodsSummary(info), price, owned };
    });
  }

  getSellItems() {
    const shop = this.getShopInfo();
    const goods = this.api.state.player.goods || {};
    return Object.entries(goods)
      .filter(([name, count]) => count > 0 && canSellInShop(getGoodsInfo(name), shop.category))
      .map(([name, owned]) => {
        const info = getGoodsInfo(name);
        const price = calcSellPrice(info.priceNum ?? info.price, this.discount);
        return { name, desc: formatGoodsSummary(info), price, owned };
      });
  }

  setQty(name, delta) {
    const items = this.mode === 'buy' ? this.getBuyItems() : this.getSellItems();
    const item = items.find((i) => i.name === name);
    if (!item) return;
    const cur = this.quantities[name] || 0;
    let next = cur + delta;
    if (next < 0) next = 0;
    if (this.mode === 'sell' && next > item.owned) next = item.owned;
    if (this.mode === 'buy' && next > 0 && item.owned + next > MAX_GOODS_STACK) {
      next = MAX_GOODS_STACK - item.owned;
    }
    if (next === 0) delete this.quantities[name];
    else this.quantities[name] = next;
    this.renderRows();
    this.updateSummary();
  }

  totalCost() {
    const items = this.mode === 'buy' ? this.getBuyItems() : this.getSellItems();
    let total = 0;
    for (const [name, qty] of Object.entries(this.quantities)) {
      const item = items.find((i) => i.name === name);
      if (item && qty > 0) total += item.price * qty;
    }
    return total;
  }

  render() {
    const shop = this.getShopInfo();
    this.modal.querySelector('#trade-title').textContent = shop.name;
    this.modal.querySelector('#trade-quote').textContent = getShopQuote(this.mode);
    this.modal.querySelectorAll('.trade-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    });
    this.renderRows();
    this.updateSummary();
  }

  renderRows() {
    const list = this.modal.querySelector('#trade-list');
    const items = this.mode === 'buy' ? this.getBuyItems() : this.getSellItems();
    if (!items.length) {
      list.innerHTML = '<p class="panel-empty">\u6682\u65e0\u53ef\u4ea4\u6613\u7269\u54c1</p>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const qty = this.quantities[item.name] || 0;
      const info = getGoodsInfo(item.name);
      const icon = info.id ? getGoodsIconUrl(info.id) : null;
      const iconHtml = icon
        ? `<img class="trade-icon" src="${icon}" alt="" onerror="this.style.display='none'">`
        : '';
      return `
        <div class="trade-row" data-name="${item.name}">
          ${iconHtml}
          <div class="trade-item-info">
            <strong>${item.name}</strong>
            <span class="trade-desc">${item.desc || ''}</span>
            <span class="trade-meta">\u5355\u4ef7 ${item.price} \u00b7 \u5df2\u6709 ${item.owned}</span>
          </div>
          <div class="trade-qty">
            <button type="button" data-qty="-1">\u2212</button>
            <span>${qty}</span>
            <button type="button" data-qty="1">+</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.trade-row').forEach((row) => {
      const name = row.dataset.name;
      row.querySelector('[data-qty="-1"]').addEventListener('click', () => this.setQty(name, -1));
      row.querySelector('[data-qty="1"]').addEventListener('click', () => this.setQty(name, 1));
    });
  }

  updateSummary() {
    const total = this.totalCost();
    const money = this.api.state.player.money;
    const summary = this.modal.querySelector('#trade-summary');
    if (this.mode === 'buy') {
      summary.textContent = `\u5171\u6709 ${money} \u91d1\u5e01\uff0c\u9884\u8ba1\u8d2d\u7269\u9700 ${total} \u91d1\u5e01\uff08${this.discount}\u6298\uff09`;
    } else {
      summary.textContent = `\u73b0\u6709 ${money} \u91d1\u5e01\uff0c\u9884\u8ba1\u5356\u51fa\u53ef\u5f97 ${total} \u91d1\u5e01\uff08${this.discount}\u6298\uff09`;
    }
  }

  confirm() {
    const entries = Object.entries(this.quantities).filter(([, q]) => q > 0);
    if (!entries.length) {
      this.api.ui.toast('\u8bf7\u9009\u62e9\u4ea4\u6613\u6570\u91cf');
      return;
    }

    const total = this.totalCost();
    if (this.mode === 'buy') {
      if (total > this.api.state.player.money) {
        this.api.ui.toast('\u91d1\u989d\u4e0d\u8db3\uff0c\u8bf7\u51cf\u5c11\u8d2d\u7269\u6570\u91cf');
        return;
      }
      for (const [name, qty] of entries) {
        this.api.game_goods_change_n(name, qty);
      }
      this.api.state.player.money -= total;
      this.api.ui.toast('\u8c22\u8c22\u8d2d\u4e70\uff0c\u6b22\u8fce\u518d\u6b21\u5149\u4e34\u3002');
    } else {
      for (const [name, qty] of entries) {
        if ((this.api.state.player.goods[name] || 0) < qty) {
          this.api.ui.toast('\u5356\u51fa\u6570\u91cf\u4e0d\u80fd\u5927\u4e8e\u6301\u6709\u6570\u91cf');
          return;
        }
        this.api.game_goods_change_n(name, -qty);
      }
      this.api.state.player.money += total;
      this.api.ui.toast(`\u4ea4\u6613\u6210\u529f\uff0c\u60a8\u5f97\u5230\u4e86\u91d1\u94b1\uff1a${total}`);
    }

    this.api.ui.refreshStatus();
    this.api.persist();
    this.close();
  }
}
