import { getCraftConfig, getSkillBookMap, formatGoodsSummary, getGoodsInfo } from './goods-data.js';

export class CraftPanel {
  constructor(modalEl, api) {
    this.modal = modalEl;
    this.api = api;
    this.activeTab = 'sword';
    this.selectedRecipe = null;

    this.modal.querySelector('[data-close="craft"]').addEventListener('click', () => this.close());
    this.modal.querySelector('#craft-make').addEventListener('click', () => this.make());
    this.modal.querySelectorAll('.craft-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.selectedRecipe = null;
        this.render();
      });
    });
  }

  open() {
    if (!this.api.state.started) {
      this.api.ui.toast('\u8bf7\u5148\u5f00\u59cb\u6e38\u620f');
      return;
    }
    this.selectedRecipe = null;
    this.render();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  ensureSkills() {
    if (!this.api.state.player.skills) {
      this.api.state.player.skills = {
        sword: { level: 0, uses: 0 },
        medicine: { level: 0, uses: 0 },
        equip: { level: 0, uses: 0 },
        hidden: { level: 0, uses: 0 },
      };
    }
  }

  getSkillLevel(tabKey) {
    this.ensureSkills();
    return this.api.state.player.skills[tabKey]?.level || 0;
  }

  hasLearned(tabKey) {
    const cfg = getCraftConfig()[tabKey];
    if (!cfg) return false;
    if (this.getSkillLevel(tabKey) > 0) return true;
    const book = cfg.skillBook;
    return (this.api.state.player.goods[book] || 0) > 0;
  }

  learnFromBook(tabKey) {
    const cfg = getCraftConfig()[tabKey];
    if (!cfg) return;
    const book = cfg.skillBook;
    if ((this.api.state.player.goods[book] || 0) > 0 && this.getSkillLevel(tabKey) === 0) {
      this.ensureSkills();
      this.api.state.player.skills[tabKey] = { level: 1, uses: 0 };
    }
  }

  getMaterials(recipe) {
    const counts = {};
    for (const name of recipe) {
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).map(([name, need]) => ({
      name,
      need,
      have: this.api.state.player.goods[name] || 0,
    }));
  }

  materialsOk(materials) {
    return materials.every((m) => m.have >= m.need);
  }

  render() {
    const cfg = getCraftConfig()[this.activeTab];
    const infoEl = this.modal.querySelector('#craft-info');
    const listEl = this.modal.querySelector('#craft-recipes');
    const matEl = this.modal.querySelector('#craft-materials');

    this.modal.querySelectorAll('.craft-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.activeTab);
    });

    this.learnFromBook(this.activeTab);
    const level = this.getSkillLevel(this.activeTab);
    const rate = level > 0 ? level * 5 + 50 : 0;

    if (!this.hasLearned(this.activeTab)) {
      infoEl.innerHTML = `
        <p>\u60a8\u6ca1\u6709\u5b66\u4f1a${cfg?.label || ''}\u672f</p>
        <p class="craft-hint">\u79d8\u7c4d\u4e00\u822c\u53ef\u5728\u8ff7\u5bab\u6216\u795e\u79d8\u4eba\u624b\u4e0a\u5f97\u5230\uff08\u5982\u300c${cfg?.skillBook || ''}\u300d\uff09\u3002</p>`;
      listEl.innerHTML = '';
      matEl.innerHTML = '';
      return;
    }

    infoEl.innerHTML = `
      <p>\u5f53\u524d${cfg.label}\u672f\u7b49\u7ea7\uff1a<strong>${level}</strong> \u7ea7</p>
      <p>\u5f53\u524d\u6210\u529f\u7387\uff1a<strong>${rate}%</strong></p>
      <p class="craft-hint">\u6bcf\u4f7f\u7528 5 \u6b21\u7b49\u7ea7\u63d0\u5347\u4e00\u7ea7\uff0c\u6210\u529f\u7387\u589e\u52a0 5%</p>`;

    const recipes = Object.entries(cfg.recipes || {});
    listEl.innerHTML = recipes.map(([name]) => `
      <button type="button" class="craft-recipe ${this.selectedRecipe === name ? 'active' : ''}" data-recipe="${name}">
        ${name}
      </button>`).join('');

    listEl.querySelectorAll('.craft-recipe').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedRecipe = btn.dataset.recipe;
        this.render();
      });
    });

    if (!this.selectedRecipe) {
      matEl.innerHTML = '<p class="panel-empty">\u8bf7\u9009\u62e9\u8981\u5408\u6210\u7684\u7269\u54c1</p>';
      return;
    }

    const materials = this.getMaterials(cfg.recipes[this.selectedRecipe]);
    const ok = this.materialsOk(materials);
    matEl.innerHTML = `
      <h4>\u6240\u9700\u539f\u6599</h4>
      <table class="craft-table">
        <thead><tr><th>\u539f\u6599</th><th>\u9700\u8981</th><th>\u5df2\u6709</th></tr></thead>
        <tbody>${materials.map((m) => `
          <tr class="${m.have >= m.need ? '' : 'short'}">
            <td>${m.name}</td><td>${m.need}</td><td>${m.have}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="craft-status ${ok ? 'ok' : 'bad'}">${ok ? '\u539f\u6599\u5145\u8db3\uff0c\u53ef\u4ee5\u5236\u4f5c' : '\u539f\u6599\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5236\u4f5c'}</p>`;
  }

  async make() {
    const cfg = getCraftConfig()[this.activeTab];
    if (!cfg || !this.selectedRecipe) {
      this.api.ui.toast('\u8bf7\u9009\u62e9\u4e00\u4e2a\u9700\u8981\u5408\u6210\u7684\u7269\u54c1\u540d');
      return;
    }
    if (!this.hasLearned(this.activeTab)) {
      this.api.ui.toast('\u60a8\u6ca1\u6709\u5b66\u4f1a\u6b64\u6280\u80fd');
      return;
    }

    const materials = this.getMaterials(cfg.recipes[this.selectedRecipe]);
    if (!this.materialsOk(materials)) {
      this.api.ui.toast('\u539f\u6599\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5236\u4f5c');
      return;
    }

    const popOk = await this.api.game_pop(2);
    if (!popOk) {
      this.api.ui.toast('\u94f8\u9020\u5408\u6210\u8fc7\u7a0b\u4e2d\u65ad');
      return;
    }

    for (const m of materials) {
      this.api.game_goods_change_n(m.name, -m.need);
    }

    this.ensureSkills();
    const skill = this.api.state.player.skills[this.activeTab];
    skill.uses += 1;
    if (skill.uses >= 5 && skill.level < 10) {
      skill.level += 1;
      skill.uses = 0;
    }

    const level = skill.level;
    const success = level >= 10 || Math.random() * 100 < level * 5 + 50;
    if (success) {
      this.api.game_goods_change_n(this.selectedRecipe, 1);
      this.api.ui.toast('\u94f8\u9020\u5408\u6210\u6210\u529f\u3002');
    } else {
      this.api.ui.toast('\u94f8\u9020\u5408\u6210\u5931\u8d25\u3002');
    }

    this.api.ui.refreshStatus();
    this.api.persist();
    this.render();
  }
}

export function learnSkillFromItem(api, itemName) {
  const map = getSkillBookMap();
  const tab = map[itemName];
  if (!tab) return;
  if (!api.state.player.skills) {
    api.state.player.skills = {
      sword: { level: 0, uses: 0 },
      medicine: { level: 0, uses: 0 },
      equip: { level: 0, uses: 0 },
      hidden: { level: 0, uses: 0 },
    };
  }
  if ((api.state.player.skills[tab]?.level || 0) === 0) {
    api.state.player.skills[tab] = { level: 1, uses: 0 };
  }
}
