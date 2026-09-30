import { fetchDecodedText } from './text-encoding.js';

let _config = null;
const _includeCache = new Map();

export async function loadGameConfig() {
  if (_config) return _config;
  const res = await fetch('data/config.json');
  if (!res.ok) throw new Error('\u65e0\u6cd5\u52a0\u8f7d\u914d\u7f6e\u6587\u4ef6');
  _config = await res.json();
  return _config;
}

export function getGameConfig() {
  return _config;
}

export function getTaskInfo(id) {
  return _config?.tasks?.[String(id)] || null;
}

export function getSpecialItemScript(name) {
  return _config?.specialItems?.[name] || null;
}

export function getTouxianRank(index) {
  const ranks = _config?.touxian?.ranks || [];
  return ranks[index] || '';
}

export function getPersonaTemplate(name) {
  return _config?.personaTemplates?.[name] || null;
}

export function getPersonaFile(name) {
  return _config?.personaMap?.[name] || null;
}

export function getMineOres() {
  return _config?.mineOres || [];
}

export function getHerbOres() {
  return _config?.herbOres || [];
}

export function getReadTextLine(index, state) {
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

export function getIncludeCache(name) {
  const key = String(name || '').replace(/\.(upp|txt)$/i, '');
  return _config?.includeCache?.[key] || '';
}

/** Maze marker + reading snippet used by `game_include_str('biao_yuedu.upp')`. */
export function getBiaoYueduHtml() {
  return getIncludeCache('biao_yuedu');
}

export async function fetchIncludeText(fileBase) {
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

export function resolveMediaPath(raw) {
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
