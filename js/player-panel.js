import { getGoodsInfo, formatGoodsSummary } from './goods-data.js';
import { readValues, STAT, ensureParty } from './game-runtime.js';
import {
  equipGoods,
  unequipSlot,
  dropGoods,
  useMedicine,
  learnSkillBook,
  useSpecialGoods,
  listInventoryByCategory,
  listSkills,
  getEquippedGoods,
  EQUIP_SLOTS,
} from './inventory-system.js';

export class PlayerPanel {
  constructor(modalEl, api) {
    this.modal = modalEl;
    this.api = api;
    this.roleIndex = 0;
    this.tab = 'stats';
    this.modal.querySelector('[data-close="player"]').addEventListener('click', () => this.close());
    this.modal.querySelectorAll('.player-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.render();
      });
    });
  }

  open() {
    if (!this.api.state.started) {
      this.api.ui.toast('\u8bf7\u5148\u5f00\u59cb\u6e38\u620f');
      return;
    }
    ensureParty(this.api.state);
    this.render();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  setRole(index) {
    this.roleIndex = index;
    this.render();
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  getRole() {
    return this.api.state.party[this.roleIndex];
  }

  toastResult(result) {
    if (result.ok) {
      this.api.ui.toast('\u64cd\u4f5c\u6210\u529f');
    } else {
      this.api.ui.toast(result.reason || '\u64cd\u4f5c\u5931\u8d25');
    }
  }

  afterChange() {
    this.api.ui.refreshStatus();
    this.api.persist();
    this.render();
  }

  render() {
    const body = this.modal.querySelector('#player-body');
    if (!body) return;

    this.modal.querySelectorAll('.player-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.tab);
    });

    body.innerHTML = `
      <aside class="player-party">${this.renderPartyList()}</aside>
      <section class="player-main">${this.renderMain()}</section>`;

    body.querySelectorAll('[data-role-index]').forEach((btn) => {
      btn.addEventListener('click', () => this.setRole(Number(btn.dataset.roleIndex)));
    });

    body.querySelectorAll('[data-equip-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = equipGoods(this.api.state, this.roleIndex, btn.dataset.equipName);
        this.toastResult(result);
        if (result.ok) this.afterChange();
      });
    });

    body.querySelectorAll('[data-unequip-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = unequipSlot(this.api.state, this.roleIndex, Number(btn.dataset.unequipSlot));
        this.toastResult(result);
        if (result.ok) this.afterChange();
      });
    });

    body.querySelectorAll('[data-use-med]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = useMedicine(this.api.state, this.roleIndex, btn.dataset.useMed);
        this.toastResult(result);
        if (result.ok) this.afterChange();
      });
    });

    body.querySelectorAll('[data-learn-book]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = learnSkillBook(this.api.state, this.roleIndex, btn.dataset.learnBook);
        this.toastResult(result);
        if (result.ok) this.afterChange();
      });
    });

    body.querySelectorAll('[data-use-special]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const result = await useSpecialGoods(this.api, this.roleIndex, btn.dataset.useSpecial);
        this.toastResult(result);
        if (result.ok) {
          this.afterChange();
          this.close();
        }
      });
    });

    body.querySelectorAll('[data-drop-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.dropName;
        const count = this.api.state.player.goods[name] || 0;
        if (!window.confirm(`\u786e\u8ba4\u4e22\u5f03 ${name} \u00d7${count}\uff1f`)) return;
        const result = dropGoods(this.api.state, name, true);
        this.toastResult(result);
        if (result.ok) this.afterChange();
      });
    });
  }

  renderPartyList() {
    const party = this.api.state.party || [];
    if (party.length <= 1) return '';
    return `
      <h3 class="panel-subtitle">\u961f\u4f0d</h3>
      <div class="party-list">
        ${party.map((role, idx) => `
          <button type="button" class="party-btn ${idx === this.roleIndex ? 'active' : ''}" data-role-index="${idx}">
            ${role.name}
          </button>`).join('')}
      </div>`;
  }

  renderMain() {
    switch (this.tab) {
      case 'equip': return this.renderEquipTab();
      case 'goods': return this.renderGoodsTab();
      case 'skills': return this.renderSkillsTab();
      default: return this.renderStatsTab();
    }
  }

  renderStatsTab() {
    const idx = this.roleIndex;
    const role = this.getRole();
    const sexLabel = readValues(this.api.state, idx, STAT.sex) === 0 ? '\u5973' : '\u7537';
    return `
      <div class="stat-grid player-stat-grid">
        <span>\u59d3\u540d</span><strong>${role?.name || ''}</strong>
        <span>\u6027\u522b</span><strong>${sexLabel}</strong>
        <span>\u7b49\u7ea7</span><strong>${readValues(this.api.state, idx, STAT.grade)}</strong>
        <span>\u7ecf\u9a8c</span><strong>${readValues(this.api.state, idx, STAT.experience)}</strong>
        <span>\u751f\u547d</span><strong>${readValues(this.api.state, idx, STAT.life)}/${readValues(this.api.state, idx, STAT.gdsmz27)}</strong>
        <span>\u4f53\u529b</span><strong>${readValues(this.api.state, idx, STAT.tili)}/${readValues(this.api.state, idx, STAT.gdtl25)}</strong>
        <span>\u7075\u529b</span><strong>${readValues(this.api.state, idx, STAT.lingli)}/${readValues(this.api.state, idx, STAT.gdll26)}</strong>
        <span>\u901f\u5ea6</span><strong>${readValues(this.api.state, idx, STAT.speed)}</strong>
        <span>\u653b\u51fb</span><strong>${readValues(this.api.state, idx, STAT.attack)}</strong>
        <span>\u9632\u62a4</span><strong>${readValues(this.api.state, idx, STAT.defend)}</strong>
        <span>\u667a\u529b</span><strong>${readValues(this.api.state, idx, STAT.intellect)}</strong>
        <span>\u5e78\u8fd0</span><strong>${readValues(this.api.state, idx, STAT.luck)}</strong>
        <span>\u91d1\u94b1</span><strong>${readValues(this.api.state, idx, STAT.money)}</strong>
      </div>`;
  }

  renderEquipTab() {
    const equipped = getEquippedGoods(this.api.state, this.roleIndex);
    const slots = Object.entries(EQUIP_SLOTS).map(([slot, label]) => {
      const info = equipped[slot];
      const name = info?.name || '\u65e0';
      const summary = info ? formatGoodsSummary(info) : '';
      return `
        <div class="equip-row">
          <div>
            <strong>${label}</strong>
            <div>${name}</div>
            ${summary ? `<div class="trade-desc">${summary}</div>` : ''}
          </div>
          ${info ? `<button type="button" class="mini-btn" data-unequip-slot="${slot}">\u8131\u4e0b</button>` : ''}
        </div>`;
    }).join('');

    const buckets = listInventoryByCategory(this.api.state);
    const wearList = [...buckets.equipment, ...buckets.weapon];
    const wearHtml = wearList.length
      ? wearList.map(({ name, count, info }) => `
        <div class="goods-row">
          <div>
            <span class="goods-name">${name}</span>
            <span class="goods-count">\u00d7${count}</span>
            <div class="trade-desc">${formatGoodsSummary(info)}</div>
          </div>
          <button type="button" class="mini-btn" data-equip-name="${name}">\u88c5\u5907</button>
        </div>`).join('')
      : '<p class="panel-empty">\u65e0\u53ef\u88c5\u5907\u7269\u54c1</p>';

    return `
      <h3 class="panel-subtitle">\u5f53\u524d\u88c5\u5907</h3>
      <div class="equip-list">${slots}</div>
      <h3 class="panel-subtitle">\u80cc\u5305\u88c5\u5907</h3>
      <div class="goods-list">${wearHtml}</div>`;
  }

  renderGoodsTab() {
    const buckets = listInventoryByCategory(this.api.state);
    const sections = [
      ['\u836f\u54c1\u98df\u54c1', buckets.medicine, 'med'],
      ['\u6750\u6599', buckets.craft, 'craft'],
      ['\u7279\u6b8a\u7269\u54c1', buckets.special, 'special'],
    ];

    return sections.map(([title, items, kind]) => {
      if (!items.length) return '';
      const rows = items.map(({ name, count, info }) => {
        const typeNum = Number(info.typeNum ?? info.type) || 0;
        let action = `<button type="button" class="mini-btn danger" data-drop-name="${name}">\u4e22\u5f03</button>`;
        if (kind === 'med') {
          action = `<button type="button" class="mini-btn" data-use-med="${name}">\u4f7f\u7528</button>${action}`;
        } else if (kind === 'special') {
          if (typeNum & 128) {
            action = `<button type="button" class="mini-btn" data-learn-book="${name}">\u5b66\u4e60</button>${action}`;
          } else if (typeNum & 64) {
            action = `<button type="button" class="mini-btn" data-use-special="${name}">\u4f7f\u7528</button>${action}`;
          }
        }
        return `
          <div class="goods-row">
            <div>
              <span class="goods-name">${name}</span>
              <span class="goods-count">\u00d7${count}</span>
              <div class="trade-desc">${formatGoodsSummary(info)}</div>
            </div>
            <div class="row-actions">${action}</div>
          </div>`;
      }).join('');
      return `<h3 class="panel-subtitle">${title}</h3><div class="goods-list">${rows}</div>`;
    }).join('') || '<p class="panel-empty">\u6682\u65e0\u7269\u54c1</p>';
  }

  renderSkillsTab() {
    const role = this.getRole();
    const { ji, fa } = listSkills(role);
    const renderList = (title, items) => `
      <h3 class="panel-subtitle">${title}</h3>
      <div class="skill-list">
        ${items.length ? items.map((item) => `
          <div class="skill-row">
            <strong>${item.name}</strong>
            <span>\u7b49\u7ea7 ${item.level || 1}</span>
            ${item.info?.desc ? `<div class="trade-desc">${item.info.desc}</div>` : ''}
          </div>`).join('') : '<p class="panel-empty">\u6682\u65e0</p>'}
      </div>`;
    return `${renderList('\u6280\u80fd', ji)}${renderList('\u6cd5\u672f', fa)}`;
  }
}
