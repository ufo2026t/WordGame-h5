import { fetchDecodedText } from './text-encoding.js';

let prefixes = [];
let suffixes = [];

async function loadAffixFile(url) {
  try {
    return await fetchDecodedText(url);
  } catch {
    return '';
  }
}

export async function loadWordAffixes() {
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
export function colorizeWordHtml(word, settings) {
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
