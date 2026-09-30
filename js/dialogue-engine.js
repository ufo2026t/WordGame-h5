/**
 * WordGame dialogue engine ?? parses ?????? and drives NPC chat trees.
 */

export function preprocessChatScript(text, evalCondition) {
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

export function expandInlineIf(text, evalCondition) {
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

export function parseDialogueLine(line) {
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

export function buildChatEntries(lines) {
  return lines.map(parseDialogueLine).filter(Boolean);
}

function getTalkIndex(entry) {
  return entry.id;
}

export class DialogueEngine {
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
