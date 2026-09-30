let _data = null;

export async function loadGameData() {
  if (_data) return _data;
  const res = await fetch('data/game-data.json');
  if (!res.ok) throw new Error('\u65e0\u6cd5\u52a0\u8f7d\u6e38\u620f\u6570\u636e');
  _data = await res.json();
  return _data;
}

export function getGameData() {
  return _data;
}

export function getGoodsInfo(name) {
  const info = _data?.goodsByName?.[name];
  if (info) {
    return {
      ...info,
      price: (info.priceNum ?? Number(info.price)) || 0,
    };
  }
  return { price: 50, priceNum: 50, category: 'misc', desc: '', name };
}

export function getGoodsById(id) {
  return _data?.goodsById?.[String(id)] || null;
}

export function getShop(tradeId) {
  const key = String(tradeId);
  const shop = _data?.shops?.[key];
  if (shop) return shop;
  return {
    name: '\u4e13\u5356\u5e97',
    category: 'misc',
    items: [],
    ranges: [],
  };
}

export function getCraftConfig() {
  return _data?.craft || {};
}

export function getSkillBookMap() {
  return _data?.skillBooks || {};
}

export function getShopQuote(mode) {
  const list = _data?.shopQuotes?.[mode] || ['\u6b22\u8fce\u5149\u4e34'];
  return list[Math.floor(Math.random() * list.length)];
}

const SHOP_TYPE_MASK = {
  weapon: 16,
  equipment: 1,
  medicine: 2,
  misc: 64,
};

export function shopCategoryType(category) {
  return SHOP_TYPE_MASK[category] || 64;
}

/** goods.txt: negative price = not sellable; price 0 on type-64 = quest token/key. */
export function isGoodsSellable(goodsInfo) {
  if (!goodsInfo) return false;
  if (goodsInfo.sellable === false) return false;
  const priceNum = Number(goodsInfo.priceNum ?? goodsInfo.price);
  if (Number.isFinite(priceNum) && priceNum < 0) return false;
  const typeNum = Number(goodsInfo.typeNum ?? goodsInfo.type) || 0;
  if (priceNum === 0 && (typeNum & 64) === 64) return false;
  return true;
}

export function canSellInShop(goodsInfo, shopCategory) {
  if (!isGoodsSellable(goodsInfo)) return false;
  const typeNum = Number(goodsInfo.typeNum ?? goodsInfo.type) || 0;
  const mask = shopCategoryType(shopCategory);
  if ((typeNum & 8) === 8) return true;
  return (typeNum & mask) === mask;
}

export function calcBuyPrice(basePrice, discount) {
  return Math.max(1, Math.floor(Number(basePrice) * discount / 10));
}

export function calcSellPrice(basePrice, discount) {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.max(0, Math.floor(base * discount / 10));
}

export function randomDiscount(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function parseMonsterRaw(raw) {
  const parts = raw.split(',');
  const fields = [
    'name', 'attack', 'defense', 'hp', 'magic', 'exp',
    'dropItem', 'dropMoney', 'dropCount', 'dropChance', 'speed', 'icon', 'desc',
  ];
  const out = {};
  for (let i = 0; i < fields.length; i += 1) {
    if (i < parts.length) out[fields[i]] = parts[i].trim();
  }
  if (parts.length > fields.length) {
    out.desc = parts.slice(fields.length - 1).join(',').trim();
  }
  out.attackNum = Number(out.attack) || 0;
  out.hpNum = Number(out.hp) || 0;
  out.defenseNum = Number(out.defense) || 0;
  out.expNum = Number(out.exp) || 0;
  out.dropMoneyNum = Number(out.dropMoney) || 0;
  out.speedNum = Number(out.speed) || 0;
  return out;
}

export function getMonsterEntry(typeId) {
  return _data?.monsters?.[String(typeId)] || null;
}

export function resolveMonsterStats(typeId) {
  const entry = getMonsterEntry(typeId);
  if (!entry) return null;
  if (entry.raw.startsWith('(')) return null;
  return parseMonsterRaw(entry.raw);
}

export function buildMonsterRoster(monsterType, popCount = 1) {
  const entry = getMonsterEntry(monsterType);
  if (!entry) {
    return [{
      name: `\u602a\u7269${monsterType}`,
      attack: 10 + monsterType,
      hp: 100 + monsterType * 10,
      maxHp: 100 + monsterType * 10,
      defense: 0,
      exp: 10,
    }];
  }

  const roster = [];
  const refs = entry.refs?.length ? entry.refs : [String(monsterType)];

  if (entry.raw.startsWith('(')) {
    let refIdx = 0;
    for (let wave = 0; wave < popCount; wave += 1) {
      for (let i = 0; i < refs.length && roster.length < 5; i += 1) {
        const ref = refs[refIdx % refs.length];
        refIdx += 1;
        const stats = resolveMonsterStats(ref);
        if (stats) roster.push(monsterFromStats(stats));
      }
    }
    return roster.length ? roster : buildMonsterRoster(1, 1);
  }

  const stats = parseMonsterRaw(entry.raw);
  const base = monsterFromStats(stats);
  for (let i = 0; i < Math.min(popCount, 5); i += 1) {
    roster.push({ ...base, id: i + 1 });
  }
  return roster;
}

function monsterFromStats(stats) {
  let hp = stats.hpNum;
  if (hp < 0) hp = Math.abs(hp) * 50;
  if (hp <= 0) hp = 100;
  let attack = stats.attackNum;
  if (attack <= 0) attack = 10;
  return {
    name: stats.name || '\u654c\u4eba',
    attack,
    defense: stats.defenseNum,
    speed: stats.speedNum || 10,
    hp,
    maxHp: hp,
    exp: stats.expNum,
    magic: Number(stats.magic) || 0,
    dropMoney: stats.dropMoneyNum,
    dropItem: Number(stats.dropItem) || 0,
    dropCount: Number(stats.dropCount) || 0,
    dropChance: Number(stats.dropChance) || 0,
    desc: stats.desc || '',
    icon: Number(stats.icon) || 0,
  };
}

export function getMonsterIconUrl(icon) {
  const n = Number(icon);
  if (Number.isNaN(n)) return null;
  return `data/img/${n}.bmp`;
}

export function getGoodsIconUrl(goodsId) {
  const id = Number(goodsId);
  if (!id) return null;
  return `data/sml/${id}.bmp`;
}

export function formatGoodsSummary(item) {
  if (!item) return '';
  const bits = [];
  if (Number(item.defense) > 0) bits.push(`\u9632+${item.defense}`);
  if (Number(item.hp) > 0) bits.push(`\u4f53+${item.hp}`);
  if (Number(item.attack) > 0) bits.push(`\u653b+${item.attack}`);
  if (Number(item.speed) > 0) bits.push(`\u901f+${item.speed}`);
  if (Number(item.priceNum ?? item.price) > 0) bits.push(`\u4ef7\u683c:${item.priceNum ?? item.price}`);
  const body = bits.length ? bits.join(' ') : '';
  return [body, item.desc || ''].filter(Boolean).join(' \u00b7 ');
}
