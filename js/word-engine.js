import {
  getAbhsState,
  pickAbhsWordId,
  abhsOnCorrect,
  removeWordFromAbhs,
} from './abhs-system.js';
import { colorizeWordHtml } from './word-affix.js';
import {
  getPartSlots,
  pickPartWordIndex,
  rememberPartWord,
  clearPartWord,
} from './part-size.js';
import { fetchDecodedText } from './text-encoding.js';

const ERROR_RING_SIZE = 62;

export const WORD_COLOR_OPTIONS = [
  { value: 0, label: '不分色' },
  { value: 1, label: '前缀优先，二取一' },
  { value: 2, label: '后缀优先，二取一' },
  { value: 3, label: '前缀优先，全部' },
  { value: 4, label: '后缀优先，全部' },
];

/** ComboBox index 0-7 from original settings → internal interval (-1 = off). */
export function repIntervalFromIndex(repIndex) {
  const idx = Number(repIndex);
  if (!Number.isFinite(idx) || idx <= 0) return -1;
  return idx - 1;
}

export function gameBaseRandom(mod) {
  const m = mod > 0 ? mod : 1;
  return Math.floor(Math.random() * m);
}

export class WordEngine {
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

export function parseWordLib(text) {
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

export { removeWordFromAbhs };
