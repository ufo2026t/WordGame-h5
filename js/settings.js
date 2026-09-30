export const REP_OPTIONS = [
  { value: 0, label: '错词不重复' },
  { value: 1, label: '立即重复' },
  { value: 2, label: '隔一个再重复' },
  { value: 3, label: '隔二个再重复' },
  { value: 4, label: '隔三个再重复' },
  { value: 5, label: '隔四个再重复' },
  { value: 6, label: '隔五个再重复' },
  { value: 7, label: '隔六个再重复' },
];

export const PAGE_THEME_OPTIONS = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

export function normalizePageTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function applyPageTheme(theme) {
  const next = normalizePageTheme(theme);
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}

export const DEFAULT_SETTINGS = {
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

export function loadSettings() {
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

export function saveSettings(settings) {
  localStorage.setItem('wordgame-settings', JSON.stringify(settings));
}

/** Load defaults from bundled set.txt (original game settings file). */
export async function loadSetTxtDefaults() {
  try {
    const { fetchDecodedText } = await import('./text-encoding.js');
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
