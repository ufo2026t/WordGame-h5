(function () {
var __wgRegistry = Object.create(null);
function __wgReq(id) {
  var mod = __wgRegistry[id];
  if (!mod) throw new Error('Missing module: ' + id);
  if (mod.loaded || mod.loading) return mod.exports;
  mod.loading = true;
  var result = mod.factory(mod.exports);
  if (result && typeof result.then === 'function') {
    throw new Error('Top-level await must stay in the entry module: ' + id);
  }
  mod.loaded = true;
  return mod.exports;
}
function __wgLazy(id, name) {
  function late() {}
  return new Proxy(late, {
    get: function (_t, prop) {
      var target = __wgReq(id)[name];
      if (target == null) return undefined;
      if (typeof target !== 'object' && typeof target !== 'function') return undefined;
      if (prop === 'prototype') return target.prototype;
      var value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    apply: function (_t, thisArg, args) {
      var target = __wgReq(id)[name];
      return target.apply(thisArg, args);
    },
    construct: function (_t, args) {
      return Reflect.construct(__wgReq(id)[name], args);
    }
  });
}
function __wgImport(id, map) {
  var mod = __wgRegistry[id];
  var cyclic = mod && mod.loading && !mod.loaded;
  var loaded = cyclic ? null : __wgReq(id);
  var out = {};
  Object.keys(map).forEach(function (local) {
    var exported = map[local];
    out[local] = cyclic ? __wgLazy(id, exported) : loaded[exported];
  });
  return out;
}
function __wgDef(id, factory) {
  __wgRegistry[id] = { exports: {}, factory: factory, loading: false, loaded: false };
}

__wgDef("text-encoding.js", function (exports) {
/** Labels for legacy Simplified Chinese text (Delphi ANSI / GBK). */
const GB_LABELS = ['gb18030', 'gbk', 'windows-936'];

/**
 * Fetch a text resource and decode as UTF-8 or GBK/ANSI automatically.
 * @param {string} url
 * @returns {Promise<string>}
 */
 async function fetchDecodedText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`\u65e0\u6cd5\u52a0\u8f7d\u6587\u4ef6: ${url}`);
  const buffer = await res.arrayBuffer();
  return decodeTextBytes(buffer);
}

/**
 * Decode bytes from a word-library or ini-like file (UTF-8 or GBK/ANSI).
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
 function decodeTextBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length) return '';

  const bom = readBom(bytes);
  if (bom) {
    return decodeWithLabel(bom.body, bom.encoding);
  }

  if (isValidUtf8(bytes)) {
    const utf8Text = decodeWithLabel(bytes, 'utf-8');
    const gbText = tryDecodeGb(bytes);
    if (gbText && shouldPreferGbOverUtf8(utf8Text, gbText)) {
      return gbText;
    }
    return utf8Text;
  }

  const gbText = tryDecodeGb(bytes);
  if (gbText) return gbText;

  return decodeWithLabel(bytes, 'utf-8');
}

function readBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', body: bytes.slice(3) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', body: bytes.slice(2) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', body: bytes.slice(2) };
  }
  return null;
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodeWithLabel(bytes, label) {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function tryDecodeGb(bytes) {
  for (const label of GB_LABELS) {
    try {
      const text = new TextDecoder(label).decode(bytes);
      if (text && !text.includes('\uFFFD')) return text;
    } catch {
      /* try next label */
    }
  }
  for (const label of GB_LABELS) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* try next label */
    }
  }
  return null;
}

/** Score how plausible a decoded word-library body looks. */
function scoreWordLibText(text) {
  let lines = 0;
  let withCjk = 0;
  let replacement = 0;
  let mojibake = 0;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    lines += 1;
    const cn = line.slice(eq + 1).replace(/;[+-]\d+/g, '');
    if (line.includes('\uFFFD')) replacement += 1;
    if (/[\u4e00-\u9fff]/.test(cn)) withCjk += 1;
    else if (/[\u00c0-\u00ff]{2,}/.test(cn)) mojibake += 1;
  }

  if (lines === 0) return 0;
  return withCjk * 10 - replacement * 40 - mojibake * 25 + Math.min(lines, 50);
}

function shouldPreferGbOverUtf8(utf8Text, gbText) {
  const utf8Score = scoreWordLibText(utf8Text);
  const gbScore = scoreWordLibText(gbText);
  if (gbScore >= utf8Score + 15) return true;
  if (utf8Text.includes('\uFFFD') && !gbText.includes('\uFFFD')) return true;
  return false;
}

 function detectTextEncodingLabel(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const bom = readBom(bytes);
  if (bom) return bom.encoding;
  if (isValidUtf8(bytes)) {
    const utf8Text = decodeWithLabel(bytes, 'utf-8');
    const gbText = tryDecodeGb(bytes);
    if (gbText && shouldPreferGbOverUtf8(utf8Text, gbText)) return 'gb18030';
    return 'utf-8';
  }
  return 'gb18030';
}

exports.fetchDecodedText = fetchDecodedText;
exports.decodeTextBytes = decodeTextBytes;
exports.detectTextEncodingLabel = detectTextEncodingLabel;

});

__wgDef("settings.js", function (exports) {
 const REP_OPTIONS = [
  { value: 0, label: '错词不重复' },
  { value: 1, label: '立即重复' },
  { value: 2, label: '隔一个再重复' },
  { value: 3, label: '隔二个再重复' },
  { value: 4, label: '隔三个再重复' },
  { value: 5, label: '隔四个再重复' },
  { value: 6, label: '隔五个再重复' },
  { value: 7, label: '隔六个再重复' },
];

 const PAGE_THEME_OPTIONS = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

 function normalizePageTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

 function applyPageTheme(theme) {
  const next = normalizePageTheme(theme);
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}

 const DEFAULT_SETTINGS = {
  enColor: '#000000',
  cnColor: '#000000',
  choiceEnBg: '#ffffff',
  choiceCnBg: '#ffffff',
  enSize: 21,
  cnSize: 16,
  delayShowWord: 1000,
  sequential: false,
  abhs: false,
  /** ComboBox index 0-7, same as original set.txt game_rep */
  repIndex: 3,
  reverseLearn: false,
  defaultLib: '基础单词1500个.ini',
  noRevealTrans: true,
  partSize: 50,
  wordColorMode: 0,
  prefixColor: '#6495ed',
  suffixColor: '#ee82ee',
  fightAttack: 'G',
  fightDefend: 'F',
  fightMagic: 'S',
  fightItem: 'W',
  fightEscape: 'T',
  wordChoice1: 'Y',
  wordChoice2: 'H',
  wordChoice3: 'N',
  /** Maze uses inline pop + deferred script when false (set.txt mg_pop=0). */
  mgPop: false,
  pageTheme: 'dark',
};

 function loadSettings() {
  try {
    const raw = localStorage.getItem('wordgame-settings');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (parsed.rep != null && parsed.repIndex == null) {
      merged.repIndex = Math.min(7, Math.max(0, Number(parsed.rep)));
    }
    delete merged.rep;
    delete merged.autoSpeak;
    delete merged.listeningIndex;
    delete merged.notTiankong;
    merged.pageTheme = normalizePageTheme(merged.pageTheme);
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

 function saveSettings(settings) {
  localStorage.setItem('wordgame-settings', JSON.stringify(settings));
}

/** Load defaults from bundled set.txt (original game settings file). */
 async function loadSetTxtDefaults() {
  try {
    const { fetchDecodedText } = await __wgReq("text-encoding.js");
    const text = await fetchDecodedText('data/upp/dat/set.txt');
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return {
      enColor: rgbToHex(values.game_E_color_R, values.game_E_color_G, values.game_E_color_B),
      cnColor: rgbToHex(values.game_C_color_R, values.game_C_color_G, values.game_C_color_B),
      choiceEnBg: rgbToHex(values.game_BE_color_R, values.game_BE_color_G, values.game_BE_color_B),
      choiceCnBg: rgbToHex(values.game_BC_color_R, values.game_BC_color_G, values.game_BC_color_B),
      enSize: Number(values.game_en_size) || DEFAULT_SETTINGS.enSize,
      cnSize: Number(values.game_cn_size) || DEFAULT_SETTINGS.cnSize,
      delayShowWord: Math.max(1000, Number(values.delay_show_word) || DEFAULT_SETTINGS.delayShowWord),
      sequential: values.game_shunxu === '1',
      abhs: values.game_abhs === '1',
      repIndex: Math.min(7, Math.max(0, Number(values.game_rep) || DEFAULT_SETTINGS.repIndex)),
      noRevealTrans: values.No_RevealTrans === '1',
      partSize: Number(values.part_size) || DEFAULT_SETTINGS.partSize,
      wordColorMode: Math.min(4, Math.max(0, Number(values.game_m_color) || 0)),
      prefixColor: rgbToHex(values.game_WB_color_R, values.game_WB_color_G, values.game_WB_color_B),
      suffixColor: rgbToHex(values.game_WA_color_R, values.game_WA_color_G, values.game_WA_color_B),
      fightAttack: normalizeHotkey(values.game_gong, 'G'),
      fightDefend: normalizeHotkey(values.game_fang, 'F'),
      fightMagic: normalizeHotkey(values.game_shu, 'S'),
      fightItem: normalizeHotkey(values.game_wu, 'W'),
      fightEscape: normalizeHotkey(values.game_tao, 'T'),
      wordChoice1: normalizeHotkey(values.game_word1, 'Y'),
      wordChoice2: normalizeHotkey(values.game_word2, 'H'),
      wordChoice3: normalizeHotkey(values.game_word3, 'N'),
      mgPop: values.mg_pop === '1',
    };
  } catch {
    return null;
  }
}

function rgbToHex(r, g, b) {
  const to = (v) => Math.min(255, Math.max(0, Number(v) || 0)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function normalizeHotkey(value, fallback) {
  const key = String(value || fallback).trim();
  if (!key) return fallback.toUpperCase();
  if (key.toLowerCase() === 'del') return 'Del';
  return key.length === 1 ? key.toUpperCase() : key;
}

exports.REP_OPTIONS = REP_OPTIONS;
exports.PAGE_THEME_OPTIONS = PAGE_THEME_OPTIONS;
exports.normalizePageTheme = normalizePageTheme;
exports.applyPageTheme = applyPageTheme;
exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.loadSetTxtDefaults = loadSetTxtDefaults;

});

__wgDef("goods-data.js", function (exports) {
let _data = null;

 async function loadGameData() {
  if (_data) return _data;
  const res = await fetch('data/game-data.json');
  if (!res.ok) throw new Error('\u65e0\u6cd5\u52a0\u8f7d\u6e38\u620f\u6570\u636e');
  _data = await res.json();
  return _data;
}

 function getGameData() {
  return _data;
}

 function getGoodsInfo(name) {
  const info = _data?.goodsByName?.[name];
  if (info) {
    return {
      ...info,
      price: (info.priceNum ?? Number(info.price)) || 0,
    };
  }
  return { price: 50, priceNum: 50, category: 'misc', desc: '', name };
}

 function getGoodsById(id) {
  return _data?.goodsById?.[String(id)] || null;
}

 function getShop(tradeId) {
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

 function getCraftConfig() {
  return _data?.craft || {};
}

 function getSkillBookMap() {
  return _data?.skillBooks || {};
}

 function getShopQuote(mode) {
  const list = _data?.shopQuotes?.[mode] || ['\u6b22\u8fce\u5149\u4e34'];
  return list[Math.floor(Math.random() * list.length)];
}

const SHOP_TYPE_MASK = {
  weapon: 16,
  equipment: 1,
  medicine: 2,
  misc: 64,
};

 function shopCategoryType(category) {
  return SHOP_TYPE_MASK[category] || 64;
}

/** goods.txt: negative price = not sellable; price 0 on type-64 = quest token/key. */
 function isGoodsSellable(goodsInfo) {
  if (!goodsInfo) return false;
  if (goodsInfo.sellable === false) return false;
  const priceNum = Number(goodsInfo.priceNum ?? goodsInfo.price);
  if (Number.isFinite(priceNum) && priceNum < 0) return false;
  const typeNum = Number(goodsInfo.typeNum ?? goodsInfo.type) || 0;
  if (priceNum === 0 && (typeNum & 64) === 64) return false;
  return true;
}

 function canSellInShop(goodsInfo, shopCategory) {
  if (!isGoodsSellable(goodsInfo)) return false;
  const typeNum = Number(goodsInfo.typeNum ?? goodsInfo.type) || 0;
  const mask = shopCategoryType(shopCategory);
  if ((typeNum & 8) === 8) return true;
  return (typeNum & mask) === mask;
}

 function calcBuyPrice(basePrice, discount) {
  return Math.max(1, Math.floor(Number(basePrice) * discount / 10));
}

 function calcSellPrice(basePrice, discount) {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.max(0, Math.floor(base * discount / 10));
}

 function randomDiscount(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

 function parseMonsterRaw(raw) {
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

 function getMonsterEntry(typeId) {
  return _data?.monsters?.[String(typeId)] || null;
}

 function resolveMonsterStats(typeId) {
  const entry = getMonsterEntry(typeId);
  if (!entry) return null;
  if (entry.raw.startsWith('(')) return null;
  return parseMonsterRaw(entry.raw);
}

 function buildMonsterRoster(monsterType, popCount = 1) {
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

 function getMonsterIconUrl(icon) {
  const n = Number(icon);
  if (Number.isNaN(n)) return null;
  return `data/img/${n}.bmp`;
}

 function getGoodsIconUrl(goodsId) {
  const id = Number(goodsId);
  if (!id) return null;
  return `data/sml/${id}.bmp`;
}

 function formatGoodsSummary(item) {
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

exports.loadGameData = loadGameData;
exports.getGameData = getGameData;
exports.getGoodsInfo = getGoodsInfo;
exports.getGoodsById = getGoodsById;
exports.getShop = getShop;
exports.getCraftConfig = getCraftConfig;
exports.getSkillBookMap = getSkillBookMap;
exports.getShopQuote = getShopQuote;
exports.shopCategoryType = shopCategoryType;
exports.isGoodsSellable = isGoodsSellable;
exports.canSellInShop = canSellInShop;
exports.calcBuyPrice = calcBuyPrice;
exports.calcSellPrice = calcSellPrice;
exports.randomDiscount = randomDiscount;
exports.parseMonsterRaw = parseMonsterRaw;
exports.getMonsterEntry = getMonsterEntry;
exports.resolveMonsterStats = resolveMonsterStats;
exports.buildMonsterRoster = buildMonsterRoster;
exports.getMonsterIconUrl = getMonsterIconUrl;
exports.getGoodsIconUrl = getGoodsIconUrl;
exports.formatGoodsSummary = formatGoodsSummary;

});

__wgDef("game-config.js", function (exports) {
const { fetchDecodedText } = __wgImport("text-encoding.js", {"fetchDecodedText":"fetchDecodedText"});

let _config = null;
const _includeCache = new Map();

 async function loadGameConfig() {
  if (_config) return _config;
  const res = await fetch('data/config.json');
  if (!res.ok) throw new Error('\u65e0\u6cd5\u52a0\u8f7d\u914d\u7f6e\u6587\u4ef6');
  _config = await res.json();
  return _config;
}

 function getGameConfig() {
  return _config;
}

 function getTaskInfo(id) {
  return _config?.tasks?.[String(id)] || null;
}

 function getSpecialItemScript(name) {
  return _config?.specialItems?.[name] || null;
}

 function getTouxianRank(index) {
  const ranks = _config?.touxian?.ranks || [];
  return ranks[index] || '';
}

 function getPersonaTemplate(name) {
  return _config?.personaTemplates?.[name] || null;
}

 function getPersonaFile(name) {
  return _config?.personaMap?.[name] || null;
}

 function getMineOres() {
  return _config?.mineOres || [];
}

 function getHerbOres() {
  return _config?.herbOres || [];
}

 function getReadTextLine(index, state) {
  const lines = _config?.readLines || [];
  if (!lines.length) return '';
  if (index === 0 || index >= lines.length) {
    const pick = Math.floor(Math.random() * lines.length);
    if (state) state.readTextIndex = pick;
    return lines[pick];
  }
  if (state) state.readTextIndex = index;
  return lines[index] || lines[0];
}

 function getIncludeCache(name) {
  const key = String(name || '').replace(/\.(upp|txt)$/i, '');
  return _config?.includeCache?.[key] || '';
}

/** Maze marker + reading snippet used by `game_include_str('biao_yuedu.upp')`. */
 function getBiaoYueduHtml() {
  return getIncludeCache('biao_yuedu');
}

 async function fetchIncludeText(fileBase) {
  const key = String(fileBase || '').replace(/\.(upp|txt)$/i, '');
  if (_includeCache.has(key)) return _includeCache.get(key);

  const mapped = _config?.includeFiles?.[key];
  const url = mapped || `data/upp/dat/${key}.txt`;
  try {
    const text = await fetchDecodedText(url);
    _includeCache.set(key, text);
    return text;
  } catch {
    return '';
  }
}

 function resolveMediaPath(raw) {
  if (!raw) return '';
  let src = String(raw).trim().replace(/\\/g, '/');
  src = src.replace(/^\$apppath\$/i, '');
  src = src.replace(/^img[/\\]/i, 'data/img/');
  src = src.replace(/^gif[/\\]/i, 'data/gif/');
  src = src.replace(/^music[/\\]/i, 'data/music/');
  src = src.replace(/^dat[/\\]/i, 'data/upp/dat/');
  if (!src.startsWith('data/') && !/^https?:\/\//i.test(src)) {
    if (/\.(mid|wav)$/i.test(src)) src = `data/music/${src.split('/').pop()}`;
    else if (/\.gif$/i.test(src)) src = `data/gif/${src.split('/').pop()}`;
    else src = `data/img/${src.split('/').pop()}`;
  }
  return src;
}

exports.loadGameConfig = loadGameConfig;
exports.getGameConfig = getGameConfig;
exports.getTaskInfo = getTaskInfo;
exports.getSpecialItemScript = getSpecialItemScript;
exports.getTouxianRank = getTouxianRank;
exports.getPersonaTemplate = getPersonaTemplate;
exports.getPersonaFile = getPersonaFile;
exports.getMineOres = getMineOres;
exports.getHerbOres = getHerbOres;
exports.getReadTextLine = getReadTextLine;
exports.getIncludeCache = getIncludeCache;
exports.getBiaoYueduHtml = getBiaoYueduHtml;
exports.fetchIncludeText = fetchIncludeText;
exports.resolveMediaPath = resolveMediaPath;

});

__wgDef("game-runtime.js", function (exports) {
const { getGameConfig, getPersonaTemplate } = __wgImport("game-config.js", {"getGameConfig":"getGameConfig","getPersonaTemplate":"getPersonaTemplate"});
const { getGoodsInfo } = __wgImport("goods-data.js", {"getGoodsInfo":"getGoodsInfo"});
const { applyTemplateEquipment, ensureRoleArrays, initRoleFromTemplate } = __wgImport("inventory-system.js", {"applyTemplateEquipment":"applyTemplateEquipment","ensureRoleArrays":"ensureRoleArrays","initRoleFromTemplate":"initRoleFromTemplate"});

 const STAT = {
  money: 0,
  luck: 1,
  speed: 2,
  attack: 3,
  hide: 4,
  tili: 5,
  lingli: 6,
  intellect: 7,
  life: 8,
  morality: 9,
  weiwang: 10,
  character: 11,
  sex: 12,
  cupidity: 13,
  love: 14,
  loveme: 15,
  believeMe: 16,
  believe: 17,
  fuzu: 18,
  experience: 19,
  defend: 20,
  face: 21,
  talk22: 22,
  talkid23: 23,
  upgrade: 24,
  gdtl25: 25,
  gdll26: 26,
  gdsmz27: 27,
  grade: 28,
  tmpHide: 29,
  yanchi30: 30,
  linshifang: 31,
  iconIndex: 32,
  touxian: 33,
};

const GOODS_TYPE_ICON = [
  [1, 'img_w_1.gif'],
  [2, 'img_w_2.gif'],
  [4, 'img_w_4.gif'],
  [8, 'img_w_8.gif'],
  [16, 'img_w_16.gif'],
  [32, 'img_w_32.gif'],
  [64, 'img_w_64.gif'],
  [128, 'img_w_128.gif'],
  [256, 'img_w_256.gif'],
];

function padArray(raw, len, fill = 0) {
  const a = Array.isArray(raw) ? raw.slice(0, len) : [];
  while (a.length < len) a.push(fill);
  return a;
}

/** Deep-copy a party role so save snapshots cannot be mutated in place. */
 function cloneRole(role) {
  if (!role) return null;
  return {
    oldName: role.oldName || role.name,
    name: role.name || role.oldName,
    stats: padArray(role.stats, 64),
    equip: padArray(role.equip, 10),
    ji: padArray(role.ji, 24),
    fa: padArray(role.fa, 64),
    hidden: role.hidden ?? 1,
    savedHidden: role.savedHidden ?? 1,
    equipBootstrapped: role.equipBootstrapped ?? true,
  };
}

 function ensureDepartedFriends(state) {
  if (!state.departedFriends || typeof state.departedFriends !== 'object' || Array.isArray(state.departedFriends)) {
    state.departedFriends = {};
  }
  return state.departedFriends;
}

/** Original del_friend writes the persona to dat\; remake keeps it on the save. */
 function storeDepartedFriend(state, role) {
  if (!role) return;
  const store = ensureDepartedFriends(state);
  const key = role.oldName || role.name;
  if (key) store[key] = cloneRole(role);
}

 function findDepartedFriend(state, name) {
  const store = ensureDepartedFriends(state);
  if (store[name]) return store[name];
  return Object.values(store).find((r) => r.oldName === name || r.name === name) || null;
}

/**
 * Original initialize_role(n, new): new=0 loads dat\ if present; new=1 uses the template.
 * Current party members are already serialized on save.party.
 */
 function createJoinedRole(state, name, mode) {
  if (Number(mode) === 0) {
    const saved = findDepartedFriend(state, name);
    if (saved) return cloneRole(saved);
  }
  return createRoleFromTemplate(name, name);
}

let ensuringParty = false;

function hasParty(state) {
  return Array.isArray(state?.party) && state.party.length > 0;
}

 function ensureParty(state) {
  if (ensuringParty) {
    if (!hasParty(state)) {
      state.party = [createRoleFromTemplate('\u65e0\u540d', state.player?.name || '\u65e0\u540d')];
    }
    return;
  }
  ensuringParty = true;
  try {
    if (!hasParty(state)) {
      state.party = [createRoleFromTemplate('\u65e0\u540d', state.player?.name || '\u65e0\u540d')];
    }
    state.party.forEach((role) => ensureRoleArrays(role));
    if (!Array.isArray(state.friendList)) state.friendList = [];
    ensureDepartedFriends(state);
    if (!state.temp || typeof state.temp !== 'object') state.temp = {};
    if (!state.tempStrings || typeof state.tempStrings !== 'object') state.tempStrings = {};
    if (!state.sceneEvents || typeof state.sceneEvents !== 'object') state.sceneEvents = {};
    if (!state.resEvents || typeof state.resEvents !== 'object') state.resEvents = {};
    syncPlayerFromRole(state, 0);
  } finally {
    ensuringParty = false;
  }
}

 function createRoleFromTemplate(oldName, displayName) {
  const tpl = getPersonaTemplate(oldName);
  const stats = tpl?.stats?.length >= 64 ? [...tpl.stats.slice(0, 64)] : defaultStats();
  if (displayName) stats[STAT.money] = stats[STAT.money] || 50;
  const role = {
    oldName: tpl?.oldName || oldName,
    name: displayName || tpl?.name || oldName,
    stats,
    equip: new Array(10).fill(0),
    ji: new Array(24).fill(0),
    fa: new Array(64).fill(0),
    hidden: 1,
    savedHidden: 1,
  };
  if (tpl) initRoleFromTemplate(role, tpl, displayName || tpl.name || oldName);
  return role;
}

 function bootstrapRoleStats(state, roleIndex = 0) {
  const role = state.party?.[roleIndex];
  if (!role || role.equipBootstrapped) return;
  ensureRoleArrays(role);
  applyTemplateEquipment(state, roleIndex, role);
  role.equipBootstrapped = true;
}

function defaultStats() {
  const s = new Array(64).fill(0);
  s[STAT.money] = 50;
  s[STAT.life] = 100;
  s[STAT.gdsmz27] = 100;
  s[STAT.lingli] = 50;
  s[STAT.gdll26] = 50;
  s[STAT.grade] = 1;
  s[STAT.sex] = 1;
  s[STAT.hide] = 1;
  return s;
}

 function getRoleCount(state) {
  ensureParty(state);
  return state.party.length;
}

/** Maze travel: deduct maxTili * wordCount * 1% per party member; stamina floors at 0. */
 function deductPartyTiliForMazeTravel(state, wordCount) {
  deductPartyTiliByMaxPercent(state, wordCount);
}

/** Inter-city travel: deduct maxTili * percent / 100 per member; never blocks travel. */
 function deductPartyTiliForCityTravel(state, percentOfMax) {
  deductPartyTiliByMaxPercent(state, percentOfMax);
}

function deductPartyTiliByMaxPercent(state, percentOfMax) {
  const p = Math.max(1, Number(percentOfMax) || 1);
  for (let i = 0; i < getRoleCount(state); i += 1) {
    const max = readValues(state, i, STAT.gdtl25);
    const cur = readValues(state, i, STAT.tili);
    const cost = Math.floor((max * p) / 100);
    writeValues(state, i, STAT.tili, Math.max(0, cur - cost));
  }
  syncPlayerFromRole(state, 0);
}

 function getRoleH(state) {
  return getRoleCount(state) - 1;
}

 function findRoleIndex(state, oldName) {
  ensureParty(state);
  return state.party.findIndex((r) => r.oldName === oldName || r.name === oldName);
}

 function readValues(state, roleIndex, statIndex) {
  if (!hasParty(state)) ensureParty(state);
  if (roleIndex < 0 || roleIndex >= state.party.length) return 0;
  return Number(state.party[roleIndex].stats[statIndex]) || 0;
}

 function writeValues(state, roleIndex, statIndex, value) {
  if (!hasParty(state)) ensureParty(state);
  if (roleIndex < 0 || roleIndex >= state.party.length) return false;
  state.party[roleIndex].stats[statIndex] = Math.max(0, Number(value) || 0);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
  return true;
}

 function syncPlayerFromRole(state, roleIndex = 0) {
  const role = state.party[roleIndex];
  if (!role || !state.player) return;
  state.player.name = role.name;
  state.player.money = readValues(state, roleIndex, STAT.money);
  state.player.hp = readValues(state, roleIndex, STAT.life);
  state.player.maxHp = readValues(state, roleIndex, STAT.gdsmz27) || state.player.hp;
  state.player.mp = readValues(state, roleIndex, STAT.lingli);
  state.player.maxMp = readValues(state, roleIndex, STAT.gdll26) || state.player.mp;
  state.player.exp = readValues(state, roleIndex, STAT.experience);
  state.player.level = readValues(state, roleIndex, STAT.grade) || 1;
  state.player.sex = readValues(state, roleIndex, STAT.sex) === 0 ? 0 : 1;
  state.partyCount = state.party.length;
}

 function syncRoleFromPlayer(state, roleIndex = 0) {
  const p = state.player;
  if (!p) return;
  writeValues(state, roleIndex, STAT.money, p.money);
  writeValues(state, roleIndex, STAT.life, p.hp);
  writeValues(state, roleIndex, STAT.gdsmz27, p.maxHp);
  writeValues(state, roleIndex, STAT.lingli, p.mp);
  writeValues(state, roleIndex, STAT.gdll26, p.maxMp);
  writeValues(state, roleIndex, STAT.experience, p.exp);
  writeValues(state, roleIndex, STAT.grade, p.level);
  writeValues(state, roleIndex, STAT.sex, p.sex ?? 1);
  if (state.party[roleIndex]) state.party[roleIndex].name = p.name;
}

 function getRoleDisplayName(state, roleIndex) {
  ensureParty(state);
  const idx = (roleIndex <= 0 ? 1 : roleIndex) - 1;
  const role = state.party[idx];
  if (!role) return ' ';
  const rank = readValues(state, idx, STAT.touxian);
  if (rank > 0) {
    const title = getGameConfig()?.touxian?.ranks?.[rank - 1] || '';
    if (title) return `${role.name}(${title})`;
  }
  return role.name;
}

 function getGoodsTypeIcon(name) {
  const info = getGoodsInfo(name);
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  for (const [mask, icon] of GOODS_TYPE_ICON) {
    if (typeNum & mask) return icon;
  }
  return 'img_w_0.gif';
}

 function gameBaseRandom(max) {
  const n = Math.max(1, Number(max) || 1);
  return 1 + Math.floor(Math.random() * n);
}

/** Same range as Delphi Game_base_random: 0 .. max-1 */
 function gameBaseRandomZero(max) {
  const n = Math.max(1, Number(max) || 1);
  return Math.floor(Math.random() * n);
}

 function gameRandomChance(state, max) {
  let n = Math.max(1, Number(max) || 1);
  if (gameBaseRandom(n) === 1) return true;
  const luck = readValues(state, 0, STAT.luck);
  const intellect = readValues(state, 0, STAT.intellect);
  n = n * 5 + Math.round(Math.abs(1 - Math.abs((luck + intellect - 100) / 100)) * n * 10);
  return gameBaseRandom(Math.max(1, n)) === 1;
}

 function parseEventIdList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

 function sceneEventValue(state, id) {
  const v = state.sceneEvents[id];
  return v === undefined || v === null ? 0 : Number(v) || 0;
}

 function resEventValue(state, id) {
  const v = state.resEvents[id];
  return v === undefined || v === null ? 0 : Number(v) || 0;
}

exports.STAT = STAT;
exports.cloneRole = cloneRole;
exports.ensureDepartedFriends = ensureDepartedFriends;
exports.storeDepartedFriend = storeDepartedFriend;
exports.findDepartedFriend = findDepartedFriend;
exports.createJoinedRole = createJoinedRole;
exports.ensureParty = ensureParty;
exports.createRoleFromTemplate = createRoleFromTemplate;
exports.bootstrapRoleStats = bootstrapRoleStats;
exports.getRoleCount = getRoleCount;
exports.deductPartyTiliForMazeTravel = deductPartyTiliForMazeTravel;
exports.deductPartyTiliForCityTravel = deductPartyTiliForCityTravel;
exports.getRoleH = getRoleH;
exports.findRoleIndex = findRoleIndex;
exports.readValues = readValues;
exports.writeValues = writeValues;
exports.syncPlayerFromRole = syncPlayerFromRole;
exports.syncRoleFromPlayer = syncRoleFromPlayer;
exports.getRoleDisplayName = getRoleDisplayName;
exports.getGoodsTypeIcon = getGoodsTypeIcon;
exports.gameBaseRandom = gameBaseRandom;
exports.gameBaseRandomZero = gameBaseRandomZero;
exports.gameRandomChance = gameRandomChance;
exports.parseEventIdList = parseEventIdList;
exports.sceneEventValue = sceneEventValue;
exports.resEventValue = resEventValue;

});

__wgDef("inventory-system.js", function (exports) {
const { getGoodsById, getGoodsInfo } = __wgImport("goods-data.js", {"getGoodsById":"getGoodsById","getGoodsInfo":"getGoodsInfo"});
const { getSpecialItemScript } = __wgImport("game-config.js", {"getSpecialItemScript":"getSpecialItemScript"});
const { readValues, writeValues, STAT, syncPlayerFromRole } = __wgImport("game-runtime.js", {"readValues":"readValues","writeValues":"writeValues","STAT":"STAT","syncPlayerFromRole":"syncPlayerFromRole"});

/** Max stack per item type (all acquisition paths). */
 const MAX_GOODS_STACK = 999;

 const EQUIP_SLOTS = {
  1: '\u5934\u6234',
  2: '\u8eab\u7a7f',
  3: '\u62ab\u98ce',
  4: '\u811a\u7a7f',
  5: '\u62a4\u8155',
  6: '\u6212\u6307',
  7: '\u9879\u94fe',
  8: '\u6b66\u5668',
  9: '\u8170\u6302',
};

const GOODS_FIELD = {
  f1: 'defense',
  t1: 'hp',
  L1: 'magic',
  s1: 'speed',
  m1: 'luck',
  g1: 'attack',
  z1: 'intel',
  y1: 'fortune',
  n1: 'durability',
  j1: 'price',
};

 function getGoodsStat(info, field) {
  if (!info) return 0;
  const key = GOODS_FIELD[field] || field;
  return Number(info[key]) || 0;
}

 function getGoodsStatById(id, field) {
  return getGoodsStat(getGoodsById(id), field);
}

 function decodeSkillId(entry) {
  return Number(entry) & 0xffff;
}

 function decodeSkillLevel(entry) {
  return (Number(entry) >>> 24) & 0xff;
}

 function decodeSkillUses(entry) {
  return (Number(entry) >>> 16) & 0xff;
}

 function encodeSkillEntry(goodsId, level = 1) {
  return ((level & 0xff) << 24) | (Number(goodsId) & 0xffff);
}

 function ensureRoleArrays(role) {
  if (!Array.isArray(role.equip) || role.equip.length < 10) {
    role.equip = new Array(10).fill(0);
  }
  if (!Array.isArray(role.ji) || role.ji.length < 24) {
    role.ji = new Array(24).fill(0);
  }
  if (!Array.isArray(role.fa) || role.fa.length < 64) {
    role.fa = new Array(64).fill(0);
  }
}

 function getRoleLevel(state, roleIndex) {
  return readValues(state, roleIndex, STAT.grade) || 1;
}

 function getRoleSex(state, roleIndex) {
  return readValues(state, roleIndex, STAT.sex) === 0 ? 0 : 1;
}

 function isGenderMatch(n1Value, roleSex) {
  const code = Number(n1Value) || 0;
  if (code > 300) return true;
  if (code > 200) return roleSex === 0;
  return roleSex === 1;
}

 function getEquipSlotFromGoods(info) {
  if (!info) return 0;
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  if (typeNum & 16) return 8;
  if (typeNum & 1) {
    const slot = Number(info.durability) % 100;
    return slot >= 1 && slot <= 9 ? slot : 0;
  }
  return 0;
}

 function canEquipGoods(state, roleIndex, goodsId) {
  const info = getGoodsById(goodsId);
  if (!info) return { ok: false, reason: '\u7269\u54c1\u4e0d\u5b58\u5728' };
  const slot = getEquipSlotFromGoods(info);
  if (!slot) return { ok: false, reason: '\u8be5\u7269\u54c1\u4e0d\u80fd\u88c5\u5907' };

  const n1 = getGoodsStat(info, 'n1');
  const levelReq = getGoodsStat(info, 'y1');
  const roleSex = getRoleSex(state, roleIndex);
  const roleLevel = getRoleLevel(state, roleIndex);

  if (!isGenderMatch(n1, roleSex)) {
    return { ok: false, reason: '\u6027\u522b\u4e0d\u5339\u914d' };
  }

  const slotMod = n1 % 100;
  if (slotMod < 5 && levelReq > roleLevel) {
    return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
  }

  if ((Number(info.typeNum ?? info.type) || 0) & 16) {
    if (levelReq > roleLevel) {
      return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
    }
  }

  return { ok: true, slot };
}

function clampVitals(state, roleIndex) {
  const life = readValues(state, roleIndex, STAT.life);
  const maxLife = readValues(state, roleIndex, STAT.gdsmz27);
  if (life > maxLife) writeValues(state, roleIndex, STAT.life, maxLife);

  const tili = readValues(state, roleIndex, STAT.tili);
  const maxTili = readValues(state, roleIndex, STAT.gdtl25);
  if (tili > maxTili) writeValues(state, roleIndex, STAT.tili, maxTili);

  const lingli = readValues(state, roleIndex, STAT.lingli);
  const maxLingli = readValues(state, roleIndex, STAT.gdll26);
  if (lingli > maxLingli) writeValues(state, roleIndex, STAT.lingli, maxLingli);
}

 function applyEquipStats(state, roleIndex, goodsId, add) {
  if (!goodsId) return;
  const info = getGoodsById(goodsId);
  if (!info) return;
  const sign = add ? 1 : -1;
  const changes = [
    [STAT.luck, 'y1'],
    [STAT.speed, 's1'],
    [STAT.attack, 'g1'],
    [STAT.intellect, 'z1'],
    [STAT.defend, 'f1'],
    [STAT.gdtl25, 't1'],
    [STAT.gdll26, 'L1'],
    [STAT.gdsmz27, 'm1'],
  ];
  for (const [stat, field] of changes) {
    const delta = getGoodsStat(info, field) * sign;
    if (delta) writeValues(state, roleIndex, stat, readValues(state, roleIndex, stat) + delta);
  }
  if (!add) clampVitals(state, roleIndex);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

 function applyConsumableStats(state, roleIndex, goodsId) {
  const info = getGoodsById(goodsId);
  if (!info) return;
  const changes = [
    [STAT.luck, 'y1'],
    [STAT.speed, 's1'],
    [STAT.attack, 'g1'],
    [STAT.intellect, 'z1'],
    [STAT.defend, 'f1'],
    [STAT.tili, 't1'],
    [STAT.lingli, 'L1'],
    [STAT.life, 'm1'],
  ];
  for (const [stat, field] of changes) {
    const delta = getGoodsStat(info, field);
    if (delta) writeValues(state, roleIndex, stat, readValues(state, roleIndex, stat) + delta);
  }
  clampVitals(state, roleIndex);
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

 function getGoodsCountByName(state, name) {
  return state.player?.goods?.[name] || 0;
}

 function clampGoodsStack(count) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return 0;
  return Math.min(MAX_GOODS_STACK, n);
}

/** Clamp every stack when loading saves or imports. */
 function normalizePlayerGoods(player) {
  if (!player?.goods || typeof player.goods !== 'object') return;
  for (const [name, count] of Object.entries(player.goods)) {
    const clamped = clampGoodsStack(count);
    if (clamped <= 0) delete player.goods[name];
    else player.goods[name] = clamped;
  }
}

/**
 * Change inventory count by name. Returns applied delta (may be less than requested when capped at 999).
 */
 function changeGoodsByName(state, name, delta) {
  if (!state.player.goods) state.player.goods = {};
  const cur = getGoodsCountByName(state, name);
  const d = Math.floor(Number(delta) || 0);
  if (d === 0) return 0;

  if (d > 0) {
    const room = MAX_GOODS_STACK - cur;
    if (room <= 0) return 0;
    const applied = Math.min(d, room);
    state.player.goods[name] = cur + applied;
    return applied;
  }

  const next = cur + d;
  if (next <= 0) {
    delete state.player.goods[name];
    return -cur;
  }
  state.player.goods[name] = next;
  return d;
}

 function resolveGoodsId(nameOrId) {
  if (typeof nameOrId === 'number') return nameOrId;
  const n = Number(nameOrId);
  if (n > 0 && getGoodsById(n)) return n;
  return getGoodsInfo(nameOrId).id || 0;
}

 function listInventoryByCategory(state) {
  const goods = state.player?.goods || {};
  const buckets = {
    weapon: [],
    equipment: [],
    medicine: [],
    craft: [],
    special: [],
  };

  for (const [name, count] of Object.entries(goods)) {
    if (!count) continue;
    const info = getGoodsInfo(name);
    const typeNum = Number(info.typeNum ?? info.type) || 0;
    const entry = { name, count, info, id: info.id || resolveGoodsId(name) };
    if (typeNum & 16) buckets.weapon.push(entry);
    else if (typeNum & 1) buckets.equipment.push(entry);
    else if (typeNum & 2) buckets.medicine.push(entry);
    else if (typeNum & 8) buckets.craft.push(entry);
    else if (typeNum & 128 || typeNum & 64 || typeNum & 4 || typeNum & 256) buckets.special.push(entry);
    else buckets.special.push(entry);
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  return buckets;
}

 function getEquippedGoods(state, roleIndex) {
  const role = state.party?.[roleIndex];
  if (!role) return {};
  ensureRoleArrays(role);
  const out = {};
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = role.equip[slot] || 0;
    if (id) out[slot] = getGoodsById(id);
  }
  return out;
}

 function equipGoods(state, roleIndex, goodsName) {
  const role = state.party?.[roleIndex];
  if (!role) return { ok: false, reason: '\u89d2\u8272\u4e0d\u5b58\u5728' };
  ensureRoleArrays(role);

  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };

  const goodsId = resolveGoodsId(goodsName);
  const check = canEquipGoods(state, roleIndex, goodsId);
  if (!check.ok) return check;

  const slot = check.slot;
  const prev = role.equip[slot] || 0;
  if (prev) {
    applyEquipStats(state, roleIndex, prev, false);
    const prevInfo = getGoodsById(prev);
    if (prevInfo?.name) changeGoodsByName(state, prevInfo.name, 1);
  }

  changeGoodsByName(state, goodsName, -1);
  role.equip[slot] = goodsId;
  applyEquipStats(state, roleIndex, goodsId, true);
  return { ok: true, slot };
}

 function unequipSlot(state, roleIndex, slot) {
  const role = state.party?.[roleIndex];
  if (!role) return { ok: false, reason: '\u89d2\u8272\u4e0d\u5b58\u5728' };
  ensureRoleArrays(role);
  const goodsId = role.equip[slot] || 0;
  if (!goodsId) return { ok: false, reason: '\u6ca1\u6709\u88c5\u5907' };

  applyEquipStats(state, roleIndex, goodsId, false);
  role.equip[slot] = 0;
  const info = getGoodsById(goodsId);
  if (info?.name) changeGoodsByName(state, info.name, 1);
  return { ok: true };
}

 function dropGoods(state, goodsName, dropAll = true) {
  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  changeGoodsByName(state, goodsName, dropAll ? -count : -1);
  return { ok: true };
}

 function useMedicine(state, roleIndex, goodsName) {
  const count = getGoodsCountByName(state, goodsName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  const info = getGoodsInfo(goodsName);
  const typeNum = Number(info.typeNum ?? info.type) || 0;
  if (!(typeNum & 2)) return { ok: false, reason: '\u4e0d\u662f\u836f\u54c1' };

  changeGoodsByName(state, goodsName, -1);
  applyConsumableStats(state, roleIndex, info.id || resolveGoodsId(goodsName));
  return { ok: true };
}

 function addJi(role, goodsId) {
  ensureRoleArrays(role);
  for (let i = 0; i < role.ji.length; i += 1) {
    if (!role.ji[i]) {
      role.ji[i] = encodeSkillEntry(goodsId, 1);
      return true;
    }
    if (decodeSkillId(role.ji[i]) === goodsId) return false;
  }
  return false;
}

 function addFa(role, goodsId) {
  ensureRoleArrays(role);
  for (let i = 0; i < role.fa.length; i += 1) {
    if (!role.fa[i]) {
      role.fa[i] = encodeSkillEntry(goodsId, 1);
      return true;
    }
    if (decodeSkillId(role.fa[i]) === goodsId) return false;
  }
  return false;
}

 function learnSkillBook(state, roleIndex, bookName) {
  const count = getGoodsCountByName(state, bookName);
  if (count <= 0) return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };

  const book = getGoodsInfo(bookName);
  const typeNum = Number(book.typeNum ?? book.type) || 0;
  if (!(typeNum & 128)) return { ok: false, reason: '\u4e0d\u662f\u79d8\u7c4d' };

  const skillId = resolveGoodsId(book.name);
  const skillInfo = getGoodsById(skillId) || book;
  const sexReq = getGoodsStat(skillInfo, 'f1');
  const roleSex = getRoleSex(state, roleIndex);
  if (sexReq !== 3 && roleSex !== sexReq) {
    return { ok: false, reason: sexReq === 1 ? '\u53ea\u9002\u5408\u7537\u6027' : '\u53ea\u9002\u5408\u5973\u6027' };
  }

  const levelReq = getGoodsStat(skillInfo, 'n1');
  if (levelReq > getRoleLevel(state, roleIndex)) {
    return { ok: false, reason: `\u9700\u8981 ${levelReq} \u7ea7` };
  }

  const role = state.party[roleIndex];
  ensureRoleArrays(role);
  const isJi = getGoodsStat(skillInfo, 'j1') === 3;
  const learned = isJi ? addJi(role, skillId) : addFa(role, skillId);
  if (!learned) return { ok: false, reason: '\u5df2\u7ecf\u5b66\u4f1a' };

  changeGoodsByName(state, bookName, -1);
  return { ok: true, kind: isJi ? 'ji' : 'fa' };
}

 function listSkills(role) {
  ensureRoleArrays(role);
  const ji = [];
  const fa = [];
  for (const entry of role.ji) {
    if (!entry) continue;
    const id = decodeSkillId(entry);
    const info = getGoodsById(id);
    ji.push({ id, level: decodeSkillLevel(entry), name: info?.name || `#${id}`, info });
  }
  for (const entry of role.fa) {
    if (!entry) continue;
    const id = decodeSkillId(entry);
    const info = getGoodsById(id);
    fa.push({ id, level: decodeSkillLevel(entry), name: info?.name || `#${id}`, info });
  }
  return { ji, fa };
}

 function applyTemplateEquipment(state, roleIndex, role) {
  ensureRoleArrays(role);
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = role.equip[slot] || 0;
    if (id) applyEquipStats(state, roleIndex, id, true);
  }
}

 function initRoleFromTemplate(role, tpl, displayName) {
  ensureRoleArrays(role);
  if (tpl?.equip?.length) {
    for (let i = 0; i < 10; i += 1) {
      role.equip[i] = Number(tpl.equip[i]) || 0;
    }
  }
  if (tpl?.ji?.length) {
    for (let i = 0; i < 24; i += 1) role.ji[i] = Number(tpl.ji[i]) || 0;
  }
  if (tpl?.fa?.length) {
    for (let i = 0; i < 64; i += 1) role.fa[i] = Number(tpl.fa[i]) || 0;
  }
  if (displayName) role.name = displayName;
  if (tpl?.oldName) role.oldName = tpl.oldName;
}

 async function useSpecialGoods(api, roleIndex, goodsName) {
  const script = getSpecialItemScript(goodsName);
  if (!script) return { ok: false, reason: '\u8be5\u7269\u54c1\u4e0d\u80fd\u5728\u6b64\u4f7f\u7528' };
  if (getGoodsCountByName(api.state, goodsName) <= 0) {
    return { ok: false, reason: '\u7269\u54c1\u4e0d\u8db3' };
  }

  changeGoodsByName(api.state, goodsName, -1);
  const prepared = script.replace(/\$P\$/g, String(roleIndex + 1));
  await api.runScript(prepared);
  api.ui.refreshStatus();
  api.persist();
  return { ok: true };
}

exports.MAX_GOODS_STACK = MAX_GOODS_STACK;
exports.EQUIP_SLOTS = EQUIP_SLOTS;
exports.getGoodsStat = getGoodsStat;
exports.getGoodsStatById = getGoodsStatById;
exports.decodeSkillId = decodeSkillId;
exports.decodeSkillLevel = decodeSkillLevel;
exports.decodeSkillUses = decodeSkillUses;
exports.encodeSkillEntry = encodeSkillEntry;
exports.ensureRoleArrays = ensureRoleArrays;
exports.getRoleLevel = getRoleLevel;
exports.getRoleSex = getRoleSex;
exports.isGenderMatch = isGenderMatch;
exports.getEquipSlotFromGoods = getEquipSlotFromGoods;
exports.canEquipGoods = canEquipGoods;
exports.applyEquipStats = applyEquipStats;
exports.applyConsumableStats = applyConsumableStats;
exports.getGoodsCountByName = getGoodsCountByName;
exports.clampGoodsStack = clampGoodsStack;
exports.normalizePlayerGoods = normalizePlayerGoods;
exports.changeGoodsByName = changeGoodsByName;
exports.resolveGoodsId = resolveGoodsId;
exports.listInventoryByCategory = listInventoryByCategory;
exports.getEquippedGoods = getEquippedGoods;
exports.equipGoods = equipGoods;
exports.unequipSlot = unequipSlot;
exports.dropGoods = dropGoods;
exports.useMedicine = useMedicine;
exports.addJi = addJi;
exports.addFa = addFa;
exports.learnSkillBook = learnSkillBook;
exports.listSkills = listSkills;
exports.applyTemplateEquipment = applyTemplateEquipment;
exports.initRoleFromTemplate = initRoleFromTemplate;
exports.useSpecialGoods = useSpecialGoods;

});

__wgDef("save-manager.js", function (exports) {
const { normalizePlayerGoods } = __wgImport("inventory-system.js", {"normalizePlayerGoods":"normalizePlayerGoods"});

/** Number of save slots (matches original save dialog list capacity). */
 const SAVE_SLOT_COUNT = 50;

const LEGACY_SAVE_KEY = 'wordgame-save-v1';
const INDEX_KEY = 'wordgame-save-index-v1';
const SLOT_KEY_PREFIX = 'wordgame-save-slot-';
const SLOT_KEY_SUFFIX = '-v1';

 function createDefaultPlayer() {
  return {
    name: '\u65e0\u540d',
    sex: 1,
    money: 50,
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    level: 1,
    exp: 0,
    goods: {},
    skills: {
      sword: { level: 0, uses: 0 },
      medicine: { level: 0, uses: 0 },
      equip: { level: 0, uses: 0 },
      hidden: { level: 0, uses: 0 },
    },
  };
}

 function createDefaultSave() {
  return {
    player: createDefaultPlayer(),
    party: null,
    friendList: [],
    departedFriends: {},
    sceneEvents: {},
    resEvents: {},
    tasks: {},
    dialogue: {},
    messages: [],
    partyCount: 1,
    temp: {},
    tempStrings: {},
    currentScene: 10000,
    currentSceneAttr: 0,
    oldScene: 10000,
    homeScene: 10001,
    mazeFactor: 0,
    weather: 0,
    readTextIndex: 0,
    noGoHome: false,
    chatLocked: false,
    gameTimer: null,
    gameTimeLeft: 0,
    gameTimePage: 0,
    deferredScript: '',
    pendingMazeWordTravelCost: 0,
    wordStats: { correct: 0, wrong: 0 },
    wordProgress: {},
    sequentialIndex: 0,
    abhsByLib: {},
    partSlotsByLib: {},
    started: false,
    savedAt: null,
    slotId: null,
  };
}

function slotStorageKey(slotId) {
  return `${SLOT_KEY_PREFIX}${slotId}${SLOT_KEY_SUFFIX}`;
}

function normalizeStats(raw) {
  const stats = Array.isArray(raw) ? raw.slice(0, 64) : [];
  while (stats.length < 64) stats.push(0);
  return stats;
}

function normalizeRole(role, fallbackName) {
  if (!role) return null;
  return {
    oldName: role.oldName || fallbackName || '\u65e0\u540d',
    name: role.name || fallbackName || '\u65e0\u540d',
    stats: normalizeStats(role.stats),
    equip: Array.isArray(role.equip) ? role.equip.slice(0, 10) : new Array(10).fill(0),
    ji: Array.isArray(role.ji) ? role.ji.slice(0, 24) : new Array(24).fill(0),
    fa: Array.isArray(role.fa) ? role.fa.slice(0, 64) : new Array(64).fill(0),
    hidden: role.hidden ?? 1,
    savedHidden: role.savedHidden ?? 1,
    equipBootstrapped: role.equipBootstrapped ?? true,
  };
}

 function normalizeSaveParty(save) {
  if (Array.isArray(save.party)) {
    save.party = save.party.map((role) => normalizeRole(role, save.player?.name));
  }
  if (!save.departedFriends || typeof save.departedFriends !== 'object' || Array.isArray(save.departedFriends)) {
    save.departedFriends = {};
  } else {
    const out = {};
    for (const [key, role] of Object.entries(save.departedFriends)) {
      const n = normalizeRole(role, key);
      if (n) out[n.oldName || key] = n;
    }
    save.departedFriends = out;
  }
  return save;
}

function normalizeLoadedSave(parsed) {
  const base = createDefaultSave();
  const save = normalizeSaveParty({
    ...base,
    ...parsed,
    player: {
      ...base.player,
      ...parsed.player,
      skills: {
        ...base.player.skills,
        ...(parsed.player?.skills || {}),
      },
    },
    party: parsed.party || base.party,
    friendList: parsed.friendList || base.friendList,
    departedFriends: parsed.departedFriends || base.departedFriends,
    tempStrings: parsed.tempStrings || base.tempStrings,
    sceneEvents: parsed.sceneEvents || base.sceneEvents,
    resEvents: parsed.resEvents || base.resEvents,
    tasks: parsed.tasks || base.tasks,
    messages: Array.isArray(parsed.messages) ? parsed.messages : base.messages,
    dialogue: parsed.dialogue || base.dialogue,
    wordProgress: parsed.wordProgress || base.wordProgress,
    abhsByLib: parsed.abhsByLib || base.abhsByLib,
    partSlotsByLib: parsed.partSlotsByLib || base.partSlotsByLib,
  });
  normalizePlayerGoods(save.player);
  return save;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatCompactTimestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

 function buildSlotLabel(save, sceneName = '') {
  const prefix = sceneName || '\u5b58\u6863';
  return `${prefix}${formatCompactTimestamp(save?.savedAt ? new Date(save.savedAt) : new Date())}`;
}

function emptyIndex() {
  return { activeSlotId: null, entries: {} };
}

 function loadSaveIndex() {
  migrateLegacySave();
  const idx = readJson(INDEX_KEY, emptyIndex());
  if (!idx.entries || typeof idx.entries !== 'object') idx.entries = {};
  if (!('activeSlotId' in idx)) idx.activeSlotId = null;
  return idx;
}

function writeSaveIndex(index) {
  writeJson(INDEX_KEY, index);
}

 function migrateLegacySave() {
  const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
  if (!legacy) return false;
  try {
    const parsed = JSON.parse(legacy);
    if (parsed?.started) {
      persistSaveToSlot(0, normalizeLoadedSave(parsed), { sceneName: '\u65e7\u6863\u6848' });
      writeSaveIndex({ ...loadSaveIndex(), activeSlotId: 0 });
    }
  } catch {
    /* ignore corrupt legacy save */
  }
  localStorage.removeItem(LEGACY_SAVE_KEY);
  return true;
}

 function getActiveSlotId() {
  const idx = loadSaveIndex();
  return Number.isInteger(idx.activeSlotId) ? idx.activeSlotId : null;
}

 function setActiveSlotId(slotId) {
  const idx = loadSaveIndex();
  idx.activeSlotId = slotId;
  writeSaveIndex(idx);
}

 function slotHasData(slotId) {
  return !!localStorage.getItem(slotStorageKey(slotId));
}

 function loadSlot(slotId) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SAVE_SLOT_COUNT) return null;
  try {
    const raw = localStorage.getItem(slotStorageKey(slotId));
    if (!raw) return null;
    return normalizeLoadedSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

 function getSlotMeta(slotId) {
  const idx = loadSaveIndex();
  const entry = idx.entries[String(slotId)];
  if (!entry) return null;
  return { slotId, ...entry };
}

 function listSaveSlots() {
  const idx = loadSaveIndex();
  const slots = [];
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    const meta = idx.entries[String(i)];
    const save = loadSlot(i);
    if (meta || save) {
      slots.push({
        slotId: i,
        label: meta?.label || buildSlotLabel(save),
        savedAt: meta?.savedAt || save?.savedAt || null,
        playerName: meta?.playerName || save?.player?.name || '\u65c5\u4eba',
        level: meta?.level ?? save?.player?.level ?? 1,
        scene: meta?.scene ?? save?.currentScene ?? 10000,
        money: meta?.money ?? save?.player?.money ?? 0,
        empty: false,
      });
    } else {
      slots.push({ slotId: i, empty: true, label: '\u7a7a' });
    }
  }
  return slots;
}

 function countNonEmptySlots() {
  return listSaveSlots().filter((s) => !s.empty).length;
}

 function hasAnySave() {
  return countNonEmptySlots() > 0;
}

 function findFirstEmptySlot() {
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    if (!slotHasData(i)) return i;
  }
  return null;
}

 function findMostRecentSlot() {
  const idx = loadSaveIndex();
  let bestId = null;
  let bestTime = 0;
  for (const [key, entry] of Object.entries(idx.entries || {})) {
    const t = Date.parse(entry.savedAt || '') || 0;
    if (t >= bestTime && slotHasData(Number(key))) {
      bestTime = t;
      bestId = Number(key);
    }
  }
  if (bestId != null) return bestId;
  for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
    if (slotHasData(i)) return i;
  }
  return null;
}

function updateIndexEntry(slotId, save, sceneName) {
  const idx = loadSaveIndex();
  idx.entries[String(slotId)] = {
    label: buildSlotLabel(save, sceneName),
    savedAt: save.savedAt,
    playerName: save.player?.name || '\u65c5\u4eba',
    level: save.player?.level ?? 1,
    scene: save.currentScene ?? 10000,
    money: save.player?.money ?? 0,
  };
  idx.activeSlotId = slotId;
  writeSaveIndex(idx);
}

 function persistSaveToSlot(slotId, save, { sceneName = '' } = {}) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SAVE_SLOT_COUNT) {
    throw new Error('\u65e0\u6548\u7684\u5b58\u6863\u69fd\u4f4d');
  }
  save.savedAt = new Date().toISOString();
  save.slotId = slotId;
  localStorage.setItem(slotStorageKey(slotId), JSON.stringify(save));
  updateIndexEntry(slotId, save, sceneName);
  return slotId;
}

 function deleteSlot(slotId) {
  localStorage.removeItem(slotStorageKey(slotId));
  const idx = loadSaveIndex();
  delete idx.entries[String(slotId)];
  if (idx.activeSlotId === slotId) idx.activeSlotId = findMostRecentSlot();
  writeSaveIndex(idx);
}

/** Persist current play session to active slot (assigns first empty slot if needed). */
 function persistSave(save, { slotId, sceneName } = {}) {
  if (!save.started) return null;
  let target = slotId;
  if (!Number.isInteger(target)) {
    target = getActiveSlotId();
  }
  if (!Number.isInteger(target)) {
    target = findFirstEmptySlot();
  }
  if (!Number.isInteger(target)) {
    target = 0;
  }
  return persistSaveToSlot(target, save, { sceneName });
}

/** Load save for current browser session (active slot, else default new game). */
 function loadSessionSave() {
  migrateLegacySave();
  const active = getActiveSlotId();
  if (active != null) {
    const save = loadSlot(active);
    if (save?.started) return save;
  }
  const recent = findMostRecentSlot();
  if (recent != null) {
    const save = loadSlot(recent);
    if (save?.started) {
      setActiveSlotId(recent);
      return save;
    }
  }
  return createDefaultSave();
}

/** @deprecated use hasAnySave */
 function hasSave() {
  return hasAnySave();
}

/** @deprecated use loadSessionSave */
 function loadSave() {
  return loadSessionSave();
}

exports.SAVE_SLOT_COUNT = SAVE_SLOT_COUNT;
exports.createDefaultPlayer = createDefaultPlayer;
exports.createDefaultSave = createDefaultSave;
exports.normalizeSaveParty = normalizeSaveParty;
exports.buildSlotLabel = buildSlotLabel;
exports.loadSaveIndex = loadSaveIndex;
exports.migrateLegacySave = migrateLegacySave;
exports.getActiveSlotId = getActiveSlotId;
exports.setActiveSlotId = setActiveSlotId;
exports.slotHasData = slotHasData;
exports.loadSlot = loadSlot;
exports.getSlotMeta = getSlotMeta;
exports.listSaveSlots = listSaveSlots;
exports.countNonEmptySlots = countNonEmptySlots;
exports.hasAnySave = hasAnySave;
exports.findFirstEmptySlot = findFirstEmptySlot;
exports.findMostRecentSlot = findMostRecentSlot;
exports.persistSaveToSlot = persistSaveToSlot;
exports.deleteSlot = deleteSlot;
exports.persistSave = persistSave;
exports.loadSessionSave = loadSessionSave;
exports.hasSave = hasSave;
exports.loadSave = loadSave;

});

__wgDef("save-transfer.js", function (exports) {
const { createDefaultSave, normalizeSaveParty, persistSaveToSlot, setActiveSlotId, getActiveSlotId, findFirstEmptySlot, loadSlot } = __wgImport("save-manager.js", {"createDefaultSave":"createDefaultSave","normalizeSaveParty":"normalizeSaveParty","persistSaveToSlot":"persistSaveToSlot","setActiveSlotId":"setActiveSlotId","getActiveSlotId":"getActiveSlotId","findFirstEmptySlot":"findFirstEmptySlot","loadSlot":"loadSlot"});
const { normalizePlayerGoods } = __wgImport("inventory-system.js", {"normalizePlayerGoods":"normalizePlayerGoods"});
const { ensureParty, syncPlayerFromRole } = __wgImport("game-runtime.js", {"ensureParty":"ensureParty","syncPlayerFromRole":"syncPlayerFromRole"});

 const SAVE_EXPORT_PREFIX = 'WGSAVE1:';

/** Serialize game state to a single portable string (clipboard-friendly). */
 function exportSaveString(save) {
  const payload = JSON.stringify(save);
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return SAVE_EXPORT_PREFIX + btoa(binary);
}

function decodePayloadString(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('\u8bf7\u8f93\u5165\u975e\u7a7a\u5b57\u7b26\u4e32');

  if (trimmed.startsWith(SAVE_EXPORT_PREFIX)) {
    const b64 = trimmed.slice(SAVE_EXPORT_PREFIX.length);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  if (trimmed.startsWith('{')) return trimmed;
  throw new Error(
    '\u65e0\u6cd5\u8bc6\u522b\u7684\u5b58\u6863\u683c\u5f0f\uff0c\u8bf7\u4f7f\u7528 WGSAVE1: \u5f00\u5934\u6216\u7c98\u8d34\u5b8c\u6574 JSON',
  );
}

/** Parse exported string into normalized save object. */
 function importSaveString(text) {
  const json = decodePayloadString(text);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('\u5b58\u6863\u6570\u636e\u635f\u574f\u6216\u4e0d\u662f\u5408\u6cd5 JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('\u5b58\u6863\u7ed3\u6784\u65e0\u6548');
  }
  const base = createDefaultSave();
  const save = normalizeSaveParty({
    ...base,
    ...parsed,
    player: {
      ...base.player,
      ...parsed.player,
      skills: {
        ...base.player.skills,
        ...(parsed.player?.skills || {}),
      },
    },
    party: parsed.party || base.party,
    friendList: parsed.friendList || base.friendList,
    departedFriends: parsed.departedFriends || base.departedFriends,
    tempStrings: parsed.tempStrings || base.tempStrings,
    sceneEvents: parsed.sceneEvents || base.sceneEvents,
    resEvents: parsed.resEvents || base.resEvents,
    tasks: parsed.tasks || base.tasks,
    messages: Array.isArray(parsed.messages) ? parsed.messages : base.messages,
    dialogue: parsed.dialogue || base.dialogue,
    wordProgress: parsed.wordProgress || base.wordProgress,
    abhsByLib: parsed.abhsByLib || base.abhsByLib,
    partSlotsByLib: parsed.partSlotsByLib || base.partSlotsByLib,
  });
  normalizePlayerGoods(save.player);
  return save;
}

 function getSaveSummary(save) {
  const name = save?.player?.name || '\u65c5\u4eba';
  const scene = save?.currentScene ?? 10000;
  const money = save?.player?.money ?? 0;
  const level = save?.player?.level ?? 1;
  const slot = Number.isInteger(save?.slotId) ? save.slotId + 1 : '-';
  const when = save?.savedAt
    ? new Date(save.savedAt).toLocaleString()
    : '\u5c1a\u672a\u4fdd\u5b58';
  return { name, scene, money, level, when, slot };
}

 async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

 async function readClipboardText() {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error(
    '\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u8bfb\u53d6\u526a\u8d34\u677f\uff0c\u8bf7\u624b\u52a8\u7c98\u8d34\u5230\u6587\u672c\u6846',
  );
}

 function mergeSaveInto(target, imported) {
  Object.keys(target).forEach((k) => { delete target[k]; });
  Object.assign(target, imported);
}

 function applySaveToGame(app, save, { slotId, sceneName, persist = true } = {}) {
  mergeSaveInto(app.state, save);
  ensureParty(app.state);
  syncPlayerFromRole(app.state, 0);
  app.wordEngine?.resetErrorList?.(app.settings);
  let targetSlot = slotId;
  if (!Number.isInteger(targetSlot)) targetSlot = save.slotId;
  if (!Number.isInteger(targetSlot)) targetSlot = getActiveSlotId();
  if (!Number.isInteger(targetSlot)) targetSlot = findFirstEmptySlot();
  if (Number.isInteger(targetSlot)) {
    save.slotId = targetSlot;
    app.state.slotId = targetSlot;
    setActiveSlotId(targetSlot);
    if (persist && save.started) {
      persistSaveToSlot(targetSlot, app.state, { sceneName });
    }
  }
  app.ui.refreshStatus();
}

 async function loadSlotIntoGame(app, slotId) {
  const save = loadSlot(slotId);
  if (!save?.started) {
    throw new Error('\u8be5\u69fd\u4f4d\u6ca1\u6709\u53ef\u8bfb\u6863\u6848');
  }
  applySaveToGame(app, save, { slotId, persist: false });
  setActiveSlotId(slotId);
  sessionStorage.setItem('wordgame-in-progress', '1');
  await app.api.game_show_scene(save.currentScene || 10001);
}

exports.SAVE_EXPORT_PREFIX = SAVE_EXPORT_PREFIX;
exports.exportSaveString = exportSaveString;
exports.importSaveString = importSaveString;
exports.getSaveSummary = getSaveSummary;
exports.copyText = copyText;
exports.readClipboardText = readClipboardText;
exports.mergeSaveInto = mergeSaveInto;
exports.applySaveToGame = applySaveToGame;
exports.loadSlotIntoGame = loadSlotIntoGame;

});

__wgDef("abhs-system.js", function (exports) {
/** Ebbinghaus bucket thresholds (seconds), matching Unit_pop.pas get_abhs_value. */
const ABHS_BUCKETS = [
  { key: 'b5', next: 'b30', wait: 300 },
  { key: 'b30', next: 'b240', wait: 1500 },
  { key: 'b240', next: 'd1', wait: 5400 },
  { key: 'd1', next: 'd2', wait: 72000 },
  { key: 'd2', next: 'd4', wait: 86400 },
  { key: 'd4', next: 'd7', wait: 172800 },
  { key: 'd7', next: 'd15', wait: 259200 },
  { key: 'd15', next: null, wait: 691200 },
];

 function createAbhsState() {
  return {
    b5: [],
    b30: [],
    b240: [],
    d1: [],
    d2: [],
    d4: [],
    d7: [],
    d15: [],
    lastId: -1,
    repeatCount: 0,
  };
}

 function getAbhsState(saveRef, libName) {
  if (!saveRef.abhsByLib) saveRef.abhsByLib = {};
  if (!saveRef.abhsByLib[libName]) saveRef.abhsByLib[libName] = createAbhsState();
  return saveRef.abhsByLib[libName];
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseEntry(line) {
  const comma = line.indexOf(',');
  if (comma <= 0) return null;
  const t = Number(line.slice(0, comma));
  const id = Number(line.slice(comma + 1));
  if (!Number.isFinite(t) || !Number.isFinite(id)) return null;
  return { t, id };
}

/** Import legacy .abhs sidecar (files 4-8 concatenated or single file lines). */
 function importAbhsLines(state, text) {
  if (!text) return;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const entry = parseEntry(line);
    if (entry) state.d1.push(entry);
  }
}

 function pickAbhsWordId(state, entryCount) {
  const now = nowSec();
  state.repeatCount = 0;

  for (const bucket of ABHS_BUCKETS) {
    const list = state[bucket.key];
    if (!list.length) continue;
    const head = list[0];
    if (now - head.t <= bucket.wait) continue;

    list.shift();
    const id = head.id;
    if (bucket.next) {
      state[bucket.next].push({ t: now, id });
    }

    if (id >= entryCount) {
      return { wordIndex: Math.floor(Math.random() * entryCount), fromAbhs: false };
    }

    if (state.lastId !== id) {
      state.lastId = id;
      state.repeatCount = 0;
    } else {
      state.repeatCount += 1;
      if (state.repeatCount >= 2) {
        return pickAbhsWordId(state, entryCount);
      }
    }
    return { wordIndex: id, fromAbhs: true };
  }

  return null;
}

 function abhsOnCorrect(state, wordIndex, fromAbhs) {
  if (fromAbhs) return;
  state.b5.push({ t: nowSec(), id: wordIndex });
}

 function removeWordFromAbhs(state, wordIndex) {
  for (const bucket of ABHS_BUCKETS) {
    state[bucket.key] = state[bucket.key].filter((e) => e.id !== wordIndex);
  }
}

 function serializeAbhsForSave(state) {
  const out = {};
  for (const bucket of ABHS_BUCKETS) {
    out[bucket.key] = state[bucket.key].map((e) => `${e.t},${e.id}`);
  }
  out.lastId = state.lastId;
  out.repeatCount = state.repeatCount;
  return out;
}

 function deserializeAbhsFromSave(raw) {
  const state = createAbhsState();
  if (!raw) return state;
  for (const bucket of ABHS_BUCKETS) {
    const lines = raw[bucket.key];
    if (!Array.isArray(lines)) continue;
    state[bucket.key] = lines
      .map((line) => parseEntry(String(line)))
      .filter(Boolean);
  }
  state.lastId = raw.lastId ?? -1;
  state.repeatCount = raw.repeatCount ?? 0;
  return state;
}

exports.createAbhsState = createAbhsState;
exports.getAbhsState = getAbhsState;
exports.importAbhsLines = importAbhsLines;
exports.pickAbhsWordId = pickAbhsWordId;
exports.abhsOnCorrect = abhsOnCorrect;
exports.removeWordFromAbhs = removeWordFromAbhs;
exports.serializeAbhsForSave = serializeAbhsForSave;
exports.deserializeAbhsFromSave = deserializeAbhsFromSave;

});

__wgDef("word-affix.js", function (exports) {
const { fetchDecodedText } = __wgImport("text-encoding.js", {"fetchDecodedText":"fetchDecodedText"});

let prefixes = [];
let suffixes = [];

async function loadAffixFile(url) {
  try {
    return await fetchDecodedText(url);
  } catch {
    return '';
  }
}

 async function loadWordAffixes() {
  const [pre, suf] = await Promise.all([
    loadAffixFile('data/upp/dat/qian.txt'),
    loadAffixFile('data/upp/dat/hou.txt'),
  ]);
  prefixes = pre.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  suffixes = suf.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
}

function findPrefix(word) {
  for (const p of prefixes) {
    if (word.startsWith(p)) return p;
  }
  return null;
}

function findSuffix(word) {
  for (const s of suffixes) {
    if (word.endsWith(s)) return s;
  }
  return null;
}

/** game_m_color modes from original ComboBox_fen. */
 function colorizeWordHtml(word, settings) {
  const mode = Number(settings.wordColorMode) || 0;
  if (mode <= 0 || word.includes(' ')) return escapeHtml(word);

  const prefixColor = settings.prefixColor || '#6495ed';
  const suffixColor = settings.suffixColor || '#ee82ee';
  const baseColor = settings.enColor || '#000000';
  const pre = findPrefix(word);
  const suf = findSuffix(word);

  const chunks = [];
  const push = (text, color) => {
    if (text) chunks.push({ text, color });
  };

  if (mode === 1) {
    if (pre) push(pre, prefixColor);
    push(word.slice(pre?.length || 0), baseColor);
  } else if (mode === 2) {
    if (suf) {
      push(word.slice(0, word.length - suf.length), baseColor);
      push(suf, suffixColor);
    } else if (pre) {
      push(pre, prefixColor);
      push(word.slice(pre.length), baseColor);
    } else {
      push(word, baseColor);
    }
  } else if (mode === 3) {
    if (pre) {
      push(pre, prefixColor);
      push(word.slice(pre.length, suf ? word.length - suf.length : word.length), baseColor);
    } else {
      push(word.slice(0, suf ? word.length - suf.length : word.length), baseColor);
    }
    if (suf) push(suf, suffixColor);
  } else if (mode === 4) {
    const bodyEnd = suf ? word.length - suf.length : word.length;
    if (suf) push(word.slice(0, bodyEnd), baseColor);
    if (suf) push(suf, suffixColor);
    if (pre && word.startsWith(pre)) {
      return colorizeWordHtml(word, { ...settings, wordColorMode: 3 });
    }
    if (!suf && !pre) push(word, baseColor);
  } else {
    push(word, baseColor);
  }

  return chunks.map((c) => `<span style="color:${c.color}">${escapeHtml(c.text)}</span>`).join('');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

exports.loadWordAffixes = loadWordAffixes;
exports.colorizeWordHtml = colorizeWordHtml;

});

__wgDef("part-size.js", function (exports) {
 function createPartSlots(partSize) {
  const size = Math.max(0, Number(partSize) || 0);
  if (size <= 0) return null;
  return {
    pointer: 0,
    slots: new Array(size + 1).fill(0),
  };
}

 function getPartSlots(saveRef, libName, partSize) {
  if (!partSize || partSize <= 0) return null;
  if (!saveRef.partSlotsByLib) saveRef.partSlotsByLib = {};
  if (!saveRef.partSlotsByLib[libName]) {
    saveRef.partSlotsByLib[libName] = createPartSlots(partSize);
  }
  const slots = saveRef.partSlotsByLib[libName];
  if (slots.slots.length !== partSize + 1) {
    saveRef.partSlotsByLib[libName] = createPartSlots(partSize);
  }
  return saveRef.partSlotsByLib[libName];
}

/** Returns word index from segment queue, or -1. */
 function pickPartWordIndex(partState) {
  if (!partState || partState.pointer <= 0) return -1;
  if (partState.pointer > partState.slots.length - 1) partState.pointer = 1;
  const id = partState.slots[partState.pointer];
  partState.pointer += 1;
  return id > 0 ? id : -1;
}

 function rememberPartWord(partState, wordIndex) {
  if (!partState || partState.pointer !== 0) return;
  for (let i = 1; i < partState.slots.length; i += 1) {
    if (i === partState.slots.length - 1) partState.pointer = 1;
    if (partState.slots[i] === 0) {
      partState.slots[i] = wordIndex;
      return;
    }
  }
}

 function clearPartWord(partState, wordIndex) {
  if (!partState) return;
  for (let i = 1; i < partState.slots.length; i += 1) {
    if (partState.slots[i] === wordIndex) {
      partState.slots[i] = 0;
      partState.pointer = 0;
    }
  }
}

exports.createPartSlots = createPartSlots;
exports.getPartSlots = getPartSlots;
exports.pickPartWordIndex = pickPartWordIndex;
exports.rememberPartWord = rememberPartWord;
exports.clearPartWord = clearPartWord;

});

__wgDef("word-engine.js", function (exports) {
const { getAbhsState, pickAbhsWordId, abhsOnCorrect, removeWordFromAbhs } = __wgImport("abhs-system.js", {"getAbhsState":"getAbhsState","pickAbhsWordId":"pickAbhsWordId","abhsOnCorrect":"abhsOnCorrect","removeWordFromAbhs":"removeWordFromAbhs"});
const { colorizeWordHtml } = __wgImport("word-affix.js", {"colorizeWordHtml":"colorizeWordHtml"});
const { getPartSlots, pickPartWordIndex, rememberPartWord, clearPartWord } = __wgImport("part-size.js", {"getPartSlots":"getPartSlots","pickPartWordIndex":"pickPartWordIndex","rememberPartWord":"rememberPartWord","clearPartWord":"clearPartWord"});
const { fetchDecodedText } = __wgImport("text-encoding.js", {"fetchDecodedText":"fetchDecodedText"});

const ERROR_RING_SIZE = 62;

 const WORD_COLOR_OPTIONS = [
  { value: 0, label: '不分色' },
  { value: 1, label: '前缀优先，二取一' },
  { value: 2, label: '后缀优先，二取一' },
  { value: 3, label: '前缀优先，全部' },
  { value: 4, label: '后缀优先，全部' },
];

/** ComboBox index 0-7 from original settings → internal interval (-1 = off). */
 function repIntervalFromIndex(repIndex) {
  const idx = Number(repIndex);
  if (!Number.isFinite(idx) || idx <= 0) return -1;
  return idx - 1;
}

 function gameBaseRandom(mod) {
  const m = mod > 0 ? mod : 1;
  return Math.floor(Math.random() * m);
}

 class WordEngine {
  constructor() {
    this.entries = [];
    this.name = '';
    this.errorSlots = new Array(ERROR_RING_SIZE).fill(null);
    this.errorPointer = 0;
    this.errorCounter = 0;
    this.lastPickFromError = false;
    this.lastPickFromAbhs = false;
  }

  async loadLib(url) {
    const text = await fetchDecodedText(url);
    this.name = url.split('/').pop();
    this.entries = parseWordLib(text);
    if (this.entries.length >= 10) {
      const withCjk = this.entries.filter((e) => /[\u4e00-\u9fff]/.test(e.cn)).length;
      if (withCjk === 0) {
        console.warn('[WordEngine] \u8bcd\u5e93\u4e2d\u6587\u53ef\u80fd\u4e71\u7801\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u7f16\u7801 (UTF-8 / GBK):', url);
      }
    }
    if (this.entries.length < 3) {
      while (this.entries.length < 3) {
        this.entries.push({ en: `word${this.entries.length}`, cn: '\u5360\u4f4d', offsets: [0, 0] });
      }
    }
    return this.entries.length;
  }

  resetErrorList(settings) {
    this.errorSlots.fill(null);
    this.errorPointer = 0;
    const rep = repIntervalFromIndex(settings.repIndex ?? settings.rep ?? 3);
    this.errorCounter = rep >= 0 ? rep : 0;
  }

  pick(settings, progress = {}, saveRef = null) {
    if (this.entries.length === 0) return null;

    const wordIndex = this.pickWordIndex(settings, progress, saveRef);
    const entry = this.entries[wordIndex];
    let groupIndex = wordIndex;
    if (settings.sequential && this.lastPickFromError) {
      groupIndex = Math.max(0, (saveRef?.sequentialIndex ?? progress.sequentialIndex ?? 1) - 1);
    }
    return buildQuestion(this.entries, wordIndex, entry, settings, groupIndex);
  }

  pickWordIndex(settings, progress, saveRef) {
    this.lastPickFromError = false;
    this.lastPickFromAbhs = false;
    const rep = repIntervalFromIndex(settings.repIndex ?? settings.rep ?? 3);
    const hasQueued = this.errorSlots.some((id) => id != null);

    if (!hasQueued || this.errorSlots[this.errorPointer] == null) {
      return this.getRandomWordIndex(settings, progress, saveRef);
    }

    if (this.errorCounter === 0) {
      const wordIndex = this.errorSlots[this.errorPointer];
      this.errorSlots[this.errorPointer] = null;
      if (rep >= 0) this.errorCounter = rep;
      this.errorPointer = (this.errorPointer + 1) % ERROR_RING_SIZE;
      if (wordIndex == null || wordIndex >= this.entries.length) {
        return this.getRandomWordIndex(settings, progress, saveRef);
      }
      this.lastPickFromError = true;
      return wordIndex;
    }

    this.errorCounter -= 1;
    return this.getRandomWordIndex(settings, progress, saveRef);
  }

  getRandomWordIndex(settings, progress, saveRef) {
    const libName = this.name;

    if (settings.abhs && saveRef) {
      const abhs = getAbhsState(saveRef, libName);
      const picked = pickAbhsWordId(abhs, this.entries.length);
      if (picked) {
        this.lastPickFromAbhs = picked.fromAbhs;
        return picked.wordIndex;
      }
    }

    const partState = saveRef ? getPartSlots(saveRef, libName, settings.partSize) : null;
    const partId = pickPartWordIndex(partState);
    if (partId >= 0 && partId < this.entries.length) {
      return partId;
    }

    let wordIndex;
    if (settings.sequential) {
      const idx = saveRef?.sequentialIndex ?? progress.sequentialIndex ?? 0;
      wordIndex = idx % this.entries.length;
      const next = idx + 1;
      if (saveRef) saveRef.sequentialIndex = next >= this.entries.length ? 0 : next;
      else progress.sequentialIndex = next >= this.entries.length ? 0 : next;
    } else {
      wordIndex = Math.floor(Math.random() * this.entries.length);
    }

    rememberPart(saveRef, libName, settings.partSize, wordIndex);
    return wordIndex;
  }

  addToErrorList(wordIndex) {
    for (let i = this.errorPointer; i < ERROR_RING_SIZE; i += 1) {
      if (this.errorSlots[i] == null) {
        this.errorSlots[i] = wordIndex;
        return;
      }
    }
    for (let i = 0; i < this.errorPointer; i += 1) {
      if (this.errorSlots[i] == null) {
        this.errorSlots[i] = wordIndex;
        return;
      }
    }
  }

  recordResult(entry, correct, progress, settings, wordIndex, saveRef = null) {
    if (!progress[entry.en]) progress[entry.en] = { correct: 0, wrong: 0 };
    const rep = repIntervalFromIndex(settings?.repIndex ?? settings?.rep ?? 3);
    const libName = this.name;

    if (correct) {
      progress[entry.en].correct += 1;
      if (settings?.abhs && saveRef) {
        const abhs = getAbhsState(saveRef, libName);
        abhsOnCorrect(abhs, wordIndex, this.lastPickFromAbhs);
      }
      if (saveRef && settings?.partSize > 0) {
        clearPartWord(getPartSlots(saveRef, libName, settings.partSize), wordIndex);
      }
    } else if (rep >= 0 && wordIndex != null) {
      progress[entry.en].wrong += 1;
      this.addToErrorList(wordIndex);
    } else if (!correct) {
      progress[entry.en].wrong += 1;
    }
  }
}

function rememberPart(saveRef, libName, partSize, wordIndex) {
  if (!saveRef || !partSize) return;
  rememberPartWord(getPartSlots(saveRef, libName, partSize), wordIndex);
}

function buildQuestion(allEntries, wordIndex, entry, settings, groupIndex = wordIndex) {
  const reverse = settings.reverseLearn;
  const englishWord = entry.en;

  let promptText = reverse ? entry.cn : englishWord;
  let promptHtml = null;

  if (!reverse && (settings.wordColorMode || 0) > 0 && !englishWord.includes(' ')) {
    promptHtml = colorizeWordHtml(englishWord, settings);
  }

  const answer = reverse ? entry.en : entry.cn;

  let [offA, offB] = entry.offsets;
  if (offA === 0 && offB === 0 && settings.sequential) {
    switch (groupIndex % 3) {
      case 0:
        offA = 1;
        offB = 2;
        break;
      case 1:
        offA = -1;
        offB = 1;
        break;
      default:
        offA = -1;
        offB = -2;
        break;
    }
  }

  const correctSlot = Math.floor(Math.random() * 3);
  const choices = new Array(3);
  choices[correctSlot] = answer;

  const used = new Set([answer]);
  const slots = [0, 1, 2].filter((i) => i !== correctSlot);

  const pickDistractor = (offset, avoidIndex) => {
    if (offset !== 0) {
      const neighbor = allEntries[wordIndex + offset];
      if (neighbor) {
        const text = reverse ? neighbor.en : neighbor.cn;
        if (text && text !== answer) return text;
      }
    }
    let tries = 0;
    while (tries < 30) {
      tries += 1;
      const ri = Math.floor(Math.random() * allEntries.length);
      if (ri === wordIndex || ri === avoidIndex) continue;
      const text = reverse ? allEntries[ri].en : allEntries[ri].cn;
      if (text && text !== answer && !used.has(text)) return text;
    }
    return `${answer}${used.size}`;
  };

  choices[slots[0]] = pickDistractor(offA, wordIndex);
  used.add(choices[slots[0]]);
  choices[slots[1]] = pickDistractor(offB, wordIndex);
  used.add(choices[slots[1]]);

  return {
    entry,
    wordIndex,
    prompt: promptText,
    promptHtml,
    answer,
    choices,
    reverse,
    correctSlot,
  };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

 function parseWordLib(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const en = line.slice(0, eq).trim();
    const rawCn = line.slice(eq + 1).trim();
    if (!en || !rawCn) continue;
    const { cn, offsets } = parseDefinition(rawCn);
    entries.push({ en, cn, offsets });
  }
  return entries;
}

function parseDefinition(rawCn) {
  const offsets = [];
  const re = /;([+-]\d+)/g;
  let m;
  while ((m = re.exec(rawCn)) !== null) {
    offsets.push(parseInt(m[1], 10));
  }
  const cn = rawCn.replace(/;[+-]\d+/g, '').trim() || rawCn;
  return {
    cn,
    offsets: [offsets[0] || 0, offsets[1] || 0],
  };
}



exports.WORD_COLOR_OPTIONS = WORD_COLOR_OPTIONS;
exports.repIntervalFromIndex = repIntervalFromIndex;
exports.gameBaseRandom = gameBaseRandom;
exports.WordEngine = WordEngine;
exports.parseWordLib = parseWordLib;
exports["removeWordFromAbhs"] = removeWordFromAbhs;

});

__wgDef("offline-filter.js", function (exports) {
/**
 * Strip online-only links, iframes, and external embeds for the offline remake.
 */

const OFFLINE_MSG = '\u672c\u7248\u4e3a\u5355\u673a\u7248\uff0c\u4e0d\u652f\u6301\u8054\u7f51\u529f\u80fd\u3002';

 function isOnlineSceneId(id) {
  return false;
}

 function isExternalUrl(href) {
  return /^https?:\/\//i.test(String(href || '').trim());
}

 function sanitizeHtmlForOffline(html) {
  if (!html) return html;
  let out = html;

  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<iframe\b[^>]*>/gi, '');
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<form\b[\s\S]*?<\/form>/gi, '');

  out = out.replace(/<td\b[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*"https?:\/\/[^"]*"[\s\S]*?<\/td>/gi, '');
  out = out.replace(/<a\b[^>]*href\s*=\s*'https?:\/\/[^']*'[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  out = out.replace(/<a\b[^>]*href\s*=\s*"https?:\/\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  out = out.replace(/<img\b[^>]*\ssrc\s*=\s*"https?:\/\/[^"]*"[^>]*>/gi, '');
  out = out.replace(/<img\b[^>]*\ssrc\s*=\s*'https?:\/\/[^']*'[^>]*>/gi, '');

  out = out.replace(/https?:\/\/(?:www\.)?finer2\.com\S*/gi, '');
  out = out.replace(/https?:\/\/word\.5d6d\.com\S*/gi, '');

  out = out.replace(/<CENTER>[\s\S]*?扫描二维码[\s\S]*?<\/CENTER>/gi, '');
  out = out.replace(/通过做了武林盟主扫描二维码分享到朋友圈群。/g, '');
  out = out.replace(/扫描二维码分享到朋友圈群。/g, '');

  out = out.replace(/\s*target\s*=\s*"_blank"/gi, '');
  return out;
}

 function sanitizeChatForOffline(html) {
  return sanitizeHtmlForOffline(html);
}



exports.isOnlineSceneId = isOnlineSceneId;
exports.isExternalUrl = isExternalUrl;
exports.sanitizeHtmlForOffline = sanitizeHtmlForOffline;
exports.sanitizeChatForOffline = sanitizeChatForOffline;
exports["OFFLINE_MSG"] = OFFLINE_MSG;

});

__wgDef("scene-conditions.js", function (exports) {
/** Helpers for scene conditional blocks (<:if ...:>) aligned with Delphi scene HTML. */

function isIdentChar(ch) {
  return /[A-Za-z0-9_]/.test(ch || '');
}

 function matchKeyword(text, index, word) {
  const end = index + word.length;
  if (String(text).slice(index, end).toLowerCase() !== word.toLowerCase()) return false;
  const before = index === 0 ? '' : text[index - 1];
  const after = text[end] || '';
  return !isIdentChar(before) && !isIdentChar(after);
}

 function findElseSplit(text) {
  const src = String(text || '');
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth !== 0) continue;
    if (matchKeyword(src, i, 'elseif')) {
      i += 5;
      continue;
    }
    if (matchKeyword(src, i, 'else')) return i;
  }
  return -1;
}

 function stripTrailingEnd(text) {
  return String(text || '').replace(/\s*end\s*$/i, '').trim();
}

function matchThen(text) {
  return text.match(/^if\s+([\s\S]+?)\s+then(?![A-Za-z0-9_])/i);
}

function skipSpace(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

/** Parse `if cond then ... [elseif cond then ...] [else ...] [end]` and trailing suffix. */
 function parseHtmlIfChain(text) {
  const trimmed = String(text || '').trimStart();
  const ifM = matchThen(trimmed);
  if (!ifM) return null;

  const branches = [];
  let pos = skipSpace(trimmed, ifM[0].length);
  let current = { condition: ifM[1].trim(), start: pos };
  let elseStart = -1;
  let depth = 1;

  const closeCurrent = (end) => {
    if (!current) return;
    current.body = trimmed.slice(current.start, end).trim();
    branches.push({ condition: current.condition, body: current.body });
    current = null;
  };

  for (let i = pos; i < trimmed.length; i += 1) {
    if (matchKeyword(trimmed, i, 'elseif')) {
      if (depth === 1 && elseStart < 0 && current) {
        closeCurrent(i);
        const afterKw = skipSpace(trimmed, i + 6);
        const thenM = matchThen(`if ${trimmed.slice(afterKw)}`);
        if (!thenM) return null;
        const cond = thenM[1].trim();
        const consumed = thenM[0].length - 3;
        pos = skipSpace(trimmed, afterKw + consumed);
        current = { condition: cond, start: pos };
        i = pos - 1;
      }
      continue;
    }
    if (matchKeyword(trimmed, i, 'if')) {
      depth += 1;
      i += 1;
      continue;
    }
    if (matchKeyword(trimmed, i, 'end')) {
      depth -= 1;
      if (depth === 0) {
        if (current) closeCurrent(i);
        return {
          branches,
          elseBody: elseStart >= 0 ? trimmed.slice(elseStart, i).trim() : '',
          suffix: trimmed.slice(i + 3),
        };
      }
      i += 2;
      continue;
    }
    if (matchKeyword(trimmed, i, 'else')) {
      if (depth === 1 && elseStart < 0 && current) {
        closeCurrent(i);
        elseStart = skipSpace(trimmed, i + 4);
        i = elseStart - 1;
      }
    }
  }

  if (depth === 1) {
    if (current) closeCurrent(trimmed.length);
    return {
      branches,
      elseBody: elseStart >= 0 ? trimmed.slice(elseStart).trim() : '',
      suffix: '',
    };
  }
  return null;
}

/** Parse one `if cond then ... [else ...] end` block. */
 function parseHtmlIfBlock(text) {
  const chain = parseHtmlIfChain(text);
  if (!chain || !chain.branches.length) return null;
  return {
    condition: chain.branches[0].condition,
    truePart: chain.branches[0].body,
    falsePart: chain.elseBody,
    suffix: chain.suffix,
  };
}

function pickIfChain(chain, evalConditionFn) {
  for (const branch of chain.branches) {
    if (evalConditionFn(branch.condition)) return branch.body;
  }
  return chain.elseBody || '';
}

/** Pull `run game_*` lines out of a conditional branch and queue them for execution. */
 function extractRunScripts(text, queueScript) {
  if (!text) return '';
  const kept = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    const runMatch = trimmed.match(/^run\s+(.+)$/i);
    if (runMatch) {
      queueScript?.(runMatch[1].trim());
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/** Evaluate nested `if ... then ... else ... end` blocks embedded in scene HTML. */
 function evaluateHtmlIfBlocks(text, evalConditionFn) {
  if (!text) return '';
  let out = '';
  let rest = String(text);

  while (rest.length) {
    const leadMatch = rest.match(/^[\s\S]*?(?=if\s+(?:not\s+)?game_)/i);
    if (leadMatch && leadMatch[0].length > 0 && leadMatch[0].length < rest.length) {
      out += leadMatch[0];
      rest = rest.slice(leadMatch[0].length);
    }

    const chain = parseHtmlIfChain(rest);
    if (!chain) {
      out += rest;
      break;
    }

    out += evaluateHtmlIfBlocks(pickIfChain(chain, evalConditionFn), evalConditionFn);
    rest = chain.suffix;
  }

  return out;
}

 function processConditionalBranch(text, ctx) {
  const queue = ctx.queueScript || (() => {});
  const evalFn = ctx.evalCondition || (() => false);
  const withoutRun = extractRunScripts(text, queue);
  return evaluateHtmlIfBlocks(withoutRun, evalFn);
}

 function evaluateIfChainText(text, evalConditionFn) {
  const chain = parseHtmlIfChain(text);
  if (!chain) return null;
  return evaluateHtmlIfBlocks(pickIfChain(chain, evalConditionFn), evalConditionFn);
}

exports.matchKeyword = matchKeyword;
exports.findElseSplit = findElseSplit;
exports.stripTrailingEnd = stripTrailingEnd;
exports.parseHtmlIfChain = parseHtmlIfChain;
exports.parseHtmlIfBlock = parseHtmlIfBlock;
exports.extractRunScripts = extractRunScripts;
exports.evaluateHtmlIfBlocks = evaluateHtmlIfBlocks;
exports.processConditionalBranch = processConditionalBranch;
exports.evaluateIfChainText = evaluateIfChainText;

});

__wgDef("scene-parser.js", function (exports) {
const { sanitizeHtmlForOffline } = __wgImport("offline-filter.js", {"sanitizeHtmlForOffline":"sanitizeHtmlForOffline"});
const { findElseSplit, processConditionalBranch, evaluateHtmlIfBlocks } = __wgImport("scene-conditions.js", {"findElseSplit":"findElseSplit","processConditionalBranch":"processConditionalBranch","evaluateHtmlIfBlocks":"evaluateHtmlIfBlocks"});

const K_ACTION = '\u52a8\u4f5c';
const K_DESC = '\u63cf\u8ff0';
const K_CHAT = '\u5bf9\u8bdd\u8d44\u6e90';
const K_NAME = '\u540d\u79f0';
const K_AUTHOR = '\u4f5c\u8005';
const K_ATTR = '\u5c5e\u6027';
const GPIC_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

 function parseSceneText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const meta = {};
  const sections = { action: [], description: [], chat: [] };
  let section = null;
  let inBlock = false;
  let awaitBrace = false;
  let block = [];

  for (const line of lines) {
    if (awaitBrace) {
      if (line.trim() === '{') {
        inBlock = true;
        awaitBrace = false;
      }
      continue;
    }

    if (!inBlock) {
      const header = matchSectionHeader(line);
      if (header) {
        section = header.key;
        if (header.inline) {
          block = [header.inline];
          sections[section] = block;
          section = null;
          block = [];
        } else if (header.open) {
          inBlock = true;
          block = header.prefix ? [header.prefix] : [];
        } else {
          awaitBrace = true;
          block = header.prefix ? [header.prefix] : [];
        }
        continue;
      }

      const eq = line.indexOf('=');
      if (eq > 0 && !section) meta[line.slice(0, eq).trim()] = line.slice(eq + 1);
      continue;
    }

    if (line.trim() === '}') {
      sections[section] = block;
      inBlock = false;
      section = null;
      block = [];
      continue;
    }
    block.push(line);
  }

  return {
    id: Number(meta.id || meta.ID || 0),
    name: meta[K_NAME] || meta.name || '',
    author: meta[K_AUTHOR] || '',
    attr: Number(meta[K_ATTR] || 0),
    beforeLoad: meta['\u8f7d\u5165\u524d'] || '',
    afterLoad: meta['\u8f7d\u5165\u540e'] || '',
    exitAfter: meta['\u9000\u51fa\u540e'] || '',
    actions: parseActionMap(sections.action),
    html: sections.description.join('\n'),
    chatScript: sections.chat.join('\n'),
  };
}

function matchSectionHeader(line) {
  const headers = [
    { key: 'action', label: K_ACTION },
    { key: 'description', label: K_DESC },
    { key: 'chat', label: K_CHAT },
  ];

  for (const { key, label } of headers) {
    if (!line.startsWith(`${label}=`)) continue;
    const rest = line.slice(label.length + 1);
    const trimmed = rest.trimEnd();
    if (trimmed.endsWith('{')) {
      const prefix = trimmed.slice(0, -1).trim();
      return { key, open: true, prefix: prefix || null };
    }
    if (rest.trim() === '') return { key, open: false, prefix: null };
    return { key, inline: rest };
  }
  return null;
}

function parseActionMap(lines) {
  const map = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';;')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

const sceneMetaCache = new Map();

 async function loadScene(id) {
  const res = await fetch(`data/scenes/${id}.txt`);
  if (!res.ok) throw new Error(`\u573a\u666f ${id} \u672a\u627e\u5230\u6216\u65e0\u6cd5\u52a0\u8f7d`);
  const text = await res.text();
  const scene = parseSceneText(text);
  sceneMetaCache.set(Number(id), { attr: scene.attr, name: scene.name });
  return scene;
}

/** Lightweight metadata for travel rules (attr bitfield). */
 async function peekSceneMeta(id) {
  const key = Number(id);
  if (sceneMetaCache.has(key)) return sceneMetaCache.get(key);
  const scene = await loadScene(key);
  return { attr: scene.attr, name: scene.name };
}

function stripSceneComments(html) {
  return String(html || '').replace(/^[ \t]*;;[^\n]*/gm, '');
}

function rewriteLocalImgSrc(tag) {
  const srcMatch = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
  if (!srcMatch) return tag;
  const src = srcMatch[1];
  if (src.startsWith('gpic:') || src.startsWith('data:')) return tag;
  if (/^https?:\/\//i.test(src) || /^mailto:/i.test(src)) return tag;
  if (src.startsWith('data/img/') || src.startsWith('data/gif/') || src.startsWith('data/music/')) return tag;

  const normalized = src.replace(/\\/g, '/').replace(/^\.\//, '');
  let next = src;
  if (normalized.startsWith('file://') || normalized.startsWith('file:/')) {
    const local = normalized.replace(/^file:\/+/, '').replace(/^\.\/+/, '').replace(/^img[/\\]/i, '');
    next = `data/img/${local.split(/[/\\]/).pop()}`;
  } else if (normalized.startsWith('gif/') || normalized.startsWith('img/')) {
    next = `data/${normalized}`;
  } else if (!normalized.startsWith('data/') && !normalized.startsWith('http')) {
    const folder = /\.gif$/i.test(normalized) ? 'gif' : 'img';
    next = `data/${folder}/${normalized.split('/').pop()}`;
  } else {
    return tag;
  }
  return tag.replace(srcMatch[0], `src="${next}"`);
}

 function preprocessSceneHtml(html, ctx) {
  let out = stripSceneComments(html);

  out = out.replace(/charset\s*=\s*gb2312/gi, 'charset=utf-8');
  out = out.replace(/charset\s*=\s*gbk/gi, 'charset=utf-8');
  out = out.replace(/\bcolor\s*=\s*#"/gi, 'color="#');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');

  const replaceTemplate = (body) => {
    const trimmed = body.trim();
    const conditional = evaluateConditionalBlock(trimmed, ctx);
    if (conditional !== null) return conditional;
    return evaluateTemplate(trimmed, ctx);
  };
  out = replaceInnermostTemplates(out, replaceTemplate);
  out = expandStringCalls(out, ctx);
  out = evaluateHtmlIfBlocks(out, (expr) => evalHtmlCondition(expr, ctx));

  out = out.replace(/\$apppath\$img\\/gi, 'data/img/');
  out = out.replace(/\$apppath\$img\//gi, 'data/img/');
  out = out.replace(/\$apppath\$gif\\/gi, 'data/gif/');
  out = out.replace(/\$apppath\$gif\//gi, 'data/gif/');
  out = out.replace(/\$apppath\$music\\/gi, 'data/music/');
  out = out.replace(/\$apppath\$music\//gi, 'data/music/');
  out = out.replace(/\$apppath\$dat\\/gi, 'data/upp/dat/');
  out = out.replace(/\$apppath\$dat\//gi, 'data/upp/dat/');
  out = out.replace(/\$apppath\$/gi, '');

  out = out.replace(/<body([^>]*)style="([^"]*)background:url\(\s*gpic:\/\/([^)]+)\)([^"]*)"/gi, (_, attrs, pre, gpicBody, post) => {
    const url = `gpic://${gpicBody}`;
    const style = `${pre}background-color:transparent;${post}`.replace(/;;+/g, ';');
    return `<body${attrs}style="${style}" data-gpic-bg="${encodeURIComponent(url)}"`;
  });

  out = out.replace(/<img(\s[^>]*?)src="(gpic:\/\/[^"]+)"([^>]*)>/gi, (full, before, src, after) => {
    const attrs = `${before}${after}`.replace(/\sclass="[^"]*"/gi, '').trim();
    return `<img ${attrs} class="gpic-img gpic-loading" data-gpic="${encodeURIComponent(src)}" src="${GPIC_PLACEHOLDER}" alt="">`;
  });

  out = out.replace(/<img\b[^>]*>/gi, (tag) => rewriteLocalImgSrc(tag));

  out = out.replace(/<a\b([^>]*?)href="([^"]*?)"([^>]*)>/gi, (full, before, href, after) => {
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      const textMatch = full.match(/>([\s\S]*?)<\/a>/i);
      return textMatch ? textMatch[1] : '';
    }
    if (href === '#' || /\bdata-game-link=/i.test(`${before}${after}`)) return full;
    return `<a${before}href="#" data-game-link="${encodeURIComponent(href)}"${after}>`;
  });

  out = out.replace(/<area\b([^>]*?)href="([^"]*?)"([^>]*)>/gi, (full, before, href, after) => {
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return full;
    if (href === '#' || /\bdata-game-link=/i.test(`${before}${after}`)) return full;
    return `<area${before}href="#" data-game-link="${encodeURIComponent(href)}"${after}>`;
  });

  out = out.replace(/onMouseOver=location\.href="([^"]+)"/gi, (_, href) => {
    return `data-game-hover="${encodeURIComponent(href)}"`;
  });

  out = out.replace(/<body([^>]*)>/gi, (_, attrs) => `<div class="scene-body"${attrs}>`);
  out = out.replace(/<\/body>/gi, '</div>');
  out = out.replace(/<\/?(?:html|head)\b[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*revealTrans[^>]*>/gi, '');
  out = out.replace(/<bgsound\b([^>]*?)src="([^"]*)"([^>]*)>/gi, (_, before, src, after) => {
    const loop = /loop\s*=\s*"-1"/i.test(`${before}${after}`) ? ' loop' : '';
    const normalized = src.replace(/\\/g, '/');
    return `<audio class="scene-bgm" src="${normalized}"${loop} autoplay preload="auto"></audio>`;
  });

  out = sanitizeHtmlForOffline(out);
  return out;
}

function evalHtmlCondition(expr, ctx) {
  if (ctx.evalCondition) return !!ctx.evalCondition(expr);
  return evalSceneCondition(expr, ctx);
}

function replaceInnermostTemplates(html, replacer) {
  let out = String(html || '');
  const re = /<:((?:(?!<:)[\s\S])*?):>/;
  for (let i = 0; i < 400; i += 1) {
    const next = out.replace(re, (_, body) => replacer(body.trim()));
    if (next === out) break;
    out = next;
  }
  return out;
}

function evaluateConditionalBlock(body, ctx) {
  if (/^if\s+/i.test(body)) {
    return processConditionalBranch(body, ctx);
  }

  const runOnly = body.match(/^run\s+(.+)$/i);
  if (runOnly) {
    ctx.queueScript?.(runOnly[1].trim());
    return '';
  }

  const resMatch = body.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (resMatch) {
    const id = Number(resMatch[1]);
    const rest = resMatch[2];
    const elseIdx = findElseSplit(rest);
    const hit = ctx.resEvents[id] ? true : false;
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

  const eventMatch = body.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (eventMatch) {
    const id = Number(eventMatch[1]);
    const rest = eventMatch[2];
    const elseIdx = findElseSplit(rest);
    const hit = evalHtmlCondition(`game_check_scene_event(${id})`, ctx);
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

    const chanceMatch = body.match(/^game_random_chance\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (chanceMatch) {
    const rest = chanceMatch[2];
    const hit = evalHtmlCondition(`game_random_chance(${chanceMatch[1]})`, ctx);
    const elseIdx = findElseSplit(rest);
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

  const lead = splitLeadingGameCall(body);
  if (lead && lead.rest.trim() && !/^(string|exeing)\b/i.test(lead.rest.trim())) {
    const elseIdx = findElseSplit(lead.rest);
    const hit = evalHtmlCondition(lead.expr, ctx);
    if (elseIdx >= 0) {
      const truePart = lead.rest.slice(0, elseIdx).trim();
      const falsePart = lead.rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? lead.rest.trim() : '', ctx);
  }

  return null;
}

function splitLeadingGameCall(text) {
  const src = String(text || '');
  const notPrefix = src.match(/^(not\s+)/i);
  const start = notPrefix ? notPrefix[0].length : 0;
  const m = src.slice(start).match(/^(game_\w+)\s*\(/i);
  if (!m) return null;
  let depth = 0;
  const open = start + m[0].length - 1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { expr: src.slice(0, i + 1).trim(), rest: src.slice(i + 1) };
      }
    }
  }
  return null;
}

function expandStringCalls(html, ctx) {
  if (!ctx?.evalTemplate) return html;
  let out = '';
  let rest = String(html || '');
  while (rest.length) {
    const idx = rest.search(/string\s+game_/i);
    if (idx < 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, idx);
    const chunk = rest.slice(idx);
    const afterKw = chunk.replace(/^string\s+/i, '');
    const callLen = leadingGameCallLength(afterKw);
    if (callLen < 0) {
      out += chunk.slice(0, 7);
      rest = chunk.slice(7);
      continue;
    }
    out += String(ctx.evalTemplate(chunk.slice(0, chunk.length - afterKw.length + callLen)) ?? '');
    rest = afterKw.slice(callLen);
  }
  return out;
}

function leadingGameCallLength(text) {
  const m = String(text || '').match(/^(game_\w+)\s*\(/i);
  if (!m) return -1;
  let depth = 0;
  for (let i = m[0].length - 1; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function evalSceneCondition(expr, ctx) {
  if (ctx.evalCondition) return ctx.evalCondition(expr);
  let m;
  if ((m = expr.match(/^not\s+game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !ctx.sceneEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !!ctx.sceneEvents[Number(m[1])];
  }
  if ((m = expr.match(/^not\s+game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !ctx.resEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !!ctx.resEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_random_chance\s*\(\s*(\d+)\s*\)$/i))) {
    return Math.random() < 1 / Number(m[1]);
  }
  return false;
}

function decodeGpicLabel(url) {
  const m = url.match(/,([^,]+),AT/i);
  if (m) return m[1];
  const tail = url.split(',').pop();
  return tail ? tail.replace(/\/\d+\.bmp/i, '') : '';
}

function evaluateTemplate(expr, ctx) {
  if (ctx.evalTemplate) return ctx.evalTemplate(expr);
  let m;
  if ((m = expr.match(/game_save_count\s*\(\s*0\s*\)/i))) {
    return ctx.saveCount > 0 ? String(ctx.saveCount) : '0';
  }
  if (/game_true\s*\(\s*1\s*\)/i.test(expr)) return 'true';
  if ((m = expr.match(/game_check_scene_event\s*\(\s*(\d+)\s*\)/i))) {
    return ctx.sceneEvents[Number(m[1])] ? '' : 'hidden';
  }
  return '';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

 function normalizeGameLinks(root) {
  if (!root) return;
  root.querySelectorAll('a[href]:not([data-game-link]), area[href]:not([data-game-link])').forEach((el) => {
    const href = el.getAttribute('href');
    if (!href || href === '#' || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return;
    el.setAttribute('href', '#');
    el.setAttribute('data-game-link', encodeURIComponent(href));
  });
}

 function wireGameLinks(root, handler) {
  normalizeGameLinks(root);
  if (!handler) return;
  root.querySelectorAll('[data-game-link]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handler(decodeURIComponent(el.getAttribute('data-game-link')));
    });
  });
}

exports.parseSceneText = parseSceneText;
exports.loadScene = loadScene;
exports.peekSceneMeta = peekSceneMeta;
exports.preprocessSceneHtml = preprocessSceneHtml;
exports.normalizeGameLinks = normalizeGameLinks;
exports.wireGameLinks = wireGameLinks;

});

__wgDef("city-travel.js", function (exports) {
/**
 * Inter-city travel stamina rules.
 * Maze travel (attr bit 2) uses pendingMazeWordTravelCost instead ?? no extra city cost.
 */

/** Stamina cost = floor(maxTili * percent / 100) per party member. */
 const CITY_TRAVEL_STAMINA_PERCENT = 5;

const MENU_SCENE_IDS = new Set([10000, 14444]);

/**
 * Coarse world regions for travel-cost checks (scene id ranges).
 * Order matters: more specific ranges first.
 */
 function getTravelRegion(sceneId) {
  const id = Number(sceneId);
  if (!Number.isFinite(id) || id < 10000) return 'local';

  if (id >= 12821 && id <= 12831) return 'kekexili';
  if (id >= 12800 && id <= 12820) return 'dongying';
  if (id >= 12617 && id <= 12798) return 'xiyu';
  if (id >= 12100 && id <= 12299) return 'dongying';
  if (id >= 12059 && id <= 12088) return 'emei';
  if (id >= 11998 && id <= 12058) return 'wudang';
  if (id >= 11937 && id <= 11997) return 'tianshan';
  if (id >= 11800 && id <= 11936) return 'kunlun';
  if (id >= 11784 && id <= 11799) return 'saiwai';
  if (id === 11578) return 'saiwai';
  if (id >= 11819 && id <= 11870) return 'shangjing';
  if (id === 11579) return 'shangjing';
  if (id >= 11400 && id <= 11783) return 'kaifeng';
  if (id >= 11370 && id <= 11390) return 'dali';
  if (id >= 11100 && id <= 11180) return 'xiuzhou';
  if (id >= 10582 && id <= 11099) return 'linan';
  if (id >= 10644 && id <= 10699) return 'linan';
  if (id >= 10701 && id <= 10999) return 'linan';
  if (id >= 11331 && id <= 11378) return 'linan';
  if (id === 11568) return 'linan';
  if (id >= 10061 && id <= 10449) return 'wuzhou';
  if (id >= 10450 && id <= 10499) return 'donghai';
  if (id >= 10300 && id <= 10350) return 'wujian';
  if (id >= 10000 && id <= 10059) return 'hexi';

  return 'wilderness';
}

 function isMazeSceneAttr(attr) {
  return ((Number(attr) || 0) & 2) === 2;
}

/**
 * @param {number} fromId
 * @param {number} toId
 * @param {number} fromAttr current scene attr
 * @param {number} toAttr target scene attr
 * @param {number} rawPageId argument passed to game_page (may be relative)
 */
 function shouldApplyCityTravelStaminaCost(fromId, toId, fromAttr, toAttr, rawPageId) {
  const from = Number(fromId);
  const to = Number(toId);
  if (!from || !to || from === to) return false;
  if (MENU_SCENE_IDS.has(from) || MENU_SCENE_IDS.has(to)) return false;

  if (isMazeSceneAttr(fromAttr) || isMazeSceneAttr(toAttr)) return false;

  const fromRegion = getTravelRegion(from);
  const toRegion = getTravelRegion(to);
  if (fromRegion === toRegion) return false;

  return true;
}

exports.CITY_TRAVEL_STAMINA_PERCENT = CITY_TRAVEL_STAMINA_PERCENT;
exports.getTravelRegion = getTravelRegion;
exports.isMazeSceneAttr = isMazeSceneAttr;
exports.shouldApplyCityTravelStaminaCost = shouldApplyCityTravelStaminaCost;

});

__wgDef("gpic-renderer.js", function (exports) {
/**
 * GPIC renderer - client-side approximation of Delphi game_pic_from_text / AAFont.
 */
const { fetchDecodedText } = __wgImport("text-encoding.js", {"fetchDecodedText":"fetchDecodedText"});

const GPIC_CACHE = new Map();
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let effectsPromise = null;

const COLOR_NAMES = {
  clblack: '#000000',
  clwhite: '#ffffff',
  clwindow: '#ffffff',
  clwindowtext: '#000000',
  clgreen: '#008000',
  clmaroon: '#800000',
  clpurple: '#800080',
  clnavy: '#000080',
  clred: '#ff0000',
  clblue: '#0000ff',
  clyellow: '#ffff00',
  claqua: '#00ffff',
  cllime: '#00ff00',
  clfuchsia: '#ff00ff',
  clsilver: '#c0c0c0',
  clgray: '#808080',
  clteal: '#008080',
  clolive: '#808000',
};

const FONT_FALLBACK = {
  '\u96b6\u4e66': '"STLiti", "LiSu", "KaiTi", serif',
  '\u5b8b\u4f53': '"SimSun", "NSimSun", serif',
  '\u9ed1\u4f53': '"SimHei", sans-serif',
  '\u6977\u4f53': '"KaiTi", "STKaiti", serif',
  '\u5345\u4e66': '"STXingkai", "KaiTi", cursive',
};

 function loadGpicEffects() {
  if (!effectsPromise) {
    effectsPromise = fetchDecodedText('data/effect.ini')
      .then(parseEffectIni)
      .catch(() => ({}));
  }
  return effectsPromise;
}

 function parseEffectIni(text) {
  const effects = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1);
      effects[current] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0 && current) {
      effects[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return effects;
}

 function parseGpicUrl(rawUrl) {
  let s = rawUrl.replace(/^gpic:\/\//i, '').replace(/%20/g, ' ');
  while (s.endsWith('/')) s = s.slice(0, -1);

  if (s.length < 50) {
    return { mode: 'file', path: s.replace(/\\/g, '/') };
  }

  const slash = s.indexOf('/');
  const main = slash >= 0 ? s.slice(0, slash) : s;
  const parts = splitGpicFields(main);

  return {
    mode: 'render',
    width: parseInt(parts[0], 10) || 0,
    height: parseInt(parts[1], 10) || 0,
    font: parseFontTuple(parts[2] || ''),
    bgColor: delphiColor(parts[3] || 'clWindow'),
    content: parts[4] || ' ',
    effect: parts[5] || 'AT1000',
    emboss: parseInt(parts[6], 10) || 0,
    transparency: parseInt(parts[7], 10) || 0,
  };
}

function splitGpicFields(main) {
  const parts = [];
  let i = 0;
  while (i < main.length && parts.length < 2) {
    const comma = main.indexOf(',', i);
    parts.push(main.slice(i, comma));
    i = comma + 1;
  }
  if (main[i] !== '(') throw new Error('GPIC font tuple missing');
  const close = main.indexOf(')', i);
  parts.push(main.slice(i + 1, close));
  i = close + 2;
  const rest = main.slice(i).split(',');
  parts.push(...rest);
  return parts;
}

function parseFontTuple(tuple) {
  const chunks = [];
  let cur = '';
  let depth = 0;
  for (const ch of tuple) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      chunks.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) chunks.push(cur.trim());

  const name = chunks[0] || '\u96b6\u4e66';
  const size = parseInt(chunks[2], 10) || 24;
  const styles = (chunks[3] || '').toLowerCase();
  const color = delphiColor((chunks[4] || '{clBlack}').replace(/[{}]/g, ''));

  return {
    name,
    size,
    bold: styles.includes('bold'),
    italic: styles.includes('italic'),
    underline: styles.includes('underline'),
    color,
    css: buildFontCss(name, size, styles, color),
  };
}

function buildFontCss(name, size, styles, color) {
  const family = FONT_FALLBACK[name] || `"${name}", "Microsoft YaHei", sans-serif`;
  const weight = styles.includes('bold') ? '700' : '400';
  const style = styles.includes('italic') ? 'italic' : 'normal';
  return `${style} ${weight} ${Math.round(size * 0.95)}px ${family}`;
}

 function delphiColor(value) {
  const v = String(value).trim();
  const named = COLOR_NAMES[v.toLowerCase()];
  if (named) return named;
  const num = parseInt(v, 10);
  if (Number.isNaN(num)) return '#000000';
  const r = num & 0xff;
  const g = (num >> 8) & 0xff;
  const b = (num >> 16) & 0xff;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function invertColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = 255 - (n & 0xff);
  const g = 255 - ((n >> 8) & 0xff);
  const b = 255 - ((n >> 16) & 0xff);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function parsePositionedSegments(content, width, height) {
  if (!content.includes('{')) {
    return [{ x: null, y: null, text: content }];
  }
  const segments = [];
  let rest = content;
  while (rest.length) {
    const open = rest.indexOf('{');
    if (open < 0) {
      if (rest.trim()) segments.push({ x: null, y: null, text: rest });
      break;
    }
    if (open > 0) segments.push({ x: null, y: null, text: rest.slice(0, open) });
    rest = rest.slice(open + 1);
    const at = rest.indexOf('@');
    const close = rest.indexOf('}');
    if (at < 0 || close < 0) break;
    let x = parseInt(rest.slice(0, at), 10) || 0;
    let y = parseInt(rest.slice(at + 1, close), 10) || 0;
    if (x < 0) x = width + x;
    if (y < 0) y = height + y;
    rest = rest.slice(close + 1);
    const next = rest.indexOf('{');
    const text = next >= 0 ? rest.slice(0, next) : rest;
    segments.push({ x, y, text });
    rest = next >= 0 ? rest.slice(next) : '';
  }
  return segments;
}

function drawProcedural(ctx, w, h, token) {
  if (token === '$tree') {
    ctx.fillStyle = '#5c3d1e';
    ctx.fillRect(w / 2 - 8, h * 0.55, 16, h * 0.4);
    ctx.fillStyle = '#2d6a3e';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.42, Math.min(w, h) * 0.28, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (token === '$grass') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7ec850');
    g.addColorStop(1, '#3a7d2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) {
      ctx.strokeStyle = i % 2 ? '#4f9b3a' : '#2f6b22';
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, h);
      ctx.lineTo(Math.random() * w, h * 0.5);
      ctx.stroke();
    }
    return;
  }
  if (token.startsWith('$ifs')) {
    ctx.fillStyle = '#dfe8f7';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i += 1) {
      ctx.fillStyle = `hsla(${200 + Math.random() * 40}, 40%, ${50 + Math.random() * 30}%, 0.35)`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

async function loadImageUrl(url) {
  const resolvePacked = window.__WG_RESOLVE_URL__;
  const src = typeof resolvePacked === 'function' ? resolvePacked(url) : url;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function applyEffect(ctx, text, x, y, font, effect, textColor) {
  const alpha = (parseInt(effect.Alpha, 10) || 100) / 100;
  const angle = (parseInt(effect.Angle, 10) || 0) * (Math.PI / 180);
  const outline = effect.Outline === '1';
  const shadow = effect.Shadow === '1';
  const gradual = effect.Gradual === '1';
  const blur = parseInt(effect.Blur, 10) || 0;

  ctx.save();
  ctx.font = font.css;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = alpha;

  if (angle) {
    ctx.translate(x, y);
    ctx.rotate(angle);
    x = 0;
    y = 0;
  }

  if (shadow) {
    ctx.save();
    ctx.shadowColor = delphiColor(parseInt(effect.ShadowColor, 10) || 4473924);
    ctx.shadowBlur = (parseInt(effect.ShadowBlur, 10) || 8) / 4;
    ctx.shadowOffsetX = parseInt(effect.ShadowOffsetX, 10) || 2;
    ctx.shadowOffsetY = parseInt(effect.ShadowOffsetY, 10) || 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  if (outline) {
    ctx.lineWidth = Math.max(2, font.size / 12);
    ctx.strokeStyle = gradual
      ? delphiColor(parseInt(effect.GradualEndColor, 10) || 0)
      : invertColor(textColor);
    ctx.strokeText(text, x, y);
  }

  if (gradual) {
    const m = ctx.measureText(text);
    const grad = ctx.createLinearGradient(x, y, x, y + font.size);
    grad.addColorStop(0, textColor);
    grad.addColorStop(1, delphiColor(parseInt(effect.GradualEndColor, 10) || 0));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = textColor;
  }

  if (blur > 0) {
    ctx.filter = `blur(${blur / 15}px)`;
  }

  const metrics = ctx.measureText(text);
  ctx.fillText(text, x, y);

  if (parseInt(effect.Noise, 10) > 0 || parseInt(effect.Spray, 10) > 0) {
    const spray = parseInt(effect.Spray, 10) || 0;
    const noise = parseInt(effect.Noise, 10) || 0;
    const dots = spray ? spray * 8 : noise / 4;
    for (let i = 0; i < dots; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
      ctx.fillRect(x + Math.random() * metrics.width, y + Math.random() * font.size, 1, 1);
    }
  }

  ctx.restore();
}

function measureBlock(ctx, font, segments) {
  ctx.font = font.css;
  let maxW = 0;
  let totalH = font.size;
  for (const seg of segments) {
    const w = ctx.measureText(seg.text).width;
    if (w > maxW) maxW = w;
  }
  return { width: maxW, height: totalH };
}

 async function renderGpic(rawUrl, effects, options = {}) {
  const cacheKey = rawUrl;
  if (GPIC_CACHE.has(cacheKey)) return GPIC_CACHE.get(cacheKey);

  const spec = parseGpicUrl(rawUrl);
  let result;

  if (spec.mode === 'file') {
    result = await renderFileGpic(spec.path);
  } else {
    result = await renderCompositeGpic(spec, effects, options);
  }

  GPIC_CACHE.set(cacheKey, result);
  return result;
}

async function renderFileGpic(path) {
  const clean = path.replace(/\\/g, '/').split('/').pop();
  const candidates = [
    `data/img/${clean}`,
    `data/img/${path}`,
  ];
  for (const url of candidates) {
    try {
      const img = await loadImageUrl(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      // try next
    }
  }
  return renderMissingFilePlaceholder(clean);
}

function renderMissingFilePlaceholder(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#999';
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.fillStyle = '#666';
  ctx.font = '12px sans-serif';
  ctx.fillText(name.slice(0, 14), 6, 18);
  return canvas.toDataURL('image/png');
}

async function renderCompositeGpic(spec, effects, options) {
  const effect = effects[spec.effect] || effects.AT1000 || {};
  let width = spec.width || options.defaultWidth || 640;
  let height = spec.height || options.defaultHeight || 120;
  if (width <= 0) width = options.defaultWidth || 640;
  if (height <= 0) height = options.defaultHeight || 120;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = spec.bgColor;
  ctx.fillRect(0, 0, width, height);

  let content = spec.content;
  if (/\.jpg$/i.test(content) && !content.includes('://')) {
    try {
      const img = await loadImageUrl(`data/img/${content.replace(/\\/g, '/')}`);
      ctx.drawImage(img, 0, 0, width, height);
      content = ' ';
    } catch {
      // keep background color
    }
  } else if (content.startsWith('$')) {
    drawProcedural(ctx, width, height, content.split('-')[0]);
    content = ' ';
  }

  if (content.trim()) {
    const segments = parsePositionedSegments(content, width, height);
    const metrics = measureBlock(ctx, spec.font, segments);
    for (const seg of segments) {
      let x = seg.x;
      let y = seg.y;
      if (x == null) x = (width - metrics.width) / 2;
      if (y == null) y = (height - metrics.height) / 2;
      applyEffect(ctx, seg.text, x, y, spec.font, effect, spec.font.color);
    }
  }

  if (spec.emboss) {
    const imageData = ctx.getImageData(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(canvas, -1, -1);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(canvas, 1, 1);
    ctx.putImageData(imageData, 0, 0);
  }

  if (spec.transparency > 0) {
    const alpha = 1 - spec.transparency / 100;
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < imageData.data.length; i += 4) {
      imageData.data[i] = Math.round(imageData.data[i] * alpha);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas.toDataURL('image/jpeg', 0.85);
}

 async function hydrateGpicElements(root, options = {}) {
  if (!root) return;
  await loadGpicEffects();
  const effects = await effectsPromise;

  const imgs = root.querySelectorAll('img[data-gpic]');
  await Promise.all([...imgs].map(async (img) => {
    const raw = decodeURIComponent(img.getAttribute('data-gpic') || '');
    if (!raw) return;
    try {
      img.src = await renderGpic(raw, effects, options);
      img.removeAttribute('data-gpic');
      img.classList.remove('gpic-loading');
    } catch (err) {
      console.warn('GPIC render failed:', raw, err);
      img.alt = decodeGpicLabel(raw);
      img.classList.add('gpic-error');
    }
  }));

  const bgEls = root.querySelectorAll('[data-gpic-bg]');
  await Promise.all([...bgEls].map(async (el) => {
    const raw = decodeURIComponent(el.getAttribute('data-gpic-bg') || '');
    if (!raw) return;
    try {
      const rect = el.getBoundingClientRect();
      const dataUrl = await renderGpic(raw, effects, {
        defaultWidth: Math.max(400, Math.round(rect.width) || 800),
        defaultHeight: Math.max(300, Math.round(rect.height) || 600),
      });
      el.style.backgroundImage = `url("${dataUrl}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center center';
      el.removeAttribute('data-gpic-bg');
    } catch (err) {
      console.warn('GPIC background failed:', raw, err);
    }
  }));
}

function decodeGpicLabel(url) {
  try {
    const spec = parseGpicUrl(url);
    if (spec.mode === 'file') return spec.path;
    return spec.content.replace(/\{[^}]+\}/g, '').trim() || 'GPIC';
  } catch {
    return 'GPIC';
  }
}



exports.loadGpicEffects = loadGpicEffects;
exports.parseEffectIni = parseEffectIni;
exports.parseGpicUrl = parseGpicUrl;
exports.delphiColor = delphiColor;
exports.renderGpic = renderGpic;
exports.hydrateGpicElements = hydrateGpicElements;
exports["TRANSPARENT_PIXEL"] = TRANSPARENT_PIXEL;

});

__wgDef("dialogue-engine.js", function (exports) {
/**
 * WordGame dialogue engine ?? parses ?????? and drives NPC chat trees.
 */

 function preprocessChatScript(text, evalCondition) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line || line.startsWith(';;')) continue;
    lines.push(line);
  }
  return filterChatIfBlocks(lines, evalCondition).map((line) => expandInlineIf(line, evalCondition));
}

function isChatIfLine(line) {
  return /^if\s+.+\s+then\s*$/i.test(String(line || '').trim());
}

function isChatElseLine(line) {
  return /^else\s*$/i.test(String(line || '').trim());
}

function isChatEndLine(line) {
  return /^end\s*;?\s*$/i.test(String(line || '').trim());
}

function findChatElse(lines, ifIdx) {
  let depth = 0;
  for (let i = ifIdx + 1; i < lines.length; i += 1) {
    if (isChatIfLine(lines[i])) depth += 1;
    else if (isChatEndLine(lines[i])) {
      if (depth === 0) return -1;
      depth -= 1;
    } else if (isChatElseLine(lines[i]) && depth === 0) return i;
  }
  return -1;
}

function findChatEnd(lines, ifIdx) {
  let depth = 1;
  for (let i = ifIdx + 1; i < lines.length; i += 1) {
    if (isChatIfLine(lines[i])) depth += 1;
    else if (isChatEndLine(lines[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function filterChatIfBlocks(lines, evalCondition) {
  let out = [...lines];
  for (let guard = 0; guard < 400; guard += 1) {
    const i = out.findIndex((line) => isChatIfLine(line));
    if (i < 0) break;
    const cond = out[i].match(/^if\s+(.+)\s+then\s*$/i)[1].trim();
    const elseIdx = findChatElse(out, i);
    const endIdx = findChatEnd(out, i);
    if (endIdx < 0) break;
    const picked = evalCondition(cond)
      ? out.slice(i + 1, elseIdx >= 0 ? elseIdx : endIdx)
      : (elseIdx >= 0 ? out.slice(elseIdx + 1, endIdx) : []);
    out = [...out.slice(0, i), ...picked, ...out.slice(endIdx + 1)];
  }
  return out;
}

 function expandInlineIf(text, evalCondition) {
  let s = text;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const m = s.match(/if\s+(.+?)\s+then(?![A-Za-z0-9_])/i);
    if (!m) break;
    const start = m.index;
    const cond = m[1].trim();
    const afterThen = start + m[0].length;
    const elseIdx = findInlineKeyword(s, afterThen, 'else');
    const endIdx = findInlineKeyword(s, afterThen, 'end');
    const splitIdx = elseIdx >= 0 ? elseIdx : endIdx;
    if (splitIdx < 0) break;
    const truePart = s.slice(afterThen, splitIdx).trim();
    const falsePart = elseIdx >= 0
      ? s.slice(elseIdx + 4, endIdx >= 0 ? endIdx : s.length).trim()
      : '';
    const replacement = evalCondition(cond) ? truePart : falsePart;
    s = s.slice(0, start) + replacement + (endIdx >= 0 ? s.slice(endIdx + 3) : '');
  }
  return s.replace(/\s*end\s*$/i, '').trim();
}

function isIdentChar(ch) {
  return /[A-Za-z0-9_]/.test(ch || '');
}

function findInlineKeyword(s, from, word) {
  const lower = s.toLowerCase();
  for (let i = from; i <= s.length - word.length; i += 1) {
    if (word === 'else' && lower.startsWith('elseif', i)) {
      i += 5;
      continue;
    }
    if (!lower.startsWith(word, i)) continue;
    const before = i === 0 ? '' : s[i - 1];
    const after = s[i + word.length] || '';
    if (!isIdentChar(before) && !isIdentChar(after)) return i;
  }
  return -1;
}

 function parseDialogueLine(line) {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;

  const head = line.slice(0, eq).trim();
  let tail = line.slice(eq + 1).trim();
  const headParts = head.split(',').map((p) => p.trim());
  const speaker = headParts[0];
  const path = headParts.slice(1);

  let action = '';
  if (tail.startsWith('[')) {
    const close = tail.indexOf(']');
    if (close > 0) {
      action = tail.slice(1, close).trim();
      tail = tail.slice(close + 1).trim();
    }
  }

  const comma = tail.indexOf(',');
  if (comma <= 0) return null;
  const id = parseInt(tail.slice(0, comma), 10);
  if (Number.isNaN(id)) return null;
  const text = tail.slice(comma + 1).trim().replace(/https?:\/\/\S+/gi, '').trim();

  return {
    speaker,
    path,
    pathKey: path.join(','),
    branchSet: path.length ? path.join('') : '0',
    id,
    action,
    text,
    raw: line,
    isPlayer: speaker === 'I',
    matchPrefix: path.length ? `${speaker},${path.join(',')}` : speaker,
  };
}

 function buildChatEntries(lines) {
  return lines.map(parseDialogueLine).filter(Boolean);
}

function getTalkIndex(entry) {
  return entry.id;
}

 class DialogueEngine {
  constructor(api) {
    this.api = api;
    this.entries = [];
    this.npcName = '';
    this.chatId = 0;
    this.branch = [];
    this.chatIndex = 0;
    this.currentOptions = [];
  }

  loadScript(scriptText) {
    const lines = preprocessChatScript(scriptText, (cond) => this.api.evalCondition(cond));
    this.entries = buildChatEntries(lines);
    this.chatIndex = 0;
  }

  reset() {
    this.npcName = '';
    this.chatId = 0;
    this.branch = [];
    this.chatIndex = 0;
    this.currentOptions = [];
  }

  startTalk(npcName) {
    this.npcName = npcName;
    this.chatId = 1;
    this.branch = [];
    this.chatIndex = 0;
    this.api.game_chat_cleans();
    return this.runTalkStep();
  }

  buildSearchPrefixes() {
    return [];
  }

  findNpcLine() {
    const candidates = this.entries.filter((entry, index) => {
      if (entry.isPlayer) return false;
      if (entry.speaker !== this.npcName) return false;
      if (entry.id !== this.chatId) return false;
      if (entry.path.length !== this.branch.length) return false;
      return entry.path.every((p, idx) => p === this.branch[idx]);
    });
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.chatIndex = this.entries.indexOf(pick);
    return pick;
  }

  findPlayerOptions(npcLine) {
    const id = this.chatId;
    let pathPrefix = 'I';
    if (npcLine?.path?.length) pathPrefix = `I,${npcLine.path.join(',')}`;

    const options = [];
    for (let i = this.chatIndex + 1; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      if (!entry.isPlayer) {
        if (entry.speaker !== this.npcName) break;
        if (options.length) break;
        continue;
      }
      if (entry.id !== id) break;
      if (pathPrefix === 'I') {
        if (entry.matchPrefix === 'I' || (entry.path.length === 1 && entry.matchPrefix.startsWith('I,'))) {
          options.push(entry);
          continue;
        }
        if (options.length) break;
        continue;
      }
      const depth = (npcLine?.path?.length || 0) + 1;
      if (entry.path.length === depth && entry.matchPrefix.startsWith(`${pathPrefix},`)) {
        options.push(entry);
      } else if (options.length) {
        break;
      }
    }
    return options;
  }

  async runTalkStep() {
    const npcLine = this.findNpcLine();
    if (!npcLine) {
      this.api.game_chat('\uFF08\u5bf9\u8bdd\u7ed3\u675f\uFF09');
      return false;
    }

    if (npcLine.action) {
      await this.api.runScript(npcLine.action);
      this.persist();
    }

    const speakerLabel = this.api.game_newname_from_oldname(this.npcName);
    const text = expandInlineIf(npcLine.text, (c) => this.api.evalCondition(c));
    if (text) {
      const html = `${speakerLabel}\uFF1A<strong>${text}</strong>`;
      this.api.renderChatLine(html, false);
    } else {
      this.api.ui.showChat();
    }

    const options = this.findPlayerOptions(npcLine);
    this.currentOptions = options;
    if (!options.length) {
      this.chatId += 1;
      this.chatIndex += 1;
      return this.runTalkStep();
    }

    options.forEach((opt, idx) => {
      this.api.renderChatLine(`<a href="#" class="chat-option" data-dialogue-opt="${idx}">${opt.text}</a>`, true);
    });
    return true;
  }

  async selectOption(index) {
    const opt = this.currentOptions[index];
    if (!opt) return;

    this.api.game_chat_cleans();
    if (opt.action) await this.api.runScript(opt.action);

    this.branch = [...opt.path];
    this.chatId += 1;
    this.chatIndex += 1;
    this.persist();
    await this.runTalkStep();
  }

  persist() {
    if (!this.api.state.dialogue) this.api.state.dialogue = {};
    this.api.state.dialogue[this.npcName] = {
      chatId: this.chatId,
      branch: [...this.branch],
      chatIndex: this.chatIndex,
    };
  }

  restore(npcName) {
    const saved = this.api.state.dialogue?.[npcName];
    if (!saved) return;
    this.chatId = saved.chatId || 0;
    this.branch = saved.branch || [];
    this.chatIndex = saved.chatIndex || 0;
  }
}

exports.preprocessChatScript = preprocessChatScript;
exports.expandInlineIf = expandInlineIf;
exports.parseDialogueLine = parseDialogueLine;
exports.buildChatEntries = buildChatEntries;
exports.DialogueEngine = DialogueEngine;

});

__wgDef("craft-panel.js", function (exports) {
const { getCraftConfig, getSkillBookMap, formatGoodsSummary, getGoodsInfo } = __wgImport("goods-data.js", {"getCraftConfig":"getCraftConfig","getSkillBookMap":"getSkillBookMap","formatGoodsSummary":"formatGoodsSummary","getGoodsInfo":"getGoodsInfo"});

 class CraftPanel {
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

 function learnSkillFromItem(api, itemName) {
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

exports.CraftPanel = CraftPanel;
exports.learnSkillFromItem = learnSkillFromItem;

});

__wgDef("game-script.js", function (exports) {
const { STAT, ensureParty, findRoleIndex, readValues, writeValues, syncPlayerFromRole, syncRoleFromPlayer, getRoleCount, getRoleH, getRoleDisplayName, getGoodsTypeIcon, gameBaseRandom, gameBaseRandomZero, gameRandomChance, parseEventIdList, sceneEventValue, resEventValue, createRoleFromTemplate } = __wgImport("game-runtime.js", {"STAT":"STAT","ensureParty":"ensureParty","findRoleIndex":"findRoleIndex","readValues":"readValues","writeValues":"writeValues","syncPlayerFromRole":"syncPlayerFromRole","syncRoleFromPlayer":"syncRoleFromPlayer","getRoleCount":"getRoleCount","getRoleH":"getRoleH","getRoleDisplayName":"getRoleDisplayName","getGoodsTypeIcon":"getGoodsTypeIcon","gameBaseRandom":"gameBaseRandom","gameBaseRandomZero":"gameBaseRandomZero","gameRandomChance":"gameRandomChance","parseEventIdList":"parseEventIdList","sceneEventValue":"sceneEventValue","resEventValue":"resEventValue","createRoleFromTemplate":"createRoleFromTemplate"});
const { getBiaoYueduHtml, getIncludeCache } = __wgImport("game-config.js", {"getBiaoYueduHtml":"getBiaoYueduHtml","getIncludeCache":"getIncludeCache"});
const { preprocessSceneHtml } = __wgImport("scene-parser.js", {"preprocessSceneHtml":"preprocessSceneHtml"});
const { getGoodsInfo } = __wgImport("goods-data.js", {"getGoodsInfo":"getGoodsInfo"});

 function parseGameArgs(raw) {
  const args = [];
  let cur = '';
  let quote = '';
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inQuote) {
      cur += ch;
      if (ch === quote) inQuote = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = true;
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) args.push(parseGameArg(cur.trim()));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(parseGameArg(cur.trim()));
  return args;
}

function parseGameArg(token) {
  if (/^-?\d+$/.test(token)) return Number(token);
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1);
  }
  return token;
}

 function parseGameCall(expr) {
  const trimmed = expr.trim();
  const consumed = consumeGameCall(trimmed);
  return consumed ? consumed.call : null;
}

function consumeGameCall(text) {
  const m = String(text || '').match(/^\s*(game_\w+)\s*\(/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  let depth = 0;
  let inQuote = false;
  let quote = '';
  const start = m[0].length - 1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === quote) inQuote = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = true;
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          call: { name, args: parseGameArgs(text.slice(start + 1, i)) },
          length: i + 1,
        };
      }
    }
  }
  return null;
}

 function evalGameExpr(api, token) {
  const t = String(token ?? '').trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const plus = t.match(/^(game_\w+\([\s\S]*\))\s*\+\s*(-?\d+)$/i);
  if (plus) {
    const call = parseGameCall(plus[1]);
    if (call) return Number(api.invokeGame(call.name, call.args) || 0) + Number(plus[2]);
  }
  const call = parseGameCall(t);
  if (call) return Number(api.invokeGame(call.name, call.args) || 0);
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

function resolveHandlerArg(api, arg) {
  if (typeof arg === 'string' && /^game_\w+\s*\(/i.test(arg)) {
    const nested = parseGameCall(arg);
    if (nested) {
      return invokeHandlerSync(api, nested.name, nested.args.map((item) => resolveHandlerArg(api, item)));
    }
  }
  return arg;
}

function invokeHandlerSync(api, name, args) {
  const fn = api.handlers?.[name];
  if (!fn) return 0;
  const resolved = (args || []).map((arg) => resolveHandlerArg(api, arg));
  const result = fn(...resolved);
  if (result && typeof result.then === 'function') return 0;
  return result;
}

function compareNumbers(left, op, right) {
  const a = Number(left);
  const b = Number(right);
  if (op === '=' || op === '==') return a === b;
  if (op === '!=' || op === '<>') return a !== b;
  if (op === '>=') return a >= b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  return false;
}

 function evalConditionSync(api, expr) {
  const cleaned = String(expr || '').trim();
  if (!cleaned) return false;
  if (/^-?\d+$/.test(cleaned)) return Number(cleaned) !== 0;

  if (/\band\b/i.test(cleaned)) {
    return cleaned.split(/\band\b/i).every((part) => evalConditionSync(api, part.trim()));
  }
  if (/\bor\b/i.test(cleaned)) {
    return cleaned.split(/\bor\b/i).some((part) => evalConditionSync(api, part.trim()));
  }

  let m;
  if ((m = cleaned.match(/^not\s+(.+)$/i))) {
    return !evalConditionSync(api, m[1].trim());
  }

  if ((m = cleaned.match(/^(game_\w+\([\s\S]*\))\s*(===|==|=|!=|<>|>=|<=|>|<)\s*(-?\d+)\s*$/i))) {
    const call = parseGameCall(m[1]);
    if (!call) return false;
    return compareNumbers(invokeHandlerSync(api, call.name, call.args), m[2], m[3]);
  }

  const call = parseGameCall(cleaned);
  if (call) return !!invokeHandlerSync(api, call.name, call.args);

  if ((m = cleaned.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return sceneEventValue(api.state, Number(m[1])) !== 0;
  }
  if ((m = cleaned.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return resEventValue(api.state, Number(m[1])) !== 0;
  }

  return false;
}

 function evalCondition(api, expr) {
  return evalConditionSync(api, expr);
}

 function evalTemplate(api, expr, ctx) {
  let rest = String(expr || '').trim();
  if (!rest) return '';

  let out = '';
  while (rest.length) {
    let m = rest.match(/^game_true\s*\(\s*(\d+)\s*\)/i);
    if (m) {
      if (Number(m[1]) === 0) return '';
      rest = rest.slice(m[0].length);
      continue;
    }

    m = rest.match(/^exeing\s+game_include_str\s*\(\s*'([^']*)'\s*\)/i);
    if (m) {
      out += api.renderInclude(m[1], ctx);
      rest = rest.slice(m[0].length);
      continue;
    }

    if (/^string\s+/i.test(rest)) {
      const after = rest.replace(/^string\s+/i, '');
      const consumed = consumeGameCall(after);
      if (consumed) {
        out += String(api.invokeGameString(consumed.call.name, consumed.call.args, ctx) ?? '');
        rest = rest.slice(rest.length - after.length + consumed.length);
        continue;
      }
    }

    const consumed = consumeGameCall(rest);
    if (consumed) {
      out += String(api.invokeGameString(consumed.call.name, consumed.call.args, ctx) ?? '');
      rest = rest.slice(consumed.length);
      continue;
    }

    const next = rest.search(/(?:game_true\s*\(|exeing\s+game_include_str|string\s+game_|game_\w+\()/i);
    if (next <= 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, next);
    rest = rest.slice(next);
  }
  return out;
}

 function bindGameHandlers(api) {
  const handlers = {
    game_page: (id) => api.game_page(id),
    game_show_scene: (id) => api.game_show_scene(id),
    game_pop: (n) => api.game_pop(n),
    game_pop_a: (n) => api.game_pop_a(n),
    game_pop_fight: (a, b) => api.game_pop_fight(a, b),
    game_pop_fight_a: (a, b) => api.game_pop_fight(a, b),
    game_pop_dig: (n) => api.game_pop_dig(n),
    game_pop_game: (a, b) => api.game_pop_game(a, b),
    game_start_now: () => api.game_start_now(),
    game_save: (mode) => api.game_save(mode),
    game_save_panel: () => api.game_save_panel(),
    game_goto_home: () => api.game_goto_home(),
    game_goto_oldpage: () => api.game_goto_oldpage(),
    game_reload_direct: () => api.game_reload_direct(),
    game_reload: () => api.game_reload_direct(),
    game_chat_cleans: () => api.game_chat_cleans(),
    game_chat_cleans2: () => api.game_chat_cleans2(),
    game_talk_stop: () => api.game_talk_stop(),
    game_chat: (msg) => api.game_chat(msg),
    game_infobox: (msg) => api.game_infobox(msg),
    game_add_message: (msg) => api.game_add_message(msg),
    game_add_scene_event: (id) => api.game_add_scene_event(id),
    game_del_scene_event: (id) => api.game_del_scene_event(id),
    game_check_scene_event: (id) => api.game_check_scene_event(id),
    game_inc_scene_event: (id, v) => api.game_inc_scene_event(id, v),
    game_dec_scene_event: (id, v) => api.game_dec_scene_event(id, v),
    game_read_scene_integer: (id) => api.game_read_scene_integer(id),
    game_write_scene_integer: (id, v) => api.game_write_scene_integer(id, v),
    game_add_res_event: (id) => api.game_add_res_event(id),
    game_del_res_event: (id) => api.game_del_res_event(id),
    game_check_res_event: (id) => api.game_check_res_event(id),
    game_not_res_event: (id) => api.game_not_res_event(id),
    game_not_scene_event: (id) => api.game_not_scene_event(id),
    game_check_res_event_and: (s) => api.game_check_res_event_and(s),
    game_check_res_event_or: (s) => api.game_check_res_event_or(s),
    game_not_res_event_and: (s) => api.game_not_res_event_and(s),
    game_not_res_event_or: (s) => api.game_not_res_event_or(s),
    game_check_scene_event_and: (s) => api.game_check_scene_event_and(s),
    game_check_scene_event_or: (s) => api.game_check_scene_event_or(s),
    game_not_scene_event_and: (s) => api.game_not_scene_event_and(s),
    game_not_scene_event_or: (s) => api.game_not_scene_event_or(s),
    game_goods_change_n: (name, delta) => api.game_goods_change_n(name, delta),
    game_reload_chatlist: () => api.game_reload_chatlist(),
    game_write_name: (name) => api.game_write_name(name),
    game_add_task: (id) => api.game_add_task(id),
    game_comp_task: (id) => api.game_comp_task(id),
    game_trade: (id, flag) => api.game_trade(id, flag),
    game_accouter1_wid: () => api.game_accouter1_wid(),
    game_check_money: (v) => (api.game_check_money(v) ? 1 : 0),
    game_change_money: (v) => api.game_change_money(v),
    game_question: (text) => (api.game_question(text) ? 1 : 0),
    game_change_sex: (name, sex) => api.game_change_sex(name, sex),
    game_npc_talk: (name) => api.game_npc_talk(name),
    game_spk_string: (text) => api.game_spk_string(text),
    game_random_chance: (n) => (gameRandomChance(api.state, n) ? 1 : 0),
    game_random_chance_2: (n) => gameBaseRandomZero(n),
    game_random_chance_at_sleep: (n) => (gameRandomChance(api.state, n) ? 1 : 0),
    game_sex_from_id: (id) => api.game_sex_from_id(id),
    game_role_count: (n) => (getRoleCount(api.state) >= n ? 1 : 0),
    game_check_goods_nmb: (name, n) => ((api.state.player.goods[name] || 0) >= n ? 1 : 0),
    game_get_goods_count: (name) => api.state.player.goods[name] || 0,
    game_grade: (name, g) => api.game_grade(name, g),
    game_check_role_values: (name, i, v) => (api.game_check_role_values(name, i, v) ? 1 : 0),
    game_check_role_values_byid: (id, statId, value) => api.game_check_role_values_byid(id, statId, value),
    game_id_is_name: (id, name) => api.game_id_is_name(id, name),
    game_can_fly: (i) => api.game_can_fly(i),
    game_read_temp: (id) => api.game_read_temp(id),
    game_write_temp: (id, v) => api.game_write_temp(id, v),
    game_clear_temp: () => api.game_clear_temp(),
    game_check_temp: (id, v) => (api.game_check_temp(id, v) ? 1 : 0),
    game_read_temp_string: (id) => api.game_read_temp_string(id),
    game_write_temp_string: (id, v) => api.game_write_temp_string(id, v),
    game_get_pscene_id: (i) => api.game_get_pscene_id(i),
    game_get_pscene_id_s: (i) => String(api.game_get_pscene_id(i)),
    game_get_newname_at_id: (id) => api.game_get_newname_at_id(id),
    game_get_oldname_at_id: (id) => api.game_get_oldname_at_id(id),
    game_newname_from_oldname: (name) => api.game_newname_from_oldname(name),
    game_role_is_exist: (name) => (findRoleIndex(api.state, name) >= 0 ? 1 : 0),
    game_add_friend: (name, mode) => api.game_add_friend(name, mode),
    game_del_friend: (name, showMsg) => api.game_del_friend(name, showMsg),
    game_attribute_change: (p, id, v) => api.game_attribute_change(p, id, v),
    game_role_value_half: (id) => api.game_role_value_half(id),
    game_role_only_show: (name) => api.game_role_only_show(name),
    game_role_reshow: () => api.game_role_reshow(),
    game_set_role_0_hide: (name, x) => api.game_set_role_0_hide(name, x),
    game_inner_html: (id, html) => api.game_inner_html(id, html),
    game_biao_html: (flag) => api.game_biao_html(flag),
    game_true: (v) => (v ? 1 : 0),
    game_inttostr: (v) => String(v),
    game_save_count: () => api.game_save_count(),
    game_at_net: () => 0,
    game_id_exist: (id) => (id <= getRoleCount(api.state) ? 1 : 0),
    game_get_role_suxing: (role, stat) => readValues(api.state, role <= 0 ? 0 : role - 1, stat),
    game_bet: (id, flag) => api.game_bet(id, flag),
    game_over: () => api.game_over(),
    game_kill_game_time: () => api.game_kill_game_time(),
    game_set_game_time: (t, page) => api.game_set_game_time(t, page),
    game_delay: (ms) => api.game_delay(ms),
    game_can_stop_chat: (v) => api.game_can_stop_chat(v),
    game_bubble: (n) => api.game_bubble(n),
    game_wuziqi: (n) => api.game_wuziqi(n),
    game_weather: (i) => api.game_weather(i),
    game_allow_gohome: (v) => api.game_allow_gohome(v),
    game_write_home_id: () => api.game_write_home_id(),
    game_get_money: () => readValues(api.state, 0, STAT.money),
    game_get_read_txt: (i) => api.game_get_read_txt(i),
    game_include_str: (file) => api.game_include_str(file),
    game_res_goods: (i, sl, name) => api.game_res_goods(i, sl, name),
    game_role_sex_count: (sex) => api.game_role_sex_count(sex),
    game_role_all_mtl: (p) => api.game_role_all_mtl(p),
    game_id_from_oldname: (name) => api.game_id_from_oldname(name),
    game_get_fm_1: (sex) => api.game_get_fm_1(sex),
    game_sex_from_name: (name) => api.game_sex_from_name(name),
    game_read_factor: () => api.game_read_factor(),
    game_write_factor: (v) => api.game_write_factor(v),
    game_chat_spk_add: (s) => api.game_chat_spk_add(s),
    game_show_set: () => api.game_show_set(),
    game_clear_money: () => api.game_clear_money(),
    game_not_rename: (id) => api.game_not_rename(id),
    game_checkname_abc: (name) => api.game_checkname_abc(name),
    game_time_exe: (ms, script) => api.game_time_exe(ms, script),
    game_run_off_no: (i) => api.game_run_off_no(i),
    game_integer_comp: (a, op, b) => api.game_integer_comp(a, op, b),
    game_del_friend_byid: (a, b) => api.game_del_friend_byid(a, b),
    game_rename: (name) => api.game_rename(name),
    game_rename_byid: (id, name) => api.game_rename_byid(id, name),
    game_get_accoutre: (role, slot) => api.game_get_accoutre(role, slot),
    game_show_logon: () => 0,
    game_show_dwjh: () => 0,
  };

  api.handlers = handlers;
  api.invokeGame = async (name, args) => {
    const fn = handlers[name];
    if (!fn) return 0;
    const resolved = (args || []).map((arg) => resolveHandlerArg(api, arg));
    return fn(...resolved);
  };
  api.invokeGameString = (name, args, ctx) => {
    const resolved = (args || []).map((arg) => {
      if (typeof arg === 'string' && /^game_\w+\s*\(/i.test(arg)) {
        const nested = parseGameCall(arg);
        if (nested) return api.invokeGameString(nested.name, nested.args, ctx);
      }
      return arg;
    });
    if (name === 'game_res_goods') return api.game_res_goods_html(resolved[0], resolved[1], resolved[2], ctx);
    if (name === 'game_get_read_txt') return api.game_get_read_txt(resolved[0]);
    if (name === 'game_include_str') return api.game_include_str(resolved[0]);
    const fn = handlers[name];
    if (!fn) return '';
    const result = fn(...resolved);
    if (result && typeof result.then === 'function') return '';
    return result ?? '';
  };
}

 function buildResGoodsHtml(api, i, sl, name, ctx) {
  const state = api.state;
  const getPic = () => `<img src="data/img/${getGoodsTypeIcon(name)}" border="0">`;

  if (i > 0 && i <= 100) {
    if (gameRandomChance(state, i)) {
      const spanId = i + Math.floor(Math.random() * 100);
      return `<span id="bo_${spanId}"><a href="game_goods_change_n('${name}',${sl});game_chat('\u6361\u5230${name}${sl}');game_inner_html(${spanId},' ')" title="\u6361\u8d77">${getPic()}</a></span>`;
    }
    return ' ';
  }

  let eventId = i;
  if (eventId <= 0) eventId = api.game_get_pscene_id(eventId);
  if (resEventValue(state, eventId) !== 0) return ' ';

  return `<span id="bo_${eventId}"><a href="game_goods_change_n('${name}',${sl});game_chat('\u6361\u5230${name}${sl}');game_add_res_event(${eventId});game_inner_html(${eventId},' ')" title="\u6361\u8d77">${getPic()}</a></span>`;
}

 function renderIncludeHtml(api, file, ctx) {
  const base = String(file || '').replace(/\.upp$/i, '').replace(/^dat[/\\]/i, '');
  const text = getIncludeCache(base) || (base === 'biao_yuedu' ? getBiaoYueduHtml() : '');
  if (!text) return '';
  return preprocessSceneHtml(text, ctx);
}

exports.parseGameArgs = parseGameArgs;
exports.parseGameCall = parseGameCall;
exports.evalGameExpr = evalGameExpr;
exports.evalConditionSync = evalConditionSync;
exports.evalCondition = evalCondition;
exports.evalTemplate = evalTemplate;
exports.bindGameHandlers = bindGameHandlers;
exports.buildResGoodsHtml = buildResGoodsHtml;
exports.renderIncludeHtml = renderIncludeHtml;

});

__wgDef("task-system.js", function (exports) {
const { getTaskInfo } = __wgImport("game-config.js", {"getTaskInfo":"getTaskInfo"});
const { readValues, writeValues, syncPlayerFromRole, STAT } = __wgImport("game-runtime.js", {"readValues":"readValues","writeValues":"writeValues","syncPlayerFromRole":"syncPlayerFromRole","STAT":"STAT"});

/** Parse reward numbers from task description (same order as Delphi game_comp_task). */
 function parseTaskRewards(text) {
  const rewards = { money: 0, exp: 0, itemName: '', itemCount: 0 };
  if (!text) return rewards;

  let field = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      if (start < 0) start = i;
    } else if (start >= 0 && i > start) {
      const n = parseInt(text.slice(start, i), 10);
      field += 1;
      if (field === 1) rewards.money = n;
      else if (field === 2) rewards.exp = n;
      else if (field === 3) rewards.itemCount = n;
      start = -1;
    }
  }

  const quotePairs = [
    ['\u201c', '\u201d'],
    ['\u2018', '\u2019'],
    ['"', '"'],
    ['\u300c', '\u300d'],
  ];
  for (const [open, close] of quotePairs) {
    const j = text.indexOf(open);
    const k = text.indexOf(close, j + 1);
    if (j >= 0 && k > j) {
      rewards.itemName = text.slice(j + open.length, k).trim();
      break;
    }
  }

  return rewards;
}

function gameBaseRandom(mod) {
  const m = mod > 0 ? mod : 1;
  return Math.floor(Math.random() * m);
}

/** Simplified port of Unit_pop.game_upgrade for role index 0-based. */
 function tryRoleUpgrade(state, roleIndex = 0) {
  let upgraded = 0;
  const loop = () => {
    const exp = readValues(state, roleIndex, STAT.experience);
    let need = readValues(state, roleIndex, STAT.upgrade);
    if (need <= 0) {
      need = 500;
      writeValues(state, roleIndex, STAT.upgrade, need);
    }
    if (exp < need) return;

    writeValues(state, roleIndex, STAT.experience, exp - need);
    const grade = readValues(state, roleIndex, STAT.grade) + 1;
    writeValues(state, roleIndex, STAT.grade, grade);
    upgraded = grade;

    const r = gameBaseRandom(5) + 8;
    writeValues(state, roleIndex, STAT.gdtl25, readValues(state, roleIndex, STAT.gdtl25) + 9 + gameBaseRandom(5));
    writeValues(state, roleIndex, STAT.tili, readValues(state, roleIndex, STAT.gdtl25));
    if (grade * 12 > readValues(state, roleIndex, STAT.gdtl25)) {
      writeValues(state, roleIndex, STAT.gdtl25, grade * 14 + 60);
      writeValues(state, roleIndex, STAT.tili, readValues(state, roleIndex, STAT.gdtl25));
    }

    writeValues(state, roleIndex, STAT.gdll26, readValues(state, roleIndex, STAT.gdll26) + 40 + gameBaseRandom(15));
    writeValues(state, roleIndex, STAT.lingli, readValues(state, roleIndex, STAT.gdll26));
    if (grade * 44 > readValues(state, roleIndex, STAT.gdll26)) {
      writeValues(state, roleIndex, STAT.gdll26, grade * 45 + 100);
      writeValues(state, roleIndex, STAT.lingli, readValues(state, roleIndex, STAT.gdll26));
    }

    writeValues(state, roleIndex, STAT.gdsmz27, readValues(state, roleIndex, STAT.gdsmz27) + 20 + gameBaseRandom(8));
    writeValues(state, roleIndex, STAT.life, readValues(state, roleIndex, STAT.gdsmz27));
    if (grade * 23 > readValues(state, roleIndex, STAT.gdsmz27)) {
      writeValues(state, roleIndex, STAT.gdsmz27, grade * 25 + 130);
      writeValues(state, roleIndex, STAT.life, readValues(state, roleIndex, STAT.gdsmz27));
    }

    writeValues(state, roleIndex, STAT.upgrade, Math.floor((grade * 500 * r) / 10));
    writeValues(state, roleIndex, STAT.speed, readValues(state, roleIndex, STAT.speed) + 1);
    writeValues(state, roleIndex, STAT.attack, readValues(state, roleIndex, STAT.attack) + 5);
    writeValues(state, roleIndex, STAT.intellect, readValues(state, roleIndex, STAT.intellect) + 1);
    writeValues(state, roleIndex, STAT.defend, readValues(state, roleIndex, STAT.defend) + 2);

    if (readValues(state, roleIndex, STAT.experience) >= readValues(state, roleIndex, STAT.upgrade)) {
      loop();
    }
  };
  loop();
  return upgraded;
}

/** Grant task completion rewards and chat feedback (Delphi game_comp_task). */
 function applyTaskRewards(api, taskText) {
  const rewards = parseTaskRewards(taskText);

  if (rewards.money > 0) {
    api.game_change_money(rewards.money);
    api.game_chat(`\u91d1\u94b1\u589e\u52a0\uff1a${rewards.money}`);
  }
  if (rewards.exp > 0) {
    api.game_attribute_change(1, STAT.experience, rewards.exp);
    api.game_chat(`\u7ecf\u9a8c\u503c\u589e\u52a0\uff1a${rewards.exp}`);
    const newLevel = tryRoleUpgrade(api.state, 0);
    if (newLevel > 0) {
      api.game_chat(`\u7b49\u7ea7\u63d0\u5347\u5230\uff1a${newLevel}`);
      syncPlayerFromRole(api.state, 0);
      api.ui.refreshStatus();
    }
  }
  if (rewards.itemCount > 0 && rewards.itemName) {
    api.game_goods_change_n(rewards.itemName, rewards.itemCount);
  }
}

 function getTaskDescription(id) {
  return getTaskInfo(id)?.text || '';
}

exports.parseTaskRewards = parseTaskRewards;
exports.tryRoleUpgrade = tryRoleUpgrade;
exports.applyTaskRewards = applyTaskRewards;
exports.getTaskDescription = getTaskDescription;

});

__wgDef("game-api.js", function (exports) {
const { loadScene, peekSceneMeta, preprocessSceneHtml, wireGameLinks, normalizeGameLinks } = __wgImport("scene-parser.js", {"loadScene":"loadScene","peekSceneMeta":"peekSceneMeta","preprocessSceneHtml":"preprocessSceneHtml","wireGameLinks":"wireGameLinks","normalizeGameLinks":"normalizeGameLinks"});
const { CITY_TRAVEL_STAMINA_PERCENT, shouldApplyCityTravelStaminaCost } = __wgImport("city-travel.js", {"CITY_TRAVEL_STAMINA_PERCENT":"CITY_TRAVEL_STAMINA_PERCENT","shouldApplyCityTravelStaminaCost":"shouldApplyCityTravelStaminaCost"});
const { hydrateGpicElements } = __wgImport("gpic-renderer.js", {"hydrateGpicElements":"hydrateGpicElements"});
const { DialogueEngine } = __wgImport("dialogue-engine.js", {"DialogueEngine":"DialogueEngine"});
const { isOnlineSceneId, isExternalUrl, sanitizeChatForOffline, OFFLINE_MSG } = __wgImport("offline-filter.js", {"isOnlineSceneId":"isOnlineSceneId","isExternalUrl":"isExternalUrl","sanitizeChatForOffline":"sanitizeChatForOffline","OFFLINE_MSG":"OFFLINE_MSG"});
const { learnSkillFromItem } = __wgImport("craft-panel.js", {"learnSkillFromItem":"learnSkillFromItem"});
const { changeGoodsByName } = __wgImport("inventory-system.js", {"changeGoodsByName":"changeGoodsByName"});
const { ensureParty, findRoleIndex, readValues, writeValues, syncPlayerFromRole, syncRoleFromPlayer, getRoleCount, getRoleDisplayName, bootstrapRoleStats, createRoleFromTemplate, createJoinedRole, findDepartedFriend, storeDepartedFriend, deductPartyTiliForMazeTravel, deductPartyTiliForCityTravel, sceneEventValue, resEventValue, parseEventIdList, STAT, gameRandomChance, gameBaseRandomZero } = __wgImport("game-runtime.js", {"ensureParty":"ensureParty","findRoleIndex":"findRoleIndex","readValues":"readValues","writeValues":"writeValues","syncPlayerFromRole":"syncPlayerFromRole","syncRoleFromPlayer":"syncRoleFromPlayer","getRoleCount":"getRoleCount","getRoleDisplayName":"getRoleDisplayName","bootstrapRoleStats":"bootstrapRoleStats","createRoleFromTemplate":"createRoleFromTemplate","createJoinedRole":"createJoinedRole","findDepartedFriend":"findDepartedFriend","storeDepartedFriend":"storeDepartedFriend","deductPartyTiliForMazeTravel":"deductPartyTiliForMazeTravel","deductPartyTiliForCityTravel":"deductPartyTiliForCityTravel","sceneEventValue":"sceneEventValue","resEventValue":"resEventValue","parseEventIdList":"parseEventIdList","STAT":"STAT","gameRandomChance":"gameRandomChance","gameBaseRandomZero":"gameBaseRandomZero"});
const { bindGameHandlers, parseGameCall, evalCondition, evalTemplate, evalGameExpr, buildResGoodsHtml, renderIncludeHtml } = __wgImport("game-script.js", {"bindGameHandlers":"bindGameHandlers","parseGameCall":"parseGameCall","evalCondition":"evalCondition","evalTemplate":"evalTemplate","evalGameExpr":"evalGameExpr","buildResGoodsHtml":"buildResGoodsHtml","renderIncludeHtml":"renderIncludeHtml"});
const { getReadTextLine, getIncludeCache } = __wgImport("game-config.js", {"getReadTextLine":"getReadTextLine","getIncludeCache":"getIncludeCache"});
const { applyTaskRewards, getTaskDescription } = __wgImport("task-system.js", {"applyTaskRewards":"applyTaskRewards","getTaskDescription":"getTaskDescription"});
const { countNonEmptySlots, persistSave, findMostRecentSlot, getActiveSlotId } = __wgImport("save-manager.js", {"countNonEmptySlots":"countNonEmptySlots","persistSave":"persistSave","findMostRecentSlot":"findMostRecentSlot","getActiveSlotId":"getActiveSlotId"});
const { loadSlotIntoGame } = __wgImport("save-transfer.js", {"loadSlotIntoGame":"loadSlotIntoGame"});

/** Original game_pop_a return code: defer remaining script until word quiz finishes (maze html_pop). */
 const POP_DEFER_CODE = 1881;

const MAX_TIME_EXE_QUEUE = 512;
const MAX_TIME_EXE_SECONDS = 60000;

 class SceneEngine {
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

 class GameAPI {
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

exports.POP_DEFER_CODE = POP_DEFER_CODE;
exports.SceneEngine = SceneEngine;
exports.GameAPI = GameAPI;

});

__wgDef("combat.js", function (exports) {
const { buildMonsterRoster, getGoodsById } = __wgImport("goods-data.js", {"buildMonsterRoster":"buildMonsterRoster","getGoodsById":"getGoodsById"});
const { readValues, writeValues, STAT, syncPlayerFromRole, getRoleDisplayName, gameBaseRandom } = __wgImport("game-runtime.js", {"readValues":"readValues","writeValues":"writeValues","STAT":"STAT","syncPlayerFromRole":"syncPlayerFromRole","getRoleDisplayName":"getRoleDisplayName","gameBaseRandom":"gameBaseRandom"});

/** Delphi Game_migong_xishu: when factor > 0, scale HP/attack/exp by factor/10 (20=2x, 5=half, 3=third). */
 function getMazeFactorMultiplier(mazeFactor) {
  const f = Number(mazeFactor) || 0;
  if (f <= 0) return 1;
  if (f === 1) return 1; // legacy save default before fix
  return f / 10;
}

 function applyMazeFactorToMonster(monster, multiplier) {
  const mult = Number(multiplier) || 1;
  if (mult === 1) return { ...monster };
  const baseHp = Number(monster.maxHp ?? monster.hp) || 1;
  const hp = Math.max(1, Math.floor(baseHp * mult));
  return {
    ...monster,
    hp,
    maxHp: hp,
    attack: Math.max(1, Math.floor(Number(monster.attack) * mult)),
    exp: Math.max(0, Math.floor(Number(monster.exp ?? 0) * mult)),
  };
}

 class CombatState {
  constructor(monsterCount = 1, monsterType = 1, mazeFactor = 0) {
    const mult = getMazeFactorMultiplier(mazeFactor);
    this.mazeFactor = Number(mazeFactor) || 0;
    this.monsters = buildMonsterRoster(monsterType, monsterCount).map((m, i) => {
      const scaled = applyMazeFactorToMonster(m, mult);
      return {
        ...scaled,
        id: i + 1,
        maxHp: scaled.maxHp ?? scaled.hp,
      };
    });
    this.monsterType = monsterType;
    this.monsterCount = monsterCount;
    this.partySlots = [0];
    this.speedMeters = new Array(10).fill(0);
    this.speedLimit = 200;
    this.firstTurnPending = true;
    this.activeSlot = 0;
    this.activeRoleIndex = 0;
    this.activeMonsterIndex = 0;
    this.turn = 'player';
    this.defendBoostByRole = {};
    this.monsterEscaped = false;
  }
}

/** Party members allowed in battle (hide=1), up to 5 slots like???. */
 function getBattlePartySlots(save) {
  const slots = [];
  for (let i = 0; i < (save?.party?.length || 0) && slots.length < 5; i += 1) {
    if (readValues(save, i, STAT.hide) === 1) slots.push(i);
  }
  if (!slots.length) slots.push(0);
  return slots;
}

 function getRoleSpeed(save, roleIndex) {
  if (readValues(save, roleIndex, STAT.life) <= 0) return 0;
  return readValues(save, roleIndex, STAT.speed) || 10;
}

function ensureMonsterDebuffs(monster) {
  if (!monster.debuffs) {
    monster.debuffs = { defense: 0, speed: 0, attack: 0 };
  }
  return monster.debuffs;
}

 function getMonsterDefense(monster) {
  const base = Number(monster?.defense ?? monster?.defenseNum) || 0;
  const penalty = monster?.debuffs?.defense || 0;
  return Math.max(0, base - penalty);
}

 function getMonsterAttack(monster) {
  const base = Number(monster?.attack ?? monster?.attackNum) || 10;
  const penalty = monster?.debuffs?.attack || 0;
  return Math.max(1, base - penalty);
}

 function getMonsterSpeed(monster) {
  if (!monster || (monster.hp ?? 0) <= 0) return 0;
  const base = Number(monster.speed ?? monster.speedNum) || 10;
  const penalty = monster?.debuffs?.speed || 0;
  return Math.max(1, base - penalty);
}

 function applySpellDebuffsToMonster(monster, debuffs) {
  if (!monster || !debuffs) return null;
  if (!debuffs.defense && !debuffs.speed && !debuffs.attack) return null;
  const state = ensureMonsterDebuffs(monster);
  const baseDef = Number(monster.defense ?? monster.defenseNum) || 0;
  const baseSpd = Number(monster.speed ?? monster.speedNum) || 10;
  const baseAtk = Number(monster.attack ?? monster.attackNum) || 10;
  state.defense = Math.min(state.defense + (debuffs.defense || 0), baseDef);
  state.speed = Math.min(state.speed + (debuffs.speed || 0), Math.max(0, baseSpd - 1));
  state.attack = Math.min(state.attack + (debuffs.attack || 0), Math.max(0, baseAtk - 1));
  return debuffs;
}

 function formatSpellDebuffText(debuffs) {
  if (!debuffs) return '';
  const parts = [];
  if (debuffs.defense > 0) parts.push(`\u9632-${debuffs.defense}`);
  if (debuffs.speed > 0) parts.push(`\u901f-${debuffs.speed}`);
  if (debuffs.attack > 0) parts.push(`\u653b-${debuffs.attack}`);
  if (!parts.length) return '';
  const label = debuffs.effectName ? `\u3010${debuffs.effectName}\u3011` : '';
  return `\uff0c${label}${parts.join('\u3001')}`;
}

function slotToRoleIndex(combat, slot) {
  return combat.partySlots[slot] ?? combat.partySlots[0] ?? 0;
}

function isSlotAlive(combat, save, slot) {
  if (slot <= 4) {
    const roleIdx = slotToRoleIndex(combat, slot);
    return slot < combat.partySlots.length && readValues(save, roleIdx, STAT.life) > 0;
  }
  const monster = combat.monsters[slot - 5];
  return !!monster && monster.hp > 0;
}

function pickRandomAliveRoleIndex(save, partySlots) {
  const alive = partySlots.filter((ri) => readValues(save, ri, STAT.life) > 0);
  if (!alive.length) return partySlots[0] ?? 0;
  return alive[Math.floor(Math.random() * alive.length)];
}

 function initCombatFromSave(combat, save) {
  combat.partySlots = getBattlePartySlots(save);
  combat.speedMeters = new Array(10).fill(0);
  combat.defendBoostByRole = {};
  combat.firstTurnPending = true;
  combat.monsterEscaped = false;

  const leadRole = combat.partySlots[0] ?? 0;
  const leadSpeed = getRoleSpeed(save, leadRole);
  combat.speedLimit = Math.max(20, leadSpeed * 20);

  combat.speedMeters[0] -= getRoleSpeed(save, slotToRoleIndex(combat, 0));
  if (combat.monsters[0]) {
    combat.speedMeters[5] -= getMonsterSpeed(combat.monsters[0]);
  }

  combat.activeRoleIndex = pickRandomAliveRoleIndex(save, combat.partySlots);
  combat.activeMonsterIndex = 0;
  syncCombatHpCache(combat, save);
}

function syncCombatHpCache(combat, save) {
  const ri = combat.activeRoleIndex ?? 0;
  combat.playerHp = readValues(save, ri, STAT.life);
  combat.playerMaxHp = readValues(save, ri, STAT.gdsmz27) || combat.playerHp;
  combat.playerDefend = readValues(save, ri, STAT.defend);
  combat.playerSpeed = getRoleSpeed(save, ri);
}

 function syncAllRolesFromCombat(combat, save) {
  syncPlayerFromRole(save, 0);
}

function tickSpeedMeters(combat, save) {
  if (combat.speedMeters.some((v, i) => v >= combat.speedLimit && isSlotAlive(combat, save, i))) {
    return;
  }
  for (let i = 0; i < 10; i += 1) {
    if (i < 5) {
      if (i >= combat.partySlots.length) continue;
      const speed = getRoleSpeed(save, slotToRoleIndex(combat, i));
      if (speed > 0) combat.speedMeters[i] += speed;
    } else {
      const monster = combat.monsters[i - 5];
      const speed = getMonsterSpeed(monster);
      if (speed > 0) combat.speedMeters[i] += speed;
    }
  }
}

function pickSpeedSlot(combat, save) {
  let best = 0;
  for (let i = 1; i < 10; i += 1) {
    if (combat.speedMeters[i] > combat.speedMeters[best]) best = i;
  }
  if (best === 0 && combat.speedMeters[0] === 0) return -1;

  combat.speedMeters[best] = 0;

  if (!isSlotAlive(combat, save, best)) {
    return pickSpeedSlot(combat, save);
  }
  return best;
}

/** Advance to next actor: random opening like game_star_fight_message, then speed queue. */
 function advanceToNextActor(combat, save) {
  if (combat.firstTurnPending) {
    combat.firstTurnPending = false;
    const playerFirst = Math.random() < 0.5;
    if (playerFirst) {
      const slot = Math.max(0, combat.partySlots.indexOf(combat.activeRoleIndex));
      combat.activeSlot = slot >= 0 ? slot : 0;
      combat.turn = 'player';
    } else {
      const alive = combat.monsters.map((m, i) => i).filter((i) => combat.monsters[i].hp > 0);
      combat.activeMonsterIndex = alive[0] ?? 0;
      combat.activeSlot = 5 + combat.activeMonsterIndex;
      combat.turn = 'monster';
    }
  } else {
    let guard = 0;
    while (guard < 500) {
      guard += 1;
      if (combat.speedMeters.some((v, i) => v >= combat.speedLimit && isSlotAlive(combat, save, i))) break;
      tickSpeedMeters(combat, save);
    }
    let slot = pickSpeedSlot(combat, save);
    if (slot < 0) slot = combat.monsters.some((m) => m.hp > 0) ? 5 : 0;
    combat.activeSlot = slot;
    if (slot <= 4) {
      combat.activeRoleIndex = slotToRoleIndex(combat, slot);
      combat.turn = 'player';
    } else {
      combat.activeMonsterIndex = slot - 5;
      combat.turn = 'monster';
    }
  }

  if (combat.turn === 'player') {
    syncCombatHpCache(combat, save);
  }
  return combat.turn;
}

 function getSpeedOrderPreview(combat, save) {
  return combat.speedMeters.map((v, i) => {
    if (i <= 4) {
      const ri = slotToRoleIndex(combat, i);
      return {
        slot: i,
        side: 'player',
        name: getRoleDisplayName(save, ri + 1),
        meter: v,
        alive: isSlotAlive(combat, save, i),
      };
    }
    const m = combat.monsters[i - 5];
    return {
      slot: i,
      side: 'monster',
      name: m?.name || '-',
      meter: v,
      alive: isSlotAlive(combat, save, i),
    };
  });
}

 function monsterAttackMultiplier(correct) {
  return correct ? randomInt(2, 7) : randomInt(10, 15);
}

function statNum(info, key) {
  return Number(info?.[key]) || 0;
}

/** Original: Game_base_random(4) === 1 when fa_wu > 0. */
 function monsterWillUseSpell(monster) {
  const magic = Number(monster?.magic) || 0;
  return magic > 0 && gameBaseRandom(4) === 1;
}

 function getMonsterSpellInfo(monster) {
  const id = Number(monster?.magic) || 0;
  if (id <= 0) return null;
  return getGoodsById(id);
}

/** magic < 0: monster may attempt to flee (see tryMonsterFlee). */
 function monsterCanFlee(monster) {
  return Number(monster?.magic) < 0;
}

/**
 * Flee roll denominator. Success when gameBaseRandom(denom) === 1.
 * Max success rate is 1/|magic| (denom >= |magic|).
 * Speed mirrors player escape; quiz uses 10/mult on wrong answers only (correct = auto fail).
 */
 function calcMonsterFleeDenominator(combat, save, multiplier) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat);
  if (!monster || !monsterCanFlee(monster)) return null;

  const capDenom = Math.abs(Number(monster.magic));
  const roleIndex = combat.activeRoleIndex ?? 0;
  const playerSpeed = getRoleSpeed(save, roleIndex);
  const monsterSpeed = getMonsterSpeed(monster);
  const speedOdds = monsterSpeed > playerSpeed ? 5 : 30;
  let denom = Math.max(speedOdds, capDenom);
  const mult = Math.max(1, Number(multiplier) || 10);
  denom = Math.max(capDenom, Math.round(denom * 10 / mult));
  return { denom, monster, capDenom };
}

/** Attempt flee after monster-turn quiz. Returns { fled, monster? }. */
 function tryMonsterFlee(combat, save, multiplier) {
  const calc = calcMonsterFleeDenominator(combat, save, multiplier);
  if (!calc) return { fled: false };

  if (gameBaseRandom(calc.denom) !== 1) {
    return { fled: false, monster: calc.monster };
  }

  const target = calc.monster;
  target.hp = 0;
  target.escaped = true;
  target.dropMoney = 0;
  target.dropItem = 0;
  target.exp = 0;
  combat.monsterEscaped = true;
  return { fled: true, monster: target };
}

function scaleByQuizMultiplier(value, multiplier) {
  return Math.max(0, Math.floor(Number(value) * multiplier / 10));
}

function calcMonsterSpellDamageOnRole(save, roleIndex, spellInfo, multiplier, combat) {
  const defendBoost = combat.defendBoostByRole[roleIndex] || 1;
  const defend = (readValues(save, roleIndex, STAT.defend) || 0) * defendBoost;
  const typeNum = Number(spellInfo.typeNum ?? spellInfo.type) || 0;

  let hpDmg = 0;
  let tiliDmg = 0;
  let mpDmg = 0;

  const rawHp = scaleByQuizMultiplier(statNum(spellInfo, 'luck'), multiplier);
  if (rawHp > 0) {
    hpDmg = Math.max(1, rawHp - Math.floor(defend / 4));
  }

  if (typeNum & 128) {
    tiliDmg = scaleByQuizMultiplier(statNum(spellInfo, 'hp'), multiplier);
  } else if (typeNum & 4) {
    tiliDmg = scaleByQuizMultiplier(statNum(spellInfo, 'hp'), multiplier);
    mpDmg = scaleByQuizMultiplier(statNum(spellInfo, 'magic'), multiplier);
  }

  return { hpDmg, tiliDmg, mpDmg };
}

function applyMonsterSpellDamageToRole(save, roleIndex, damage, combat) {
  const { hpDmg, tiliDmg, mpDmg } = damage;
  if (hpDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.life);
    writeValues(save, roleIndex, STAT.life, Math.max(0, cur - hpDmg));
  }
  if (tiliDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.tili);
    writeValues(save, roleIndex, STAT.tili, Math.max(0, cur - tiliDmg));
  }
  if (mpDmg > 0) {
    const cur = readValues(save, roleIndex, STAT.lingli);
    writeValues(save, roleIndex, STAT.lingli, Math.max(0, cur - mpDmg));
  }
  combat.defendBoostByRole[roleIndex] = 1;
  if (roleIndex === 0) syncPlayerFromRole(save, 0);
}

/**
 * Monster spell/item attack on player party. Quiz multiplier affects all components.
 */
 function applyMonsterSpellAttack(combat, save, multiplier, spellInfo) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat) || combat.monsters[0];
  const typeNum = Number(spellInfo.typeNum ?? spellInfo.type) || 0;
  const isAttackSpell = !(typeNum & 128) || statNum(spellInfo, 'price') === 1 || (typeNum & 4);

  if (!isAttackSpell) {
    return applyMonsterAttack(combat, save, multiplier);
  }

  const singleTarget = statNum(spellInfo, 'fortune') === 1;
  const aliveTargets = combat.partySlots.filter((ri) => readValues(save, ri, STAT.life) > 0);
  const targets = singleTarget
    ? [pickRandomAliveRoleIndex(save, combat.partySlots)]
    : (aliveTargets.length ? aliveTargets : [combat.partySlots[0] ?? 0]);

  let totalHp = 0;
  let totalTili = 0;
  let totalMp = 0;
  for (const target of targets) {
    const damage = calcMonsterSpellDamageOnRole(save, target, spellInfo, multiplier, combat);
    applyMonsterSpellDamageToRole(save, target, damage, combat);
    totalHp += damage.hpDmg;
    totalTili += damage.tiliDmg;
    totalMp += damage.mpDmg;
  }

  syncCombatHpCache(combat, save);
  return {
    monster,
    spellName: spellInfo.name || '\u6cd5\u672f',
    singleTarget,
    aoe: !singleTarget && targets.length > 1,
    totalHp,
    totalTili,
    totalMp,
    targetRoleIndex: targets[0],
  };
}

 function formatMonsterSpellFeedback(save, correct, result) {
  const { monster, spellName, aoe, totalHp, totalTili, totalMp, targetRoleIndex } = result;
  const extras = [];
  if (totalTili > 0) extras.push(`\u4f53\u529b${totalTili}`);
  if (totalMp > 0) extras.push(`\u7075\u529b${totalMp}`);
  const extraText = extras.length ? `\uff0c\u9644\u52a0\u51cf${extras.join('\u3001')}` : '';

  if (aoe) {
    return correct
      ? `\u7b54\u5bf9\u4e86\uff01${monster.name} \u7684${spellName}\u88ab\u524a\u5f31\uff0c\u6211\u65b9\u5171\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`
      : `\u7b54\u9519\u4e86\uff01${monster.name} \u65bd\u5c55${spellName}\uff0c\u6211\u65b9\u5171\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`;
  }

  const targetName = getRoleDisplayName(save, targetRoleIndex + 1);
  return correct
    ? `\u7b54\u5bf9\u4e86\uff01${monster.name} \u7684${spellName}\u88ab\u524a\u5f31\uff0c${targetName}\u4ec5\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`
    : `\u7b54\u9519\u4e86\uff01${targetName}\u88ab${monster.name} \u7684${spellName}\u547d\u4e2d\uff0c\u53d7\u5230 ${totalHp} \u70b9\u4f24\u5bb3${extraText}`;
}

 function playerDamage(base = 12) {
  return base + randomInt(0, 8);
}

 function applyMonsterAttack(combat, save, multiplier, targetRoleIndex = null) {
  const monster = combat.monsters[combat.activeMonsterIndex] || pickActiveMonster(combat) || combat.monsters[0];
  const target = targetRoleIndex ?? pickRandomAliveRoleIndex(save, combat.partySlots);
  const defendBoost = combat.defendBoostByRole[target] || 1;
  const defend = (readValues(save, target, STAT.defend) || 0) * defendBoost;
  const raw = Math.max(1, Math.round(getMonsterAttack(monster) * multiplier / 10));
  const dmg = Math.max(1, raw - Math.floor(defend / 4));
  const cur = readValues(save, target, STAT.life);
  writeValues(save, target, STAT.life, Math.max(0, cur - dmg));
  combat.defendBoostByRole[target] = 1;
  if (target === 0) syncPlayerFromRole(save, 0);
  syncCombatHpCache(combat, save);
  return { dmg, monster, targetRoleIndex: target };
}

 function calcDamageAfterDefense(rawDmg, defense) {
  let dmg = -Math.max(1, rawDmg);
  const q = Math.round((defense / Math.max(1, rawDmg) + 1) * 10);
  if (gameBaseRandom(Math.max(1, q)) > 10) {
    dmg += defense;
  } else {
    dmg += Math.floor(defense / (5 + gameBaseRandom(6)));
  }
  if (dmg > 0) dmg = 0;
  return Math.abs(dmg);
}

 function applyPlayerAttack(combat, mode = 'attack', targetIndex = 0) {
  const alive = combat.monsters.filter((m) => m.hp > 0);
  const target = alive[targetIndex] || alive[0];
  if (!target) return { dmg: 0, target: null };
  let base = 14;
  if (mode === 'magic') base = 18;
  if (mode === 'item') base = 10;
  const raw = playerDamage(base);
  const dmg = calcDamageAfterDefense(raw, getMonsterDefense(target));
  target.hp = Math.max(0, target.hp - dmg);
  return { dmg, target };
}

 function pickActiveMonster(combat) {
  if (combat.activeMonsterIndex != null && combat.monsters[combat.activeMonsterIndex]?.hp > 0) {
    return combat.monsters[combat.activeMonsterIndex];
  }
  return combat.monsters.find((m) => m.hp > 0) || null;
}

 function aliveMonsterCount(combat) {
  return combat.monsters.filter((m) => m.hp > 0).length;
}

 function anyPlayerAlive(combat, save) {
  return combat.partySlots.some((ri) => readValues(save, ri, STAT.life) > 0);
}

 function combatFinished(combat, save) {
  const monstersAlive = combat.monsters.some((m) => m.hp > 0);
  const playersAlive = anyPlayerAlive(combat, save);
  if (monstersAlive && playersAlive) return null;
  if (monstersAlive && !playersAlive) return 'lose';
  return 'win';
}

/** Roll one monster's item drop (Delphi: drop when dropChance<=1 or random(chance)===1). */
 function rollMonsterItemDrop(monster) {
  if (monster?.escaped) return null;
  const itemId = Number(monster?.dropItem) || 0;
  let count = Number(monster?.dropCount) || 0;
  const chance = Number(monster?.dropChance) || 0;
  if (itemId <= 0 || count <= 0) return null;
  if (chance > 1 && gameBaseRandom(chance) !== 1) return null;
  const info = getGoodsById(itemId);
  if (!info?.name) return null;
  return { id: itemId, name: info.name, count };
}

 function calcVictoryRewards(combat) {
  let exp = 0;
  let money = 0;
  const itemTotals = new Map();
  for (const m of combat.monsters) {
    if (m.escaped) continue;
    exp += Number(m.exp ?? m.expNum) || 0;
    money += Number(m.dropMoney ?? m.dropMoneyNum) || 0;
    const drop = rollMonsterItemDrop(m);
    if (!drop) continue;
    itemTotals.set(drop.name, (itemTotals.get(drop.name) || 0) + drop.count);
  }
  const items = [...itemTotals.entries()].map(([name, count]) => ({ name, count }));
  return { exp, money, items };
}

 function attackStaminaCost(maxTili) {
  return Math.max(1, Math.floor(Number(maxTili || 50) / 50) + 1);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

exports.getMazeFactorMultiplier = getMazeFactorMultiplier;
exports.applyMazeFactorToMonster = applyMazeFactorToMonster;
exports.CombatState = CombatState;
exports.getBattlePartySlots = getBattlePartySlots;
exports.getRoleSpeed = getRoleSpeed;
exports.getMonsterDefense = getMonsterDefense;
exports.getMonsterAttack = getMonsterAttack;
exports.getMonsterSpeed = getMonsterSpeed;
exports.applySpellDebuffsToMonster = applySpellDebuffsToMonster;
exports.formatSpellDebuffText = formatSpellDebuffText;
exports.initCombatFromSave = initCombatFromSave;
exports.syncAllRolesFromCombat = syncAllRolesFromCombat;
exports.advanceToNextActor = advanceToNextActor;
exports.getSpeedOrderPreview = getSpeedOrderPreview;
exports.monsterAttackMultiplier = monsterAttackMultiplier;
exports.monsterWillUseSpell = monsterWillUseSpell;
exports.getMonsterSpellInfo = getMonsterSpellInfo;
exports.monsterCanFlee = monsterCanFlee;
exports.calcMonsterFleeDenominator = calcMonsterFleeDenominator;
exports.tryMonsterFlee = tryMonsterFlee;
exports.applyMonsterSpellAttack = applyMonsterSpellAttack;
exports.formatMonsterSpellFeedback = formatMonsterSpellFeedback;
exports.playerDamage = playerDamage;
exports.applyMonsterAttack = applyMonsterAttack;
exports.calcDamageAfterDefense = calcDamageAfterDefense;
exports.applyPlayerAttack = applyPlayerAttack;
exports.pickActiveMonster = pickActiveMonster;
exports.aliveMonsterCount = aliveMonsterCount;
exports.anyPlayerAlive = anyPlayerAlive;
exports.combatFinished = combatFinished;
exports.rollMonsterItemDrop = rollMonsterItemDrop;
exports.calcVictoryRewards = calcVictoryRewards;
exports.attackStaminaCost = attackStaminaCost;

});

__wgDef("dig-system.js", function (exports) {
const { gameBaseRandom } = __wgImport("game-runtime.js", {"gameBaseRandom":"gameBaseRandom"});
const { getGameConfig } = __wgImport("game-config.js", {"getGameConfig":"getGameConfig"});

/** Roll one drop from const.upp / const_cy.upp tables (first weight match wins). */
 function rollDigDrop(table) {
  for (const entry of table || []) {
    const weight = Number(entry.weight) || 1;
    if (gameBaseRandom(weight) === 1) return entry.name;
  }
  return null;
}

 function getMineTable() {
  return getGameConfig()?.mineOres || [];
}

 function getHerbTable() {
  return getGameConfig()?.herbOres || [];
}

 function calcDigCloseBonusExp(correctCount) {
  let n = Math.max(0, Number(correctCount) || 0);
  if (n > 100) n = 100;
  return Math.floor((n * n) / 10);
}

exports.rollDigDrop = rollDigDrop;
exports.getMineTable = getMineTable;
exports.getHerbTable = getHerbTable;
exports.calcDigCloseBonusExp = calcDigCloseBonusExp;

});

__wgDef("combat-actions.js", function (exports) {
const { getGoodsById, getGoodsInfo } = __wgImport("goods-data.js", {"getGoodsById":"getGoodsById","getGoodsInfo":"getGoodsInfo"});
const { changeGoodsByName, decodeSkillId, decodeSkillLevel, decodeSkillUses, ensureRoleArrays, getGoodsCountByName, listSkills } = __wgImport("inventory-system.js", {"changeGoodsByName":"changeGoodsByName","decodeSkillId":"decodeSkillId","decodeSkillLevel":"decodeSkillLevel","decodeSkillUses":"decodeSkillUses","ensureRoleArrays":"ensureRoleArrays","getGoodsCountByName":"getGoodsCountByName","listSkills":"listSkills"});
const { gameBaseRandom, readValues, writeValues, STAT, syncPlayerFromRole } = __wgImport("game-runtime.js", {"gameBaseRandom":"gameBaseRandom","readValues":"readValues","writeValues":"writeValues","STAT":"STAT","syncPlayerFromRole":"syncPlayerFromRole"});
const { pickActiveMonster, getRoleSpeed, getMonsterSpeed, getMonsterDefense, calcDamageAfterDefense, applySpellDebuffsToMonster, formatSpellDebuffText } = __wgImport("combat.js", {"pickActiveMonster":"pickActiveMonster","getRoleSpeed":"getRoleSpeed","getMonsterSpeed":"getMonsterSpeed","getMonsterDefense":"getMonsterDefense","calcDamageAfterDefense":"calcDamageAfterDefense","applySpellDebuffsToMonster":"applySpellDebuffsToMonster","formatSpellDebuffText":"formatSpellDebuffText"});

const FULL_QI = 999999999;
const HALF_QI = 99999999;
const FULL = 9999999;
const HALF = 999999;

function statNum(info, key) {
  return Number(info?.[key]) || 0;
}

/** Effect strength (damage/debuff): +10% every 2 spell levels, max +40% at Lv10. */
 function spellEffectLevelScale(level) {
  const j = Math.max(1, Math.min(10, Number(level) || 1));
  return 1 + Math.floor((j - 1) / 2) * 0.1;
}

function levelScale(level) {
  return spellEffectLevelScale(level);
}

/** MP ∝ spell damage (luck). Baseline: 120 dmg → 25 MP (ratio 25/120). */
const MP_PER_DAMAGE = 25 / 120;
/** AoE hits all enemies; costs more MP per point of luck than single-target. */
const AOE_MP_PER_DAMAGE = 25 / 90;

function spellMpLevelBonus(level) {
  const j = Math.max(1, Math.min(10, Number(level) || 1));
  return 1 + Math.floor((j - 1) / 4) * 0.02;
}

 function calcAttackSpellMpCost(info, level = 1) {
  const luck = statNum(info, 'luck');
  if (luck <= 0) return Math.max(1, statNum(info, 'magic'));
  const singleTarget = statNum(info, 'fortune') === 1;
  const ratio = singleTarget ? MP_PER_DAMAGE : AOE_MP_PER_DAMAGE;
  const baseMp = Math.round(luck * ratio);
  return Math.max(1, Math.floor(baseMp * spellMpLevelBonus(level)));
}

function encodeSkillEntryFull(id, level, uses) {
  return ((level & 0xff) << 24) | ((uses & 0xff) << 16) | (Number(id) & 0xffff);
}

 function bumpSpellUse(state, roleIndex, goodsId) {
  const role = state.party?.[roleIndex];
  if (!role) return 10;
  ensureRoleArrays(role);

  const tryArr = (arr, isJi) => {
    for (let i = 0; i < arr.length; i += 1) {
      if (decodeSkillId(arr[i]) !== goodsId) continue;
      let level = decodeSkillLevel(arr[i]) || 1;
      let uses = decodeSkillUses(arr[i]) + 1;
      if (uses > 60) uses = 0;

      const thresholds = isJi ? [10, 10, 10] : [15, 35, 60];
      const tier = level <= 3 ? 0 : level <= 6 ? 1 : 2;
      if (uses === thresholds[tier] && level < 10) {
        level += 1;
        uses = 0;
      }
      if (level > 10) level = 10;
      arr[i] = encodeSkillEntryFull(goodsId, level, uses);
      return level;
    }
    return null;
  };

  return tryArr(role.fa, false) ?? tryArr(role.ji, true) ?? 10;
}

/** Steal-type spell (妙手道): intel/z1 === 3 in goods data. */
 function isStealSpell(info) {
  return statNum(info, 'intel') === 3;
}

 function listCombatSpells(state, roleIndex = 0) {
  const role = state.party?.[roleIndex];
  const mp = readValues(state, roleIndex, STAT.lingli);
  const heal = [];
  const attack = [];
  const steal = [];

  const pushSpell = (entry) => {
    const info = entry.info || getGoodsById(entry.id);
    if (!info || !(Number(info.typeNum ?? info.type) & 128)) return;
    const level = entry.level || 1;
    const isAttack = !isStealSpell(info) && statNum(info, 'price') === 1;
    const mpCost = isAttack ? calcAttackSpellMpCost(info, level) : statNum(info, 'magic');
    if (mpCost > mp) return;
    const spell = {
      id: entry.id,
      name: entry.name,
      level,
      info,
      mpCost,
      singleTarget: statNum(info, 'fortune') === 1,
      isSteal: isStealSpell(info),
      isAttack: !isStealSpell(info) && statNum(info, 'price') === 1,
    };
    if (spell.isSteal) steal.push(spell);
    else if (spell.isAttack) attack.push(spell);
    else heal.push(spell);
  };

  const { fa } = listSkills(role || {});
  for (const entry of fa) pushSpell(entry);
  return { heal, attack, steal, mp };
}

 function listCombatItems(state) {
  const goods = state.player?.goods || {};
  const medicine = [];
  const enhancement = [];
  const throwable = [];

  for (const [name, count] of Object.entries(goods)) {
    if (!count) continue;
    const info = getGoodsInfo(name);
    if (!info?.name) continue;
    const entry = { name, count, info };
    const typeNum = Number(info.typeNum ?? info.type) || 0;
    if (typeNum & 2) medicine.push(entry);
    else if (typeNum & 256) enhancement.push(entry);
    else if (typeNum & 4) throwable.push(entry);
  }

  const sort = (a, b) => a.name.localeCompare(b.name, 'zh-CN');
  medicine.sort(sort);
  enhancement.sort(sort);
  throwable.sort(sort);
  return { medicine, enhancement, throwable };
}

 function calcHealAmount(state, roleIndex, info, level = 1) {
  const scale = levelScale(level);
  const maxHp = readValues(state, roleIndex, STAT.gdsmz27);
  const curHp = readValues(state, roleIndex, STAT.life);
  const maxTili = readValues(state, roleIndex, STAT.gdtl25);
  const curTili = readValues(state, roleIndex, STAT.tili);
  const maxMp = readValues(state, roleIndex, STAT.gdll26);
  const curMp = readValues(state, roleIndex, STAT.lingli);

  const hpGain = (() => {
    const v = statNum(info, 'luck');
    if (curHp <= 0 && v < HALF_QI) return 0;
    if (v === FULL || v === FULL_QI) return maxHp - curHp;
    if (v === HALF || v === HALF_QI) return Math.floor(maxHp / 2) - curHp;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  const tiliGain = (() => {
    const v = statNum(info, 'hp');
    if (v === FULL || v === FULL_QI) return maxTili - curTili;
    if (v === HALF || v === HALF_QI) return Math.floor(maxTili / 2) - curTili;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  const mpGain = (() => {
    const v = statNum(info, 'magic');
    if (v === FULL || v === FULL_QI) return maxMp - curMp;
    if (v === HALF || v === HALF_QI) return Math.floor(maxMp / 2) - curMp;
    return Math.max(0, Math.floor(v * scale / 10));
  })();

  return { hpGain, tiliGain, mpGain };
}

 function applyHealToRole(state, roleIndex, gains) {
  if (gains.hpGain) {
    const maxHp = readValues(state, roleIndex, STAT.gdsmz27);
    writeValues(state, roleIndex, STAT.life, Math.min(maxHp, readValues(state, roleIndex, STAT.life) + gains.hpGain));
  }
  if (gains.tiliGain) {
    const maxTili = readValues(state, roleIndex, STAT.gdtl25);
    writeValues(state, roleIndex, STAT.tili, Math.min(maxTili, readValues(state, roleIndex, STAT.tili) + gains.tiliGain));
  }
  if (gains.mpGain) {
    const maxMp = readValues(state, roleIndex, STAT.gdll26);
    writeValues(state, roleIndex, STAT.lingli, Math.min(maxMp, readValues(state, roleIndex, STAT.lingli) + gains.mpGain));
  }
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

/**
 * Per-spell debuff profile: base values at Lv1, scaled by spell level and power tier.
 * effectName shown in combat feedback; stat emphasis matches spell theme.
 */
const SPELL_DEBUFF_PROFILES = {
  // 单体
  '\u98de\u8757\u672f': { defense: 0, speed: 2, attack: 1, effectName: '\u866b\u8680\u7f20\u8eab' },
  '\u964d\u5996\u5492': { defense: 3, speed: 0, attack: 1, effectName: '\u7834\u90aa\u964d\u4f0f' },
  '\u8d8a\u5973\u5251': { defense: 1, speed: 2, attack: 2, effectName: '\u5251\u6c14\u8680\u9aa8' },
  '\u51cc\u6ce2\u65a9': { defense: 0, speed: 3, attack: 1, effectName: '\u51cc\u6ce2\u6c14\u6ede' },
  '\u5343\u5251\u98d8\u96e8': { defense: 2, speed: 1, attack: 3, effectName: '\u5343\u521b\u767e\u5b54' },
  '\u7389\u5973\u5251': { defense: 2, speed: 2, attack: 2, effectName: '\u7389\u5973\u8ff7\u5fc3' },
  '\u4e00\u9633\u6307': { defense: 0, speed: 1, attack: 3, effectName: '\u70b9\u7a74\u5c01\u8109' },
  '\u516d\u8109\u795e\u5251': { defense: 1, speed: 2, attack: 4, effectName: '\u516d\u8109\u65ad\u7ecf' },
  '\u718a\u5954\u864e\u5578': { defense: 1, speed: 1, attack: 4, effectName: '\u864e\u5578\u9707\u615c' },
  '\u4eba\u5251\u5408\u4e00': { defense: 3, speed: 2, attack: 3, effectName: '\u4eba\u5251\u5408\u9e23' },
  '\u5929\u5916\u98de\u4ed9': { defense: 2, speed: 4, attack: 2, effectName: '\u98de\u4ed9\u7948\u9b45' },
  '\u5343\u9b54\u722a': { defense: 3, speed: 1, attack: 5, effectName: '\u9b54\u722a\u88c2\u4f53' },
  '\u8fbe\u6469\u795e\u638c': { defense: 4, speed: 2, attack: 4, effectName: '\u8fbe\u6469\u4f0f\u9b54' },
  // 全体
  '\u72ee\u738b\u4e89\u9738': { defense: 1, speed: 1, attack: 2, effectName: '\u72ee\u5a01\u9707\u615c' },
  '\u767e\u5251\u5e7b\u5f71': { defense: 3, speed: 1, attack: 1, effectName: '\u5e7b\u5f71\u4e71\u5fc3' },
  '\u5996\u6cd5\u65e0\u8fb9': { defense: 1, speed: 2, attack: 2, effectName: '\u5996\u6cd5\u8680\u4f53' },
  '\u9ed1\u5c71\u566c\u6708': { defense: 2, speed: 1, attack: 3, effectName: '\u566c\u6708\u9ed1\u715e' },
  '\u5929\u5973\u6563\u82b1': { defense: 1, speed: 3, attack: 1, effectName: '\u6563\u82b1\u8ff7\u76ee' },
  '\u4e07\u5251\u98de\u96ea': { defense: 3, speed: 2, attack: 3, effectName: '\u98de\u96ea\u5c01\u5589' },
  '\u5578\u6d77\u795e\u529f': { defense: 2, speed: 2, attack: 3, effectName: '\u5578\u6d77\u6380\u6d6a' },
  '\u98ce\u5377\u6b8b\u4e91': { defense: 2, speed: 4, attack: 2, effectName: '\u98ce\u5377\u6b8b\u4e91' },
  '\u5929\u4e0b\u96f7\u884c': { defense: 1, speed: 4, attack: 4, effectName: '\u96f7\u884c\u9ebb\u75f9' },
  '\u5927\u60b2\u5492': { defense: 4, speed: 2, attack: 3, effectName: '\u5927\u60b2\u964d\u9b54' },
};

/** Debuff strength tuned vs typical enemy stats (fallback for unmapped spells). */
function calcAutoSpellDebuffs(power, scale) {
  let defense = Math.min(20, Math.max(1, Math.floor((power / 55) * scale)));
  let speed = Math.min(15, Math.max(0, Math.floor((power / 95) * scale)));
  let attack = Math.min(15, Math.max(0, Math.floor((power / 120) * scale)));
  if (power >= 300) defense = Math.max(defense, Math.floor(3 * scale));
  if (power >= 500) speed = Math.max(speed, Math.floor(4 * scale));
  if (power >= 700) attack = Math.max(attack, Math.floor(5 * scale));
  if (power >= 1000) {
    defense = Math.max(defense, Math.floor(8 * scale));
    speed = Math.max(speed, Math.floor(6 * scale));
  }
  return { defense, speed, attack };
}

function spellDebuffPowerTier(power) {
  return Math.max(0.8, Math.min(2.2, power / 180));
}

function scaleNamedSpellDebuffs(profile, level, power) {
  const scale = spellEffectLevelScale(level);
  const tier = spellDebuffPowerTier(power);
  return {
    defense: Math.max(0, Math.floor((profile.defense || 0) * scale * tier)),
    speed: Math.max(0, Math.floor((profile.speed || 0) * scale * tier)),
    attack: Math.max(0, Math.floor((profile.attack || 0) * scale * tier)),
    effectName: profile.effectName || '',
  };
}

 function calcSpellDebuffs(info, level) {
  if (isStealSpell(info) || statNum(info, 'price') !== 1) return null;

  const scale = spellEffectLevelScale(level);
  const power = statNum(info, 'luck');
  const name = info?.name || '';

  let defense = statNum(info, 'intel');
  if (defense === 3) defense = 0;
  let speed = statNum(info, 'speed');
  let attack = statNum(info, 'attack');

  if (defense || speed || attack) {
    const explicitScale = scale * 3;
    return {
      defense: Math.max(0, Math.floor(defense * explicitScale)),
      speed: Math.max(0, Math.floor(speed * explicitScale)),
      attack: Math.max(0, Math.floor(attack * explicitScale)),
      effectName: '\u5e7d\u51a5\u5e7b\u60d1',
    };
  }

  const profile = SPELL_DEBUFF_PROFILES[name];
  if (profile) {
    const debuffs = scaleNamedSpellDebuffs(profile, level, power);
    if (debuffs.defense || debuffs.speed || debuffs.attack) return debuffs;
  }

  if (power >= 100) {
    return { ...calcAutoSpellDebuffs(power, scale), effectName: '' };
  }

  return null;
}

 function calcSpellAttackDamage(info, level, monster) {
  const scale = levelScale(level);
  const raw = statNum(info, 'luck') * scale;
  const defense = getMonsterDefense(monster);
  return calcDamageAfterDefense(Math.max(1, raw), defense);
}

 function applySpellAttackToMonster(monster, info, level) {
  const dmg = calcSpellAttackDamage(info, level, monster);
  monster.hp = Math.max(0, monster.hp - dmg);
  const debuffs = calcSpellDebuffs(info, level);
  const debuffText = applySpellDebuffsToMonster(monster, debuffs);
  return { dmg, debuffText: formatSpellDebuffText(debuffText) };
}

 function deductSpellMp(state, roleIndex, mpCost) {
  const cur = readValues(state, roleIndex, STAT.lingli);
  writeValues(state, roleIndex, STAT.lingli, Math.max(0, cur - mpCost));
  if (roleIndex === 0) syncPlayerFromRole(state, 0);
}

 function calcThrowableDamage(info, monster, playerSpeed) {
  const defense = getMonsterDefense(monster);
  const speed = Math.max(1, Number(playerSpeed) || 1);
  const w = Math.round((defense / speed + 1) * 10);
  if (Math.floor(Math.random() * Math.max(1, w)) > 10) {
    return { hit: false, dmg: 0, tiliDmg: 0, mpDmg: 0 };
  }
  return {
    hit: true,
    dmg: Math.max(1, statNum(info, 'luck')),
    tiliDmg: statNum(info, 'hp'),
    mpDmg: statNum(info, 'magic'),
  };
}

/** 妙手道：仅消耗灵力，按成功率偷取敌人金钱或掉落物（无道德值判定）。 */
 function tryStealFromMonster(state, monster, info, level) {
  const power = Math.max(1, Math.floor(statNum(info, 'luck') * levelScale(level) / 10));
  if (gameBaseRandom(23) > power) {
    return { ok: false, message: '\u5999\u624b\u9053\u5931\u8d25\u3002' };
  }

  const magic = Number(monster?.magic) || 0;
  const preferMoney = magic > 0 || gameBaseRandom(2) === 0;

  if (preferMoney) {
    const amount = Number(monster?.dropMoney ?? monster?.dropMoneyNum) || 0;
    if (amount <= 0) {
      return { ok: false, message: '\u5bf9\u65b9\u8eab\u4e0a\u6ca1\u6709\u94b1\u8d22\u3002' };
    }
    const cur = readValues(state, 0, STAT.money);
    writeValues(state, 0, STAT.money, cur + amount);
    monster.dropMoney = 0;
    syncPlayerFromRole(state, 0);
    return { ok: true, message: `\u5077\u5230\u91d1\u94b1\uff1a${amount}` };
  }

  const itemId = Number(monster?.dropItem) || 0;
  const itemInfo = itemId ? getGoodsById(itemId) : null;
  const itemName = itemInfo?.name;
  if (!itemName) {
    return { ok: false, message: '\u6ca1\u6709\u7269\u54c1\u3002' };
  }

  const applied = changeGoodsByName(state, itemName, 1);
  if (applied <= 0) {
    return { ok: false, message: `${itemName}\u5df2\u8fbe\u4e0a\u9650\uff08999\uff09\u3002` };
  }
  monster.dropItem = 0;
  monster.dropCount = 0;
  if (applied > 0) syncPlayerFromRole(state, 0);
  return { ok: true, message: `\u5077\u5230\u7269\u54c1\uff1a${itemName}` };
}

 function tryEscapeCombat(state, combat, { confirmUseItem = true } = {}) {
  if (state.cannotRunOff) {
    return { ok: false, reason: 'blocked', message: '\u51b3\u4e00\u6b7b\u6218\uff0c\u575a\u51b3\u4e0d\u9003\u3002' };
  }

  if (getGoodsCountByName(state, '\u8ff7\u8e2a\u86cf') >= 1) {
    if (!confirmUseItem) {
      return { ok: false, reason: 'need-confirm', item: '\u8ff7\u8e2a\u86cf' };
    }
    const use = typeof window !== 'undefined'
      ? window.confirm('\u662f\u5426\u4f7f\u7528\u4e00\u4e2a\u8ff7\u8e2a\u86cf\u6765\u9003\u8dd1\uff1f')
      : true;
    if (use) {
      changeGoodsByName(state, '\u8ff7\u8e2a\u86cf', -1);
      return { ok: true, usedItem: true };
    }
  }

  const roleIndex = combat.activeRoleIndex ?? 0;
  const monsterIndex = combat.activeMonsterIndex ?? 0;
  const playerSpeed = getRoleSpeed(state, roleIndex);
  const monster = combat.monsters[monsterIndex] || pickActiveMonster(combat);
  const monsterSpeed = getMonsterSpeed(monster);
  const odds = playerSpeed > monsterSpeed ? 5 : 30;
  if (gameBaseRandom(odds) === 1) {
    return { ok: true };
  }
  return { ok: false, reason: 'failed', message: '\u9003\u8dd1\u5931\u8d25\u3002' };
}

exports.spellEffectLevelScale = spellEffectLevelScale;
exports.calcAttackSpellMpCost = calcAttackSpellMpCost;
exports.bumpSpellUse = bumpSpellUse;
exports.isStealSpell = isStealSpell;
exports.listCombatSpells = listCombatSpells;
exports.listCombatItems = listCombatItems;
exports.calcHealAmount = calcHealAmount;
exports.applyHealToRole = applyHealToRole;
exports.calcSpellDebuffs = calcSpellDebuffs;
exports.calcSpellAttackDamage = calcSpellAttackDamage;
exports.applySpellAttackToMonster = applySpellAttackToMonster;
exports.deductSpellMp = deductSpellMp;
exports.calcThrowableDamage = calcThrowableDamage;
exports.tryStealFromMonster = tryStealFromMonster;
exports.tryEscapeCombat = tryEscapeCombat;

});

__wgDef("word-popup.js", function (exports) {
const { CombatState, applyMonsterAttack, applyMonsterSpellAttack, applyPlayerAttack, combatFinished, monsterAttackMultiplier, monsterWillUseSpell, getMonsterSpellInfo, monsterCanFlee, tryMonsterFlee, formatMonsterSpellFeedback, initCombatFromSave, calcVictoryRewards, attackStaminaCost, aliveMonsterCount, pickActiveMonster, advanceToNextActor, getSpeedOrderPreview } = __wgImport("combat.js", {"CombatState":"CombatState","applyMonsterAttack":"applyMonsterAttack","applyMonsterSpellAttack":"applyMonsterSpellAttack","applyPlayerAttack":"applyPlayerAttack","combatFinished":"combatFinished","monsterAttackMultiplier":"monsterAttackMultiplier","monsterWillUseSpell":"monsterWillUseSpell","getMonsterSpellInfo":"getMonsterSpellInfo","monsterCanFlee":"monsterCanFlee","tryMonsterFlee":"tryMonsterFlee","formatMonsterSpellFeedback":"formatMonsterSpellFeedback","initCombatFromSave":"initCombatFromSave","calcVictoryRewards":"calcVictoryRewards","attackStaminaCost":"attackStaminaCost","aliveMonsterCount":"aliveMonsterCount","pickActiveMonster":"pickActiveMonster","advanceToNextActor":"advanceToNextActor","getSpeedOrderPreview":"getSpeedOrderPreview"});
const { saveSettings } = __wgImport("settings.js", {"saveSettings":"saveSettings"});
const { getMonsterIconUrl } = __wgImport("goods-data.js", {"getMonsterIconUrl":"getMonsterIconUrl"});
const { readValues, writeValues, STAT, syncPlayerFromRole, getRoleDisplayName, getRoleCount } = __wgImport("game-runtime.js", {"readValues":"readValues","writeValues":"writeValues","STAT":"STAT","syncPlayerFromRole":"syncPlayerFromRole","getRoleDisplayName":"getRoleDisplayName","getRoleCount":"getRoleCount"});
const { changeGoodsByName } = __wgImport("inventory-system.js", {"changeGoodsByName":"changeGoodsByName"});
const { rollDigDrop, getMineTable, getHerbTable, calcDigCloseBonusExp } = __wgImport("dig-system.js", {"rollDigDrop":"rollDigDrop","getMineTable":"getMineTable","getHerbTable":"getHerbTable","calcDigCloseBonusExp":"calcDigCloseBonusExp"});
const { listCombatSpells, listCombatItems, bumpSpellUse, calcHealAmount, applyHealToRole, calcAttackSpellMpCost, applySpellAttackToMonster, calcThrowableDamage, deductSpellMp, tryStealFromMonster, tryEscapeCombat } = __wgImport("combat-actions.js", {"listCombatSpells":"listCombatSpells","listCombatItems":"listCombatItems","bumpSpellUse":"bumpSpellUse","calcHealAmount":"calcHealAmount","applyHealToRole":"applyHealToRole","calcAttackSpellMpCost":"calcAttackSpellMpCost","applySpellAttackToMonster":"applySpellAttackToMonster","calcThrowableDamage":"calcThrowableDamage","deductSpellMp":"deductSpellMp","tryStealFromMonster":"tryStealFromMonster","tryEscapeCombat":"tryEscapeCombat"});

/** Study-mode reward: each correct answer restores 1% max lingli (min 1) for every party member. */
function addPartyLingliByPercent(save, percent = 1) {
  for (let i = 0; i < getRoleCount(save); i += 1) {
    const max = readValues(save, i, STAT.gdll26);
    const cur = readValues(save, i, STAT.lingli);
    if (cur >= max || max <= 0) continue;
    const gain = Math.max(1, Math.floor((max * percent) / 100));
    writeValues(save, i, STAT.lingli, Math.min(max, cur + gain));
  }
  syncPlayerFromRole(save, 0);
}

 class WordPopup {
  constructor(root, { wordEngine, settings, api = null }) {
    this.root = root;
    this.wordEngine = wordEngine;
    this.settings = settings;
    this.api = api;
    this.onComplete = null;
    this.onFail = null;

    this.modal = document.getElementById('word-modal');
    this.titleEl = document.getElementById('word-modal-title');
    this.promptEl = document.getElementById('word-prompt');
    this.choicesEl = document.getElementById('word-choices');
    this.feedbackEl = document.getElementById('word-feedback');
    this.progressEl = document.getElementById('word-progress');
    this.fightBar = document.getElementById('fight-bar');
    this.fightActions = document.getElementById('fight-actions');
    this.fightPicker = document.getElementById('fight-picker');
    this.closeBtn = document.getElementById('word-modal-close');
    this.reverseCheckbox = document.getElementById('reverse-learn');

    this.mode = 'study';
    this.remaining = 0;
    this.combat = null;
    this.saveRef = null;
    this.canClose = true;
    this.currentQuestion = null;
    this.turnTimer = null;
    this.pendingTimer = null;
    this.digCount = 100;
    this.gameKaoshi = 0;
    this.digCorrect = 0;
    this.jitNum = 1;
    this.hintTimer = null;
    this.hintChoice = null;

    this.closeBtn.addEventListener('click', () => this.tryClose());
    this.reverseCheckbox.addEventListener('change', () => {
      this.settings.reverseLearn = this.reverseCheckbox.checked;
      saveSettings(this.settings);
    });
    this._onKeyDown = (ev) => this.handleKeyDown(ev);
    document.addEventListener('keydown', this._onKeyDown);

    this.fightActions?.querySelectorAll('[data-fight]').forEach((btn) => {
      btn.addEventListener('click', () => this.handlePlayerFight(btn.dataset.fight));
    });
    this.updateFightHotkeyLabels();
  }

  normalizeHotkey(value, fallback = '') {
    const key = String(value || fallback).trim();
    if (!key) return fallback.toUpperCase();
    if (key.toLowerCase() === 'del') return 'Del';
    return key.length === 1 ? key.toUpperCase() : key;
  }

  getFightKeyMap() {
    const s = this.settings || {};
    return {
      [this.normalizeHotkey(s.fightAttack, 'G')]: 'attack',
      [this.normalizeHotkey(s.fightDefend, 'F')]: 'defend',
      [this.normalizeHotkey(s.fightMagic, 'S')]: 'magic',
      [this.normalizeHotkey(s.fightItem, 'W')]: 'item',
      [this.normalizeHotkey(s.fightEscape, 'T')]: 'escape',
    };
  }

  getWordChoiceKeyMap() {
    const s = this.settings || {};
    return {
      [this.normalizeHotkey(s.wordChoice1, 'Y')]: 0,
      [this.normalizeHotkey(s.wordChoice2, 'H')]: 1,
      [this.normalizeHotkey(s.wordChoice3, 'N')]: 2,
      '1': 0,
      '2': 1,
      '3': 2,
    };
  }

  updateFightHotkeyLabels() {
    if (!this.fightActions) return;
    const labels = {
      attack: this.normalizeHotkey(this.settings?.fightAttack, 'G'),
      defend: this.normalizeHotkey(this.settings?.fightDefend, 'F'),
      magic: this.normalizeHotkey(this.settings?.fightMagic, 'S'),
      item: this.normalizeHotkey(this.settings?.fightItem, 'W'),
      escape: this.normalizeHotkey(this.settings?.fightEscape, 'T'),
    };
    this.fightActions.querySelectorAll('[data-fight]').forEach((btn) => {
      const mode = btn.dataset.fight;
      const key = labels[mode] || '';
      const text = btn.dataset.label || btn.textContent.trim().replace(/\s*\(.+\)$/, '');
      btn.dataset.label = text;
      btn.innerHTML = `${text}<span class="fight-key">${key}</span>`;
    });
  }

  isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  isPickerOpen() {
    return !!this.fightPicker && !this.fightPicker.classList.contains('hidden');
  }

  isFightPlayerTurn() {
    return this.mode === 'fight'
      && this.combat?.turn === 'player'
      && !this.fightActions?.classList.contains('hidden');
  }

  hasActiveChoices() {
    return !!this.choicesEl?.querySelector('button:not([disabled])');
  }

  eventHotkey(ev) {
    if (ev.key === 'Delete') return 'Del';
    if (/^Digit[1-9]$/.test(ev.code)) return ev.code.replace('Digit', '');
    if (/^Numpad[1-9]$/.test(ev.code)) return ev.code.replace('Numpad', '');
    return ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  }

  handlePickerHotkey(ev) {
    if (!this.isPickerOpen()) return false;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.hidePicker();
      if (this.isFightPlayerTurn()) this.schedulePlayerTurnResume();
      return true;
    }
    const num = Number(this.eventHotkey(ev));
    if (num >= 1 && num <= 9) {
      const btn = this.fightPicker.querySelector(`[data-pick="${num - 1}"]`);
      if (btn) {
        ev.preventDefault();
        btn.click();
        return true;
      }
    }
    return false;
  }

  handleFightActionHotkey(ev) {
    if (!this.isFightPlayerTurn() || this.isPickerOpen()) return false;
    const mode = this.getFightKeyMap()[this.eventHotkey(ev)];
    if (!mode) return false;
    ev.preventDefault();
    this.handlePlayerFight(mode);
    return true;
  }

  handleWordChoiceHotkey(ev) {
    if (!this.hasActiveChoices() || !this.currentQuestion) return false;
    const idx = this.getWordChoiceKeyMap()[this.eventHotkey(ev)];
    if (idx == null || idx >= this.currentQuestion.choices.length) return false;
    ev.preventDefault();
    const isMonsterTurn = this.mode === 'fight' && this.combat?.turn !== 'player';
    this.submitAnswer(this.currentQuestion.choices[idx], isMonsterTurn);
    return true;
  }

  handleKeyDown(ev) {
    if (this.modal.classList.contains('hidden')) return;
    if (this.isTypingTarget(ev.target) && !this.modal.contains(ev.target)) return;

    if (this.handlePickerHotkey(ev)) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.tryClose();
      return;
    }

    if (this.handleFightActionHotkey(ev)) return;
    this.handleWordChoiceHotkey(ev);
  }

  setApi(api) {
    this.api = api;
  }

  updateSettings(settings) {
    this.settings = settings;
    this.reverseCheckbox.checked = !!settings.reverseLearn;
    this.updateFightHotkeyLabels();
  }

  clearTimers() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.hintChoice = null;
  }

  openStudy(count, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'study';
    this.remaining = count;
    this.saveRef = save;
    this.combat = null;
    this.canClose = true;
    this.titleEl.textContent = '\u80cc\u5355\u8bcd ' + count + ' \u4e2a';
    this.fightBar?.classList.add('hidden');
    this.fightActions?.classList.add('hidden');
    this.hidePicker();
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.clearWeather();
    this.show();
    this.nextQuestion();
  }

  openFight(monsterCount, monsterType, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'fight';
    this.remaining = monsterCount;
    this.saveRef = save;
    this.combat = new CombatState(monsterCount, monsterType, save?.mazeFactor ?? 0);
    initCombatFromSave(this.combat, save);
    this.canClose = false;
    this.modal.querySelector('.modal-card')?.classList.add('fight-mode');
    this.applyWeather(save);
    this.updateFightTitle();
    this.fightBar?.classList.remove('hidden');
    this.fightActions?.classList.add('hidden');
    this.updateFightHotkeyLabels();
    this.renderFightBar();
    this.show();
    this.startFightRound();
  }

  openDig(count, save, callbacks = {}) {
    this.clearTimers();
    this.onComplete = callbacks.onComplete || null;
    this.onFail = callbacks.onFail || null;
    this.mode = 'dig';
    this.digCount = Number(count) || 100;
    this.saveRef = save;
    this.combat = null;
    this.canClose = true;
    this.digCorrect = 0;
    this.jitNum = 1;
    this.gameKaoshi = this.digCount >= 1000 ? (this.digCount - 1000) * 3 + 5 : 0;

    if (this.digCount === 200) {
      this.titleEl.textContent = '\u91c7\u836f\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    } else if (this.digCount === 300) {
      this.titleEl.textContent = '\u6253\u5750\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    } else if (this.digCount >= 1000) {
      this.titleEl.textContent = '\u8003\u8bd5 ' + (this.digCount - 1000) + ' \u4e2a';
    } else {
      this.titleEl.textContent = '\u6316\u77ff\uff0c\u53ef\u968f\u65f6\u7ed3\u675f';
    }

    this.fightBar?.classList.add('hidden');
    this.fightActions?.classList.add('hidden');
    this.hidePicker();
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.applyWeather(save);
    this.show();
    this.nextQuestion();
  }

  applyWeather(save) {
    const card = this.modal?.querySelector('.modal-card');
    if (!card) return;
    this.clearWeather();
    const weather = Number(save?.weather ?? 0);
    if (weather < 0) return;

    let effect = weather;
    if (weather === 0) {
      if (Math.floor(Math.random() * 9) !== 0) return;
      effect = 1 + Math.floor(Math.random() * 4);
    }

    const map = {
      1: 'weather-snow',
      2: 'weather-rain',
      3: 'weather-leaves',
      4: 'weather-snow-light',
    };
    const cls = map[effect];
    if (cls) card.classList.add('weather-active', cls);
  }

  clearWeather() {
    const card = this.modal?.querySelector('.modal-card');
    if (!card) return;
    card.classList.remove(
      'weather-active',
      'weather-snow',
      'weather-rain',
      'weather-leaves',
      'weather-snow-light',
    );
  }

  digPayload(extra = {}) {
    return {
      correctCount: this.digCorrect,
      gameKaoshi: this.gameKaoshi,
      ...extra,
    };
  }

  finishDigExam() {
    this.feedbackEl.textContent = '\u8003\u8bd5\u7ed3\u675f\uff0c\u6b63\u786e' + this.digCorrect;
    setTimeout(() => {
      this.hide();
      this.onFail?.(this.digPayload({ examDone: true }));
    }, 900);
  }

  applyDigCloseBonus() {
    if (this.digCount >= 1000 || this.digCorrect <= 0) return;
    const exp = calcDigCloseBonusExp(this.digCorrect);
    if (exp > 0) {
      this.api?.game_attribute_change?.(0, STAT.experience, exp);
      this.api?.ui?.toast?.('\u989d\u5916\u5956\u52b1\u7ecf\u9a8c\u503c\uff1a' + exp);
    }
  }

  updateFightTitle() {
    const alive = this.combat ? aliveMonsterCount(this.combat) : 0;
    const actor = this.combat?.turn === 'player'
      ? getRoleDisplayName(this.saveRef, this.activeRoleIndex() + 1)
      : (pickActiveMonster(this.combat)?.name || '\u602a\u7269');
    this.titleEl.textContent = '\u6218\u6597 \u00b7 \u5269\u4f59\u602a\u7269 ' + alive + ' \u00b7 ' + actor + '\u7684\u56de\u5408';
  }

  startFightRound() {
    this.clearTimers();
    const result = combatFinished(this.combat, this.saveRef);
    if (result === 'win') {
      if (this.combat.monsterEscaped) {
        this.finishFightEscaped();
      } else {
        this.finishFightWin();
      }
      return;
    }
    if (result === 'lose') {
      this.finishFightLose();
      return;
    }

    advanceToNextActor(this.combat, this.saveRef);
    this.renderFightBar();
    this.updateFightTitle();

    if (this.combat.turn === 'player') {
      const ri = this.activeRoleIndex();
      const name = getRoleDisplayName(this.saveRef, ri + 1);
      this.feedbackEl.textContent = name + ' \u7684\u56de\u5408\uff1a\u653b / \u9632 / \u6cd5 / \u7269 / \u9003\uff08\u70ed\u952e\u53ef\u7528\uff09';
      this.fightActions?.classList.remove('hidden');
      this.promptEl.textContent = name + ' \u51fa\u624b';
      this.choicesEl.innerHTML = '';
      this.turnTimer = setTimeout(() => {
        this.feedbackEl.textContent = '\u672a\u64cd\u4f5c\uff0c\u81ea\u52a8\u9632\u5fa1';
        this.doDefend();
      }, 12000);
      return;
    }

    this.fightActions?.classList.add('hidden');
    const monster = pickActiveMonster(this.combat);
    this.feedbackEl.textContent = (monster?.name || '\u602a\u7269') + ' \u7684\u56de\u5408\uff1a\u7b54\u5bf9\u5355\u8bcd\u53ef\u51cf\u8f7b\u4f24\u5bb3\u4e0e\u9003\u8dd1\u6982\u7387\uff01';
    this.nextQuestion(true);
  }

  show() {
    this.modal.classList.remove('hidden');
    this.modal.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.clearTimers();
    this.modal.classList.add('hidden');
    this.modal.setAttribute('aria-hidden', 'true');
    this.modal.querySelector('.modal-card')?.classList.remove('fight-mode');
    this.clearWeather();
    this.hidePicker();
  }

  tryClose() {
    if (this.mode === 'fight' && !this.canClose) {
      this.doEscape(true);
      return;
    }
    if (!this.canClose) return;
    if (this.mode === 'dig') {
      this.applyDigCloseBonus();
      this.hide();
      this.onFail?.(this.digPayload({ cancelled: true }));
      return;
    }
    this.hide();
    this.onFail?.('cancelled');
  }

  renderPrompt(q) {
    const promptIsEn = !q.reverse;
    this.promptEl.style.color = promptIsEn ? this.settings.enColor : this.settings.cnColor;
    this.promptEl.style.fontSize = (promptIsEn ? this.settings.enSize : this.settings.cnSize) + 'px';
    if (q.promptHtml) {
      this.promptEl.innerHTML = q.promptHtml;
    } else {
      this.promptEl.textContent = q.prompt;
    }
  }

  bindChoiceHint(btn, choice, q) {
    btn.addEventListener('mouseenter', () => {
      if (this.hintTimer) clearTimeout(this.hintTimer);
      this.hintChoice = choice;
      this.hintTimer = setTimeout(() => {
        if (this.hintChoice !== choice || btn.disabled) return;
        const money = this.saveRef?.player?.money ?? 0;
        if (money < 60) {
          this.feedbackEl.textContent = '金钱不足，不能显示提示（需60金币）';
          return;
        }
        if (choice === q.answer) {
          this.feedbackEl.textContent = '鼠标下答案正确。';
        } else {
          this.saveRef.player.money = money - 60;
          this.api?.ui?.refreshStatus?.();
          this.feedbackEl.textContent = `提示：正确答案是「${q.answer}」（已扣60金币）`;
        }
      }, 5000);
    });
    btn.addEventListener('mouseleave', () => {
      if (this.hintChoice === choice) {
        clearTimeout(this.hintTimer);
        this.hintTimer = null;
        this.hintChoice = null;
      }
    });
  }

  syncPlayerHpToRole() {
    if (!this.saveRef || !this.combat) return;
    const ri = this.combat.activeRoleIndex ?? 0;
    this.combat.playerHp = readValues(this.saveRef, ri, STAT.life);
    this.combat.playerMaxHp = readValues(this.saveRef, ri, STAT.gdsmz27);
    if (ri === 0) syncPlayerFromRole(this.saveRef, 0);
    this.api?.ui?.refreshStatus?.();
  }

  syncAllPartyHp() {
    if (!this.saveRef) return;
    syncPlayerFromRole(this.saveRef, 0);
    this.api?.ui?.refreshStatus?.();
  }

  activeRoleIndex() {
    return this.combat?.activeRoleIndex ?? 0;
  }

  renderFightBar() {
    if (!this.fightBar || !this.combat) return;

    const partyCards = this.combat.partySlots.map((roleIdx, slot) => {
      const name = getRoleDisplayName(this.saveRef, roleIdx + 1);
      const hp = readValues(this.saveRef, roleIdx, STAT.life);
      const maxHp = readValues(this.saveRef, roleIdx, STAT.gdsmz27) || 1;
      const active = this.combat.turn === 'player' && slot === this.combat.activeSlot;
      return (
        '<div class="fight-unit-card' + (active ? ' fight-unit-active' : '') + (hp <= 0 ? ' fight-unit-dead' : '') + '">' +
        '<strong>' + name + '</strong>' +
        '<div class="hp-bar"><span style="width:' + Math.max(0, (hp / maxHp) * 100) + '%"></span></div>' +
        '<div>' + hp + '/' + maxHp + '</div></div>'
      );
    }).join('');

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const monsterCards = this.combat.monsters.map((m, idx) => {
      if (m.hp <= 0) return '';
      const icon = getMonsterIconUrl(m.icon);
      const img = icon
        ? `<img class="fight-portrait" src="${icon}" alt="${m.name}" onerror="this.classList.add('missing')">`
        : '<div class="fight-portrait missing"></div>';
      const active = this.combat.turn === 'monster' && (5 + idx) === this.combat.activeSlot;
      return (
        '<div class="fight-monster-card' + (active ? ' fight-unit-active' : '') + '">' +
        img +
        '<div class="fight-monster-meta">' +
        '<strong>' + m.name + '</strong>' +
        '<div class="hp-bar"><span style="width:' + (m.hp / m.maxHp) * 100 + '%"></span></div>' +
        '<div>' + m.hp + '/' + m.maxHp + '</div>' +
        '</div></div>'
      );
    }).join('');

    const order = getSpeedOrderPreview(this.combat, this.saveRef)
      .filter((x) => x.alive)
      .sort((a, b) => b.meter - a.meter)
      .slice(0, 4)
      .map((x) => x.name + '(' + x.meter + ')')
      .join(' \u00b7 ');

    const playerSide =
      '<div class="fight-side fight-side-player">' +
      '<h3>\u6211\u65b9</h3>' +
      (partyCards || '<div class="panel-empty">\u5168\u706d</div>') +
      '</div>';

    const enemySide =
      '<div class="fight-side fight-side-enemy">' +
      '<h3>\u654c\u65b9</h3>' +
      (monsterCards || '<div class="panel-empty">\u5168\u706d</div>') +
      '</div>';

    this.fightBar.innerHTML = playerSide + enemySide +
      (order ? '<div class="fight-speed-order">\u901f\u5ea6\u6392\u5e8f\uff1a' + order + '</div>' : '');
  }

  hidePicker() {
    if (!this.fightPicker) return;
    this.fightPicker.classList.add('hidden');
    this.fightPicker.innerHTML = '';
  }

  showPicker(title, items, onPick) {
    if (!this.fightPicker) return;
    this.fightPicker.classList.remove('hidden');
    this.fightPicker.innerHTML = `
      <div class="fight-picker-head">
        <strong>${title}</strong>
        <button type="button" class="mini-btn" data-picker-cancel>\u53d6\u6d88</button>
      </div>
      <div class="fight-picker-list">${items.map((item, idx) => `
        <button type="button" class="fight-picker-btn" data-pick="${idx}">${item.label}</button>`).join('')}
      </div>`;
    this.fightPicker.querySelector('[data-picker-cancel]')?.addEventListener('click', () => this.hidePicker());
    this.fightPicker.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pick = items[Number(btn.dataset.pick)];
        this.hidePicker();
        onPick(pick);
      });
    });
  }

  handlePlayerFight(mode) {
    this.clearTimers();
    if (mode === 'defend') {
      this.doDefend();
      return;
    }
    if (mode === 'escape') {
      this.doEscape();
      return;
    }
    if (mode === 'magic') {
      this.openMagicPicker();
      return;
    }
    if (mode === 'item') {
      this.openItemPicker();
      return;
    }
    this.doAttack('attack');
  }

  doAttack(mode) {
    const ri = this.activeRoleIndex();
    const maxTili = readValues(this.saveRef, ri, STAT.gdtl25);
    const cost = attackStaminaCost(maxTili);
    const tili = readValues(this.saveRef, ri, STAT.tili);
    if (tili < cost) {
      this.feedbackEl.textContent = '\u4f53\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u653b\u51fb';
      this.schedulePlayerTurnResume();
      return;
    }
    writeValues(this.saveRef, ri, STAT.tili, tili - cost);
    if (ri === 0) syncPlayerFromRole(this.saveRef, 0);

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const pickTarget = (index) => {
      const { dmg, target } = applyPlayerAttack(this.combat, mode, index);
      this.feedbackEl.textContent = '\u5bf9 ' + (target?.name || '\u654c\u4eba') + ' \u9020\u6210 ' + dmg + ' \u70b9\u4f24\u5bb3';
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
    };

    if (alive.length > 1) {
      this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
        label: `${m.name} (${m.hp}/${m.maxHp})`,
        index: idx,
      })), (pick) => pickTarget(pick.index));
      return;
    }
    pickTarget(0);
  }

  doDefend() {
    const ri = this.activeRoleIndex();
    this.combat.defendBoostByRole[ri] = 2;
    this.feedbackEl.textContent = '\u91c7\u53d6\u9632\u5fa1\u59ff\u6001\uff0c\u4e0b\u6b21\u53d7\u4f24\u51cf\u8f7b';
    this.finishPlayerAction();
  }

  doEscape(fromClose = false) {
    const result = tryEscapeCombat(this.saveRef, this.combat, { confirmUseItem: true });
    if (result.ok) {
      this.feedbackEl.textContent = result.usedItem ? '\u4f7f\u7528\u8ff7\u8e2a\u86cf\uff0c\u9003\u8dd1\u6210\u529f\uff01' : '\u9003\u8dd1\u6210\u529f\uff01';
      this.canClose = true;
      this.syncPlayerHpToRole();
      setTimeout(() => {
        this.hide();
        this.onFail?.('escaped');
      }, 800);
      return;
    }
    const msg = result.message || (fromClose ? '\u9003\u8dd1\u5931\u8d25\u3002' : '\u9003\u8dd1\u5931\u8d25\uff0c\u7ee7\u7eed\u6218\u6597');
    this.feedbackEl.textContent = msg;
    if (result.reason === 'blocked') {
      this.schedulePlayerTurnResume();
      return;
    }
    this.finishPlayerAction();
  }

  openMagicPicker() {
    const ri = this.activeRoleIndex();
    const { heal, attack, steal } = listCombatSpells(this.saveRef, ri);
    const all = [
      ...heal.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u6062\u590d, \u7075${s.mpCost})`, kind: 'heal' })),
      ...steal.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u5077\u7a83, \u7075${s.mpCost})`, kind: 'steal' })),
      ...attack.map((s) => ({ ...s, label: `${s.name} Lv${s.level} (\u653b\u51fb, \u7075${s.mpCost})`, kind: 'attack' })),
    ];
    if (!all.length) {
      this.feedbackEl.textContent = '\u672a\u5b66\u4f1a\u6cd5\u672f\u6216\u7075\u529b\u4e0d\u8db3';
      this.schedulePlayerTurnResume();
      return;
    }
    this.showPicker('\u9009\u62e9\u6cd5\u672f', all, (pick) => this.castSpell(pick));
  }

  castSpell(spell) {
    const ri = this.activeRoleIndex();
    const mp = readValues(this.saveRef, ri, STAT.lingli);
    const estCost = spell.isAttack ? calcAttackSpellMpCost(spell.info, spell.level) : spell.mpCost;
    if (mp < estCost) {
      this.feedbackEl.textContent = '\u7075\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u65bd\u6cd5';
      this.schedulePlayerTurnResume();
      return;
    }

    const level = bumpSpellUse(this.saveRef, ri, spell.id);
    const mpCost = spell.isAttack ? calcAttackSpellMpCost(spell.info, level) : spell.mpCost;
    if (mp < mpCost) {
      this.feedbackEl.textContent = '\u7075\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u65bd\u6cd5';
      this.schedulePlayerTurnResume();
      return;
    }

    deductSpellMp(this.saveRef, ri, mpCost);

    if (spell.isSteal) {
      const alive = this.combat.monsters.filter((m) => m.hp > 0);
      const castSteal = (targetIndex) => {
        const target = alive[targetIndex] || alive[0];
        if (!target) return;
        const result = tryStealFromMonster(this.saveRef, target, spell.info, level);
        this.feedbackEl.textContent = result.message;
        this.api?.ui?.refreshStatus?.();
        this.finishPlayerAction();
      };

      if (spell.singleTarget && alive.length > 1) {
        this.showPicker('\u9009\u62e9\u5077\u7a83\u76ee\u6807', alive.map((m, idx) => ({
          label: `${m.name} (${m.hp}/${m.maxHp})`,
          index: idx,
        })), (pick) => castSteal(pick.index));
        return;
      }
      castSteal(0);
      return;
    }

    if (!spell.isAttack) {
      const partyIndices = this.combat.partySlots;
      const targets = spell.singleTarget ? [ri] : partyIndices;
      for (const idx of targets) {
        const gains = calcHealAmount(this.saveRef, idx, spell.info, level);
        applyHealToRole(this.saveRef, idx, gains);
      }
      this.syncAllPartyHp();
      this.renderFightBar();
      this.feedbackEl.textContent = '\u65bd\u5c55 ' + spell.name + ' \u6062\u590d\u751f\u547d';
      this.finishPlayerAction();
      return;
    }

    const alive = this.combat.monsters.filter((m) => m.hp > 0);
    const applyToMonster = (targetIndex) => {
      const target = alive[targetIndex] || alive[0];
      if (!target) return;
      const { dmg, debuffText } = applySpellAttackToMonster(target, spell.info, level);
      this.feedbackEl.textContent = spell.name + ' \u5bf9 ' + target.name + ' \u9020\u6210 ' + dmg + ' \u70b9\u4f24\u5bb3' + debuffText;
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
    };

    if (spell.singleTarget && alive.length > 1) {
      this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
        label: `${m.name} (${m.hp}/${m.maxHp})`,
        index: idx,
      })), (pick) => applyToMonster(pick.index));
      return;
    }

    if (!spell.singleTarget) {
      let total = 0;
      let debuffText = '';
      for (const m of alive) {
        const result = applySpellAttackToMonster(m, spell.info, level);
        total += result.dmg;
        if (result.debuffText) debuffText = result.debuffText;
      }
      this.feedbackEl.textContent = spell.name + ' \u5168\u4f53\u653b\u51fb\uff0c\u5171\u9020\u6210 ' + total + ' \u70b9\u4f24\u5bb3' + debuffText;
      this.renderFightBar();
      this.updateFightTitle();
      this.finishPlayerAction();
      return;
    }

    applyToMonster(0);
  }

  openItemPicker() {
    const { medicine, enhancement, throwable } = listCombatItems(this.saveRef);
    const items = [
      ...medicine.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u836f\u54c1)`, kind: 'medicine' })),
      ...enhancement.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u589e\u5f3a)`, kind: 'enhance' })),
      ...throwable.map((m) => ({ ...m, label: `${m.name} \u00d7${m.count} (\u6697\u5668)`, kind: 'throw' })),
    ];
    if (!items.length) {
      this.feedbackEl.textContent = '\u6ca1\u6709\u53ef\u7528\u7269\u54c1';
      this.schedulePlayerTurnResume();
      return;
    }
    this.showPicker('\u9009\u62e9\u7269\u54c1', items, (pick) => this.useCombatItem(pick));
  }

  useCombatItem(item) {
    if (item.kind === 'throw') {
      if (item.name === '\u8ff7\u8e2a\u86cf') {
        changeGoodsByName(this.saveRef, item.name, -1);
        this.feedbackEl.textContent = '\u4f7f\u7528\u8ff7\u8e2a\u86cf\uff0c\u9003\u79bb\u6218\u6597';
        this.canClose = true;
        this.syncPlayerHpToRole();
        setTimeout(() => {
          this.hide();
          this.onFail?.('escaped');
        }, 700);
        return;
      }

      changeGoodsByName(this.saveRef, item.name, -1);
      const alive = this.combat.monsters.filter((m) => m.hp > 0);
      const speed = readValues(this.saveRef, this.activeRoleIndex(), STAT.speed) || this.combat.playerSpeed;
      const applyThrow = (targetIndex) => {
        const target = alive[targetIndex] || alive[0];
        const roll = calcThrowableDamage(item.info, target, speed);
        if (!roll.hit) {
          this.feedbackEl.textContent = item.name + ' \u672a\u547d\u4e2d ' + target.name;
          this.finishPlayerAction();
          return;
        }
        target.hp = Math.max(0, target.hp - roll.dmg);
        this.feedbackEl.textContent = item.name + ' \u547d\u4e2d ' + target.name + '\uff0c\u9020\u6210 ' + roll.dmg + ' \u70b9\u4f24\u5bb3';
        this.renderFightBar();
        this.updateFightTitle();
        this.finishPlayerAction();
      };

      if (alive.length > 1) {
        this.showPicker('\u9009\u62e9\u653b\u51fb\u76ee\u6807', alive.map((m, idx) => ({
          label: `${m.name} (${m.hp}/${m.maxHp})`,
          index: idx,
        })), (pick) => applyThrow(pick.index));
        return;
      }
      applyThrow(0);
      return;
    }

    changeGoodsByName(this.saveRef, item.name, -1);
    const ri = this.activeRoleIndex();
    const level = 1;
    const gains = calcHealAmount(this.saveRef, ri, item.info, level);
    if (gains.hpGain <= 0 && readValues(this.saveRef, ri, STAT.life) <= 0) {
      this.feedbackEl.textContent = '\u836f\u529b\u4e0d\u8db3\uff0c\u65e0\u6cd5\u6551\u6d3b';
      changeGoodsByName(this.saveRef, item.name, 1);
      this.schedulePlayerTurnResume();
      return;
    }
    applyHealToRole(this.saveRef, ri, gains);
    this.syncAllPartyHp();
    this.renderFightBar();
    this.feedbackEl.textContent = '\u4f7f\u7528\u4e86 ' + item.name;
    this.finishPlayerAction();
  }

  finishPlayerAction() {
    this.pendingTimer = setTimeout(() => this.startFightRound(), 700);
  }

  schedulePlayerTurnResume() {
    this.turnTimer = setTimeout(() => this.resumePlayerTurn(), 1200);
  }

  resumePlayerTurn() {
    if (!this.combat || this.combat.turn !== 'player') {
      this.startFightRound();
      return;
    }
    const ri = this.activeRoleIndex();
    const name = getRoleDisplayName(this.saveRef, ri + 1);
    this.feedbackEl.textContent = name + ' \u7684\u56de\u5408\uff1a\u653b / \u9632 / \u6cd5 / \u7269 / \u9003\uff08\u70ed\u952e\u53ef\u7528\uff09';
    this.fightActions?.classList.remove('hidden');
    this.promptEl.textContent = name + ' \u51fa\u624b';
    this.turnTimer = setTimeout(() => {
      this.feedbackEl.textContent = '\u672a\u64cd\u4f5c\uff0c\u81ea\u52a8\u9632\u5fa1';
      this.doDefend();
    }, 12000);
  }

  finishFightWin() {
    this.feedbackEl.textContent = '\u6218\u6597\u80dc\u5229\uff01';
    this.canClose = true;
    this.syncAllPartyHp();
    const rewards = calcVictoryRewards(this.combat);
    setTimeout(() => {
      this.hide();
      this.onComplete?.({ type: 'fight', result: 'win', rewards });
    }, 900);
  }

  finishFightEscaped() {
    this.feedbackEl.textContent = '\u654c\u4eba\u9003\u8dd1\u4e86\uff01';
    this.canClose = true;
    this.syncAllPartyHp();
    setTimeout(() => {
      this.hide();
      this.onFail?.('monster-escaped');
    }, 900);
  }

  finishFightLose() {
    this.feedbackEl.textContent = '\u6218\u6597\u5931\u8d25\u2026\u2026';
    this.canClose = true;
    for (const ri of this.combat.partySlots) {
      if (readValues(this.saveRef, ri, STAT.life) <= 0) {
        writeValues(this.saveRef, ri, STAT.life, 1);
      }
    }
    this.syncAllPartyHp();
    setTimeout(() => {
      this.hide();
      this.onFail?.('fight-lose');
      this.api?.game_over?.();
    }, 900);
  }

  digProgressText() {
    if (this.digCount >= 1000) {
      return '\u8003\u8bd5 \u00b7 \u5269\u4f59 ' + Math.max(0, this.digCount - 1000) + ' \u9898 \u00b7 \u6b63\u786e ' + this.digCorrect;
    }
    return '\u7b54\u5bf9 ' + this.digCorrect + ' \u9898 \u00b7 \u7b2c ' + this.jitNum + ' \u9898';
  }

  nextQuestion(isMonsterTurn = false) {
    const q = this.wordEngine.pick(this.settings, this.saveRef.wordProgress, this.saveRef);
    if (!q) {
      this.feedbackEl.textContent = '\u8bcd\u5e93\u4e3a\u7a7a\uff0c\u8bf7\u5148\u9009\u62e9\u8bcd\u5e93\u3002';
      return;
    }
    this.currentQuestion = q;
    this.renderPrompt(q);
    this.feedbackEl.textContent = isMonsterTurn
      ? '\u602a\u7269\u63d0\u95ee\u4e2d'
      : '\u9009\u9879\u70ed\u952e Y/H/N \u6216 1/2/3\uff0c\u9f20\u6807\u505c\u75595\u79d2\u663e\u793a\u63d0\u793a';
    this.progressEl.textContent = this.mode === 'study'
      ? '\u5269\u4f59 ' + this.remaining + ' \u9898'
      : this.mode === 'dig'
        ? this.digProgressText()
        : '\u602a\u7269\u63d0\u95ee \u00b7 ' + (pickActiveMonster(this.combat)?.name || '');

    const choiceBg = q.reverse ? (this.settings.choiceEnBg || '#ffffff') : (this.settings.choiceCnBg || '#ffffff');
    const renderChoices = () => {
      this.choicesEl.innerHTML = '';
      q.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.fontSize = (q.reverse ? this.settings.enSize : this.settings.cnSize) + 'px';
        btn.style.color = q.reverse ? this.settings.enColor : this.settings.cnColor;
        btn.style.backgroundColor = choiceBg;
        btn.textContent = (idx + 1) + '. ' + choice;
        btn.addEventListener('click', () => this.submitAnswer(choice, isMonsterTurn));
        this.bindChoiceHint(btn, choice, q);
        this.choicesEl.appendChild(btn);
      });
    };

    const turboLeft = this.saveRef ? readValues(this.saveRef, 0, STAT.yanchi30) : 0;
    const skipDelay = turboLeft > 0 && !isMonsterTurn;

    if (this.settings.delayShowWord > 0 && !skipDelay && !isMonsterTurn) {
      this.choicesEl.innerHTML = '<p style="text-align:center;color:inherit">\u9009\u9879\u52a0\u8f7d\u4e2d\u2026</p>';
      setTimeout(renderChoices, this.settings.delayShowWord);
    } else {
      renderChoices();
      if (skipDelay && this.saveRef) {
        writeValues(this.saveRef, 0, STAT.yanchi30, turboLeft - 1);
      }
    }
  }

  submitAnswer(choice, isMonsterTurn) {
    const q = this.currentQuestion;
    const correct = choice === q.answer;
    this.wordEngine.recordResult(q.entry, correct, this.saveRef.wordProgress, this.settings, q.wordIndex, this.saveRef);
    this.saveRef.wordStats[correct ? 'correct' : 'wrong'] += 1;
    this.api?.persist?.();

    [...this.choicesEl.querySelectorAll('button')].forEach((btn) => {
      btn.disabled = true;
      if (btn.textContent.includes(q.answer)) btn.classList.add('correct');
      if (btn.textContent.includes(choice) && !correct) btn.classList.add('wrong');
    });

    if (this.mode === 'study') {
      if (!correct) {
        this.feedbackEl.textContent = '\u7b54\u9519\u4e86\uff0c\u672c\u6b21\u80cc\u5355\u8bcd\u7ed3\u675f\u3002';
        setTimeout(() => { this.hide(); this.onFail?.('wrong'); }, 900);
        return;
      }
      this.remaining -= 1;
      addPartyLingliByPercent(this.saveRef);
      this.api?.ui?.refreshStatus?.();
      if (this.remaining <= 0) {
        this.feedbackEl.textContent = '\u5168\u90e8\u7b54\u5bf9\uff0c\u5e72\u5f97\u6f02\u4eae\uff01';
        setTimeout(() => { this.hide(); this.onComplete?.({ type: 'study' }); }, 900);
        return;
      }
      setTimeout(() => this.nextQuestion(), 700);
      return;
    }

    if (this.mode === 'dig') {
      this.handleDigAnswer(correct);
      return;
    }

    const mult = monsterAttackMultiplier(correct);
    const monster = pickActiveMonster(this.combat);
    let feedback;

    if (monster && monsterCanFlee(monster)) {
      if (correct) {
        this.feedbackEl.textContent = `\u7b54\u5bf9\u4e86\uff01${monster.name} \u9003\u8dd1\u5931\u8d25\u3002`;
        setTimeout(() => this.startFightRound(), 1000);
        return;
      }
      const flee = tryMonsterFlee(this.combat, this.saveRef, mult);
      if (flee.fled) {
        this.renderFightBar();
        this.updateFightTitle();
        feedback = `\u7b54\u9519\u4e86\uff01${flee.monster.name} \u9003\u8d70\u4e86\uff01`;
        this.feedbackEl.textContent = feedback;
        setTimeout(() => this.startFightRound(), 1000);
        return;
      }
    }

    if (monster && monsterWillUseSpell(monster)) {
      const spellInfo = getMonsterSpellInfo(monster);
      if (spellInfo) {
        const spellResult = applyMonsterSpellAttack(this.combat, this.saveRef, mult, spellInfo);
        this.renderFightBar();
        this.syncAllPartyHp();
        feedback = formatMonsterSpellFeedback(this.saveRef, correct, spellResult);
      }
    }

    if (!feedback) {
      const { dmg, monster: atkMonster, targetRoleIndex } = applyMonsterAttack(this.combat, this.saveRef, mult);
      const targetName = getRoleDisplayName(this.saveRef, targetRoleIndex + 1);
      this.renderFightBar();
      this.syncAllPartyHp();
      feedback = correct
        ? `\u7b54\u5bf9\u4e86\uff01${atkMonster.name} \u5bf9 ${targetName} \u7684\u653b\u51fb\u88ab\u524a\u5f31\uff0c\u4ec5\u53d7\u5230 ${dmg} \u70b9\u4f24\u5bb3`
        : `\u7b54\u9519\u4e86\uff01${targetName} \u53d7\u5230 ${atkMonster.name} \u7684\u731b\u70c8\u653b\u51fb ${dmg} \u70b9\u4f24\u5bb3`;
    }

    this.feedbackEl.textContent = feedback;

    setTimeout(() => {
      this.startFightRound();
    }, 1000);
  }

  handleDigAnswer(correct) {
    const isExam = this.digCount >= 1000;
    const isHerb = this.digCount === 200;
    const isMeditate = this.digCount === 300;

    if (isExam) this.gameKaoshi -= 3;

    if (!correct) {
      if (isHerb) this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u91c7\u836f\u7ed3\u675f\u3002';
      else if (isMeditate) this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u6253\u5750\u7ed3\u675f\u3002';
      else if (isExam) this.feedbackEl.textContent = '\u8003\u8bd5\u9519\u4e86\u4e00\u9898\u3002';
      else this.feedbackEl.textContent = '\u60a8\u6ca1\u6709\u7b54\u5bf9\uff0c\u6316\u77ff\u7ed3\u675f\u3002';

      if (!isExam) {
        setTimeout(() => {
          this.hide();
          this.onFail?.(this.digPayload({ wrong: true }));
        }, 900);
        return;
      }
    } else if (isMeditate) {
      this.feedbackEl.textContent = '\u6062\u590d\u7075\u529b1%';
    } else if (isExam) {
      this.feedbackEl.textContent =
        '\u8003\u8bd5\u6b63\u786e' + (this.digCorrect + 1) + '\u9898\u5269\u4f59' + (this.digCount - 1001) + '\u9898';
    } else {
      this.feedbackEl.textContent = '\u589e\u52a0\u7ecf\u9a8c\u503c5';
      const table = isHerb ? getHerbTable() : getMineTable();
      const item = rollDigDrop(table);
      if (item) {
        this.api?.game_goods_change_n?.(item, 1);
        this.feedbackEl.textContent = item + ' \u6316\u5230\u4e00';
      } else {
        this.feedbackEl.textContent = '\u9009\u62e9\u6b63\u786e\uff01 \u5f53\u524d ' + this.jitNum + ' \u4e2a';
      }
    }

    this.jitNum += 1;

    if (correct) {
      if (isMeditate) {
        this.api?.game_lingli_add?.(0, 1);
        syncPlayerFromRole(this.saveRef, 0);
        this.api?.ui?.refreshStatus?.();
      } else {
        this.api?.game_attribute_change?.(0, STAT.experience, 5);
        this.digCorrect += 1;
        if (!isExam && this.digCorrect === 100) {
          this.digCorrect = 0;
          this.api?.game_attribute_change?.(0, STAT.experience, 1000);
          this.feedbackEl.textContent = '\u5956\u52b1\u7ecf\u9a8c\u503c1000';
        }
      }
    }

    if (isExam && this.digCount > 1000) {
      this.digCount -= 1;
    }

    if (this.digCount === 1000) {
      this.finishDigExam();
      return;
    }

    const delay = isExam && !correct ? 1200 : 900;
    setTimeout(() => this.nextQuestion(), delay);
  }
}

exports.WordPopup = WordPopup;

});

__wgDef("player-panel.js", function (exports) {
const { getGoodsInfo, formatGoodsSummary } = __wgImport("goods-data.js", {"getGoodsInfo":"getGoodsInfo","formatGoodsSummary":"formatGoodsSummary"});
const { readValues, STAT, ensureParty } = __wgImport("game-runtime.js", {"readValues":"readValues","STAT":"STAT","ensureParty":"ensureParty"});
const { equipGoods, unequipSlot, dropGoods, useMedicine, learnSkillBook, useSpecialGoods, listInventoryByCategory, listSkills, getEquippedGoods, EQUIP_SLOTS } = __wgImport("inventory-system.js", {"equipGoods":"equipGoods","unequipSlot":"unequipSlot","dropGoods":"dropGoods","useMedicine":"useMedicine","learnSkillBook":"learnSkillBook","useSpecialGoods":"useSpecialGoods","listInventoryByCategory":"listInventoryByCategory","listSkills":"listSkills","getEquippedGoods":"getEquippedGoods","EQUIP_SLOTS":"EQUIP_SLOTS"});

 class PlayerPanel {
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

exports.PlayerPanel = PlayerPanel;

});

__wgDef("tasks-panel.js", function (exports) {
const { getTaskInfo } = __wgImport("game-config.js", {"getTaskInfo":"getTaskInfo"});

 class TasksPanel {
  constructor(modalEl, api) {
    this.modal = modalEl;
    this.api = api;
    this.tab = 'active';
    this.modal.querySelector('[data-close="tasks"]').addEventListener('click', () => this.close());
    this.modal.querySelectorAll('.tasks-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.modal.querySelectorAll('.tasks-tab').forEach((b) => b.classList.toggle('active', b === btn));
        this.render();
      });
    });
    this.modal.addEventListener('click', (e) => {
      const abandon = e.target.closest('[data-abandon-task]');
      if (abandon) {
        this.abandonTask(abandon.dataset.abandonTask);
        return;
      }
      if (e.target.closest('[data-clear-completed]')) {
        this.clearCompleted();
        return;
      }
      if (e.target.closest('[data-clear-messages]')) {
        this.clearMessages();
      }
    });
  }

  open() {
    this.tab = 'active';
    this.modal.querySelectorAll('.tasks-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    });
    this.render();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  renderIfOpen() {
    if (!this.modal.classList.contains('hidden')) this.render();
  }

  abandonTask(id) {
    if (!window.confirm(`是否放弃任务 ${id}？`)) return;
    this.api.game_del_res_event(id);
    delete this.api.state.tasks[String(id)];
    this.api.persist();
    this.api.game_reload_chatlist();
    this.render();
  }

  clearCompleted() {
    if (!window.confirm('是否清空这些已完成的任务列表？该操作不会去除已经获得的经验值和物品。')) return;
    const tasks = this.api.state.tasks || {};
    for (const [id, task] of Object.entries(tasks)) {
      if (task.completed) delete tasks[id];
    }
    this.api.persist();
    this.render();
  }

  clearMessages() {
    if (!window.confirm('是否清空这些提示消息？')) return;
    this.api.state.messages = [];
    this.api.persist();
    this.render();
  }

  renderTaskItem(id, task) {
    const info = getTaskInfo(id);
    const desc = info?.text ? `<div class="trade-desc">${escapeHtml(info.text)}</div>` : '';
    const status = task.completed
      ? '<span class="task-status done">已完成</span>'
      : '<span class="task-status active">进行中</span>';
    const abandon = !task.completed
      ? `<button type="button" class="task-action" data-abandon-task="${escapeHtml(id)}">删除</button>`
      : '';
    return `<li><div class="task-main"><strong>任务 ${escapeHtml(id)}</strong>${desc}</div><div class="task-actions">${status}${abandon}</div></li>`;
  }

  render() {
    const body = this.modal.querySelector('#tasks-body');
    const stats = this.api.state.wordStats || { correct: 0, wrong: 0 };
    const tasks = Object.entries(this.api.state.tasks || {});
    const active = tasks.filter(([, t]) => t.active && !t.completed);
    const completed = tasks.filter(([, t]) => t.completed);
    const messages = Array.isArray(this.api.state.messages) ? this.api.state.messages : [];

    let html = `
      <section class="panel-section compact-stats">
        <p class="panel-quote">背单词统计：正确 ${stats.correct} · 错误 ${stats.wrong}</p>
      </section>`;

    if (this.tab === 'active') {
      html += '<section class="panel-section"><h3>未完成的任务</h3>';
      if (!active.length) {
        html += '<p class="panel-empty">暂无进行中的任务</p>';
      } else {
        html += `<ul class="task-list">${active.map(([id, t]) => this.renderTaskItem(id, t)).join('')}</ul>`;
      }
      html += '</section>';
    } else if (this.tab === 'completed') {
      html += '<section class="panel-section"><div class="panel-toolbar"><h3>已完成的任务</h3>';
      if (completed.length) {
        html += '<button type="button" class="task-action" data-clear-completed>清空列表</button>';
      }
      html += '</div>';
      if (!completed.length) {
        html += '<p class="panel-empty">暂无已完成任务</p>';
      } else {
        html += `<ul class="task-list">${completed.map(([id, t]) => this.renderTaskItem(id, t)).join('')}</ul>`;
      }
      html += '</section>';
    } else {
      html += '<section class="panel-section"><div class="panel-toolbar"><h3>消息</h3>';
      if (messages.length) {
        html += '<button type="button" class="task-action" data-clear-messages>清空消息</button>';
      }
      html += '</div>';
      if (!messages.length) {
        html += '<p class="panel-empty">暂无提示消息</p>';
      } else {
        html += `<ul class="message-list">${messages.map((m) => `<li>${escapeHtml(String(m))}</li>`).join('')}</ul>`;
      }
      html += '</section>';
    }

    body.innerHTML = html;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.TasksPanel = TasksPanel;

});

__wgDef("trade-panel.js", function (exports) {
const { getShop, getGoodsInfo, getShopQuote, canSellInShop, calcBuyPrice, calcSellPrice, randomDiscount, formatGoodsSummary, getGoodsIconUrl } = __wgImport("goods-data.js", {"getShop":"getShop","getGoodsInfo":"getGoodsInfo","getShopQuote":"getShopQuote","canSellInShop":"canSellInShop","calcBuyPrice":"calcBuyPrice","calcSellPrice":"calcSellPrice","randomDiscount":"randomDiscount","formatGoodsSummary":"formatGoodsSummary","getGoodsIconUrl":"getGoodsIconUrl"});
const { MAX_GOODS_STACK } = __wgImport("inventory-system.js", {"MAX_GOODS_STACK":"MAX_GOODS_STACK"});

 class TradePanel {
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

exports.TradePanel = TradePanel;

});

__wgDef("save-panel.js", function (exports) {
const { exportSaveString, importSaveString, getSaveSummary, copyText, readClipboardText, applySaveToGame, loadSlotIntoGame } = __wgImport("save-transfer.js", {"exportSaveString":"exportSaveString","importSaveString":"importSaveString","getSaveSummary":"getSaveSummary","copyText":"copyText","readClipboardText":"readClipboardText","applySaveToGame":"applySaveToGame","loadSlotIntoGame":"loadSlotIntoGame"});
const { listSaveSlots, persistSaveToSlot, deleteSlot, getActiveSlotId, setActiveSlotId, findFirstEmptySlot, countNonEmptySlots, loadSlot, buildSlotLabel } = __wgImport("save-manager.js", {"listSaveSlots":"listSaveSlots","persistSaveToSlot":"persistSaveToSlot","deleteSlot":"deleteSlot","getActiveSlotId":"getActiveSlotId","setActiveSlotId":"setActiveSlotId","findFirstEmptySlot":"findFirstEmptySlot","countNonEmptySlots":"countNonEmptySlots","loadSlot":"loadSlot","buildSlotLabel":"buildSlotLabel"});

 class SavePanel {
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

exports.SavePanel = SavePanel;

});

__wgDef("bubble-shooter.js", function (exports) {
/** Staggered bubble-shooter grid (mouse aim + click to fire). */

 const BUBBLE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c',
];

 class BubbleShooterGame {
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

exports.BUBBLE_COLORS = BUBBLE_COLORS;
exports.BubbleShooterGame = BubbleShooterGame;

});

__wgDef("wuziqi.js", function (exports) {
/** 15x15 Gomoku with mouse placement and simple AI. */

 const WUZIQI_LEVELS = [
  '\u767d\u75f4\u7ea7',
  '\u5165\u95e8\u7ea7',
  '\u4e2d\u7ea7',
  '\u9ad8\u7ea7',
  '\u5927\u5e08\u7ea7',
];

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

 class WuziqiGame {
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

exports.WUZIQI_LEVELS = WUZIQI_LEVELS;
exports.WuziqiGame = WuziqiGame;

});

__wgDef("minigame-panel.js", function (exports) {
const { BubbleShooterGame } = __wgImport("bubble-shooter.js", {"BubbleShooterGame":"BubbleShooterGame"});
const { WuziqiGame, WUZIQI_LEVELS } = __wgImport("wuziqi.js", {"WuziqiGame":"WuziqiGame","WUZIQI_LEVELS":"WUZIQI_LEVELS"});
const { writeValues, readValues, STAT, syncPlayerFromRole, gameBaseRandomZero } = __wgImport("game-runtime.js", {"writeValues":"writeValues","readValues":"readValues","STAT":"STAT","syncPlayerFromRole":"syncPlayerFromRole","gameBaseRandomZero":"gameBaseRandomZero"});

 class MinigamePanel {
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

exports.MinigamePanel = MinigamePanel;

});

__wgDef("app.js", function (exports) {
const { loadSettings, saveSettings, DEFAULT_SETTINGS, REP_OPTIONS, PAGE_THEME_OPTIONS, loadSetTxtDefaults, applyPageTheme, normalizePageTheme } = __wgImport("settings.js", {"loadSettings":"loadSettings","saveSettings":"saveSettings","DEFAULT_SETTINGS":"DEFAULT_SETTINGS","REP_OPTIONS":"REP_OPTIONS","PAGE_THEME_OPTIONS":"PAGE_THEME_OPTIONS","loadSetTxtDefaults":"loadSetTxtDefaults","applyPageTheme":"applyPageTheme","normalizePageTheme":"normalizePageTheme"});
const { createDefaultSave, persistSave, loadSlot, getActiveSlotId } = __wgImport("save-manager.js", {"createDefaultSave":"createDefaultSave","persistSave":"persistSave","loadSlot":"loadSlot","getActiveSlotId":"getActiveSlotId"});
const { applySaveToGame } = __wgImport("save-transfer.js", {"applySaveToGame":"applySaveToGame"});
const { WordEngine, WORD_COLOR_OPTIONS } = __wgImport("word-engine.js", {"WordEngine":"WordEngine","WORD_COLOR_OPTIONS":"WORD_COLOR_OPTIONS"});
const { loadWordAffixes } = __wgImport("word-affix.js", {"loadWordAffixes":"loadWordAffixes"});
const { SceneEngine, GameAPI } = __wgImport("game-api.js", {"SceneEngine":"SceneEngine","GameAPI":"GameAPI"});
const { WordPopup } = __wgImport("word-popup.js", {"WordPopup":"WordPopup"});
const { loadGpicEffects } = __wgImport("gpic-renderer.js", {"loadGpicEffects":"loadGpicEffects"});
const { loadGameData } = __wgImport("goods-data.js", {"loadGameData":"loadGameData"});
const { loadGameConfig } = __wgImport("game-config.js", {"loadGameConfig":"loadGameConfig"});
const { ensureParty, syncPlayerFromRole } = __wgImport("game-runtime.js", {"ensureParty":"ensureParty","syncPlayerFromRole":"syncPlayerFromRole"});
const { PlayerPanel } = __wgImport("player-panel.js", {"PlayerPanel":"PlayerPanel"});
const { TasksPanel } = __wgImport("tasks-panel.js", {"TasksPanel":"TasksPanel"});
const { TradePanel } = __wgImport("trade-panel.js", {"TradePanel":"TradePanel"});
const { CraftPanel } = __wgImport("craft-panel.js", {"CraftPanel":"CraftPanel"});
const { SavePanel } = __wgImport("save-panel.js", {"SavePanel":"SavePanel"});
const { MinigamePanel } = __wgImport("minigame-panel.js", {"MinigamePanel":"MinigamePanel"});

const IN_PROGRESS_KEY = 'wordgame-in-progress';

 class App {
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

 async function boot() {
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

exports.App = App;
exports.boot = boot;

});

__wgDef("main.js", async function (exports) {
const info = document.getElementById('splash-info');

try {
  const { boot } = await __wgReq("app.js");
  await boot();
} catch (err) {
  if (info) info.textContent = `\u542f\u52a8\u5931\u8d25\uff1a${err.message || err}`;
  console.error(err);
}

});

var __entry = __wgRegistry["main.js"];
__entry.loading = true;
Promise.resolve(__entry.factory(__entry.exports)).then(function () {
  __entry.loaded = true;
}).catch(function (err) {
  console.error(err);
  var info = document.getElementById('splash-info');
  if (info) info.textContent = '启动失败：' + (err && err.message ? err.message : err);
});

})();
