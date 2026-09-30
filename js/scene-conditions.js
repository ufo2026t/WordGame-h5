/** Helpers for scene conditional blocks (<:if ...:>) aligned with Delphi scene HTML. */

function isIdentChar(ch) {
  return /[A-Za-z0-9_]/.test(ch || '');
}

export function matchKeyword(text, index, word) {
  const end = index + word.length;
  if (String(text).slice(index, end).toLowerCase() !== word.toLowerCase()) return false;
  const before = index === 0 ? '' : text[index - 1];
  const after = text[end] || '';
  return !isIdentChar(before) && !isIdentChar(after);
}

export function findElseSplit(text) {
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

export function stripTrailingEnd(text) {
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
export function parseHtmlIfChain(text) {
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
export function parseHtmlIfBlock(text) {
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
export function extractRunScripts(text, queueScript) {
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
export function evaluateHtmlIfBlocks(text, evalConditionFn) {
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

export function processConditionalBranch(text, ctx) {
  const queue = ctx.queueScript || (() => {});
  const evalFn = ctx.evalCondition || (() => false);
  const withoutRun = extractRunScripts(text, queue);
  return evaluateHtmlIfBlocks(withoutRun, evalFn);
}

export function evaluateIfChainText(text, evalConditionFn) {
  const chain = parseHtmlIfChain(text);
  if (!chain) return null;
  return evaluateHtmlIfBlocks(pickIfChain(chain, evalConditionFn), evalConditionFn);
}
