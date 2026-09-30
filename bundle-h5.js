/**
 * Bundle the game's ES modules into one classic script (no type="module").
 * file:// pages cannot load ES modules, so the HTML5 build needs this.
 */
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, 'js');
const entry = 'main.js';

const REGEX_OK_KEYWORDS = new Set([
  'return', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of',
  'throw', 'new', 'yield', 'await', 'else', 'do', 'typeof',
]);

function resolveId(fromId, spec) {
  const stack = fromId.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function loadSource(id) {
  const file = path.join(jsDir, ...id.split('/'));
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function transformModule(src, id) {
  const edits = [];
  const exportAssigns = [];
  const deps = [];
  let i = 0;
  let depth = 0;
  let exprAllowed = true;

  function peek(n = 0) {
    return src[i + n] || '';
  }

  function startsIdent(ch) {
    return /[A-Za-z_$]/.test(ch);
  }

  function identChar(ch) {
    return /[A-Za-z0-9_$]/.test(ch);
  }

  function skipSpaceAndComments() {
    while (i < src.length) {
      const c = peek();
      const n = peek(1);
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i += 1;
        continue;
      }
      if (c === '/' && n === '/') {
        i += 2;
        while (i < src.length && peek() !== '\n') i += 1;
        continue;
      }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < src.length && !(peek() === '*' && peek(1) === '/')) i += 1;
        i += 2;
        continue;
      }
      break;
    }
  }

  function readIdentAt(pos) {
    let j = pos;
    if (!startsIdent(src[j] || '')) return null;
    j += 1;
    while (j < src.length && identChar(src[j])) j += 1;
    return { name: src.slice(pos, j), end: j };
  }

  function keywordAt(pos, word) {
    if (!src.startsWith(word, pos)) return false;
    const before = pos > 0 ? src[pos - 1] : '';
    const after = src[pos + word.length] || '';
    if (before && identChar(before)) return false;
    if (after && identChar(after)) return false;
    return true;
  }

  function readStringAt(pos) {
    const quote = src[pos];
    let j = pos + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) return { end: j + 1, value: src.slice(pos + 1, j) };
      j += 1;
    }
    throw new Error(`${id}: unterminated string at ${pos}`);
  }

  function skipTemplateAt(pos) {
    let j = pos + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') return j + 1;
      if (c === '$' && src[j + 1] === '{') {
        j += 2;
        let nested = 1;
        while (j < src.length && nested > 0) {
          const inner = skipAtom(j);
          if (inner != null) {
            j = inner;
            continue;
          }
          if (src[j] === '{') nested += 1;
          else if (src[j] === '}') nested -= 1;
          j += 1;
        }
        continue;
      }
      j += 1;
    }
    throw new Error(`${id}: unterminated template at ${pos}`);
  }

  function skipRegexAt(pos) {
    let j = pos + 1;
    let inClass = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j += 1;
        while (j < src.length && identChar(src[j])) j += 1;
        return j;
      } else if (c === '\n') {
        break;
      }
      j += 1;
    }
    return null;
  }

  function skipAtom(pos) {
    const c = src[pos];
    const n = src[pos + 1];
    if (c === '"' || c === "'") return readStringAt(pos).end;
    if (c === '`') return skipTemplateAt(pos);
    if (c === '/' && n === '/') {
      let j = pos + 2;
      while (j < src.length && src[j] !== '\n') j += 1;
      return j;
    }
    if (c === '/' && n === '*') {
      let j = pos + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
      return j + 2;
    }
    return null;
  }

  function skipBalancedValue(pos) {
    let j = pos;
    let local = 0;
    let started = false;
    while (j < src.length) {
      const atom = skipAtom(j);
      if (atom != null) {
        j = atom;
        started = true;
        continue;
      }
      const c = src[j];
      if (c === '/' && exprAllowedAt(j)) {
        const re = skipRegexAt(j);
        if (re != null) {
          j = re;
          started = true;
          continue;
        }
      }
      if (c === '{' || c === '(' || c === '[') {
        local += 1;
        started = true;
        j += 1;
        continue;
      }
      if (c === '}' || c === ')' || c === ']') {
        if (local === 0) break;
        local -= 1;
        j += 1;
        continue;
      }
      if (local === 0 && (c === ',' || c === ';')) break;
      if (local === 0 && c === '\n' && started) {
        let k = j + 1;
        while (k < src.length && (src[k] === ' ' || src[k] === '\t' || src[k] === '\r')) k += 1;
        break;
      }
      j += 1;
      if (!/\s/.test(c)) started = true;
    }
    return j;
  }

  function exprAllowedAt(pos) {
    let k = pos - 1;
    while (k >= 0 && (src[k] === ' ' || src[k] === '\t' || src[k] === '\r')) k -= 1;
    if (k < 0) return true;
    const c = src[k];
    if ('([{,;:+-*%&|^~!?=<>'.includes(c)) return true;
    if (c === '\n') return true;
    if (identChar(c)) {
      let s = k;
      while (s >= 0 && identChar(src[s])) s -= 1;
      const word = src.slice(s + 1, k + 1);
      return REGEX_OK_KEYWORDS.has(word);
    }
    return false;
  }

  function parseNamedSpecifiers(clause) {
    const trimmed = clause.trim();
    if (!trimmed.startsWith('{')) {
      throw new Error(`${id}: only named imports are supported: ${trimmed.slice(0, 80)}`);
    }
    const inner = trimmed.replace(/^\{/, '').replace(/\}$/, '');
    const parts = [];
    let buf = '';
    let local = 0;
    for (let p = 0; p < inner.length; p += 1) {
      const c = inner[p];
      if (c === '{' || c === '(' || c === '[') local += 1;
      else if (c === '}' || c === ')' || c === ']') local -= 1;
      if (c === ',' && local === 0) {
        parts.push(buf);
        buf = '';
      } else buf += c;
    }
    if (buf.trim()) parts.push(buf);
    return parts.filter((part) => part.trim()).map((part) => {
      const text = part.trim();
      const asMatch = text.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) return { imported: asMatch[1], local: asMatch[2] };
      if (!/^[A-Za-z_$][\w$]*$/.test(text)) {
        throw new Error(`${id}: bad import specifier "${text}"`);
      }
      return { imported: text, local: text };
    });
  }

  function readImport(start) {
    let j = start + 'import'.length;
    const saved = i;
    i = j;
    skipSpaceAndComments();
    j = i;
    i = saved;

    if (src[j] === '(') {
      let k = j + 1;
      while (k < src.length && /\s/.test(src[k])) k += 1;
      if (src[k] !== '"' && src[k] !== "'") {
        throw new Error(`${id}: dynamic import must use a string literal`);
      }
      const lit = readStringAt(k);
      const resolved = resolveId(id, lit.value);
      deps.push(resolved);
      edits.push({
        start,
        end: lit.end,
        text: `__wgReq(${JSON.stringify(resolved)}`,
      });
      return lit.end;
    }

    if (src[j] === '"' || src[j] === "'") {
      const lit = readStringAt(j);
      let end = lit.end;
      while (end < src.length && /\s/.test(src[end])) end += 1;
      if (src[end] === ';') end += 1;
      deps.push(resolveId(id, lit.value));
      edits.push({
        start,
        end,
        text: `__wgReq(${JSON.stringify(resolveId(id, lit.value))});`,
      });
      return end;
    }

    let k = j;
    let localDepth = 0;
    let fromAt = -1;
    while (k < src.length) {
      const atom = skipAtom(k);
      if (atom != null) {
        k = atom;
        continue;
      }
      const c = src[k];
      if (c === '{' || c === '(' || c === '[') localDepth += 1;
      else if (c === '}' || c === ')' || c === ']') localDepth -= 1;
      else if (localDepth === 0 && keywordAt(k, 'from')) {
        fromAt = k;
        break;
      }
      k += 1;
    }
    if (fromAt < 0) throw new Error(`${id}: import without from`);
    const clause = src.slice(j, fromAt);
    k = fromAt + 4;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    const lit = readStringAt(k);
    let end = lit.end;
    while (end < src.length && /\s/.test(src[end])) end += 1;
    if (src[end] === ';') end += 1;
    const resolvedFrom = resolveId(id, lit.value);
    deps.push(resolvedFrom);
    const specs = parseNamedSpecifiers(clause);
    const binding = specs.map((spec) => spec.local).join(', ');
    const map = specs.map((spec) => `${JSON.stringify(spec.local)}:${JSON.stringify(spec.imported)}`).join(',');
    edits.push({
      start,
      end,
      text: `const { ${binding} } = __wgImport(${JSON.stringify(resolvedFrom)}, {${map}});`,
    });
    return end;
  }

  function bindingNames(kindPos) {
    const ident = readIdentAt(kindPos);
    let j = ident.end;
    const names = [];
    while (j < src.length) {
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] === '{' || src[j] === '[') {
        throw new Error(`${id}: destructuring export is not supported`);
      }
      const name = readIdentAt(j);
      if (!name) throw new Error(`${id}: expected export binding`);
      names.push(name.name);
      j = name.end;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] === '=') {
        j = skipBalancedValue(j + 1);
        while (j < src.length && /\s/.test(src[j])) j += 1;
      }
      if (src[j] === ',') {
        j += 1;
        continue;
      }
      break;
    }
    return names;
  }

  function readExport(start) {
    let j = start + 'export'.length;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (keywordAt(j, 'default')) throw new Error(`${id}: default export is not supported`);

    if (src[j] === '{') {
      let k = j;
      let local = 0;
      while (k < src.length) {
        if (src[k] === '{') local += 1;
        else if (src[k] === '}') {
          local -= 1;
          if (local === 0) {
            k += 1;
            break;
          }
        }
        k += 1;
      }
      const specs = parseNamedSpecifiers(src.slice(j, k));
      let end = k;
      while (end < src.length && /\s/.test(src[end])) end += 1;
      if (src[end] === ';') end += 1;
      specs.forEach((spec) => {
        exportAssigns.push(`exports[${JSON.stringify(spec.local)}] = ${spec.imported};`);
      });
      // parseNamedSpecifiers uses imported/local from "a as b" where imported is the local binding
      // and local is the exported name. For export { a as b }, a is local binding, b is export name.
      // parseNamedSpecifiers treats "a as b" as imported=a local=b, which matches export { a as b }.
      // Assignment should be exports[b] = a, i.e. exports[spec.local] = spec.imported. Correct.
      edits.push({ start, end, text: '' });
      return end;
    }

    let namePos = j;
    if (keywordAt(j, 'async')) {
      namePos = j + 'async'.length;
      while (namePos < src.length && /\s/.test(src[namePos])) namePos += 1;
    }
    if (keywordAt(namePos, 'function') || keywordAt(namePos, 'class')) {
      const kind = keywordAt(namePos, 'function') ? 'function' : 'class';
      let n = namePos + kind.length;
      while (n < src.length && /\s/.test(src[n])) n += 1;
      const name = readIdentAt(n);
      if (!name) throw new Error(`${id}: anonymous export ${kind}`);
      exportAssigns.push(`exports.${name.name} = ${name.name};`);
      edits.push({ start, end: start + 'export'.length, text: '' });
      return start + 'export'.length;
    }
    if (keywordAt(j, 'const') || keywordAt(j, 'let') || keywordAt(j, 'var')) {
      bindingNames(j).forEach((name) => {
        exportAssigns.push(`exports.${name} = ${name};`);
      });
      edits.push({ start, end: start + 'export'.length, text: '' });
      return start + 'export'.length;
    }
    throw new Error(`${id}: unsupported export near ${src.slice(start, start + 40)}`);
  }

  while (i < src.length) {
    const atomEnd = skipAtom(i);
    if (atomEnd != null && (peek() === '"' || peek() === "'" || peek() === '`' || (peek() === '/' && (peek(1) === '/' || peek(1) === '*')))) {
      i = atomEnd;
      exprAllowed = false;
      continue;
    }
    if (peek() === '/' && exprAllowed) {
      const re = skipRegexAt(i);
      if (re != null) {
        i = re;
        exprAllowed = false;
        continue;
      }
    }

    const c = peek();
    if (c === '{' || c === '(' || c === '[') {
      depth += 1;
      exprAllowed = true;
      i += 1;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      exprAllowed = false;
      i += 1;
      continue;
    }
    if (c === ';' || c === ',') {
      exprAllowed = true;
      i += 1;
      continue;
    }

    if (startsIdent(c)) {
      const ident = readIdentAt(i);
      if (ident.name === 'import') {
        let look = ident.end;
        while (look < src.length && /\s/.test(src[look])) look += 1;
        if (src[look] === '(' || depth === 0) {
          i = readImport(i);
          exprAllowed = false;
          continue;
        }
      }
      if (depth === 0 && ident.name === 'export') {
        i = readExport(i);
        exprAllowed = true;
        continue;
      }
      exprAllowed = REGEX_OK_KEYWORDS.has(ident.name);
      i = ident.end;
      continue;
    }

    if ('=+-*%&|^~!?<>:'.includes(c)) exprAllowed = true;
    i += 1;
  }

  let body = src;
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  }
  if (exportAssigns.length) {
    body += `\n${exportAssigns.join('\n')}\n`;
  }

  let topAwait = false;
  let depth2 = 0;
  let p = 0;
  let allow = true;
  while (p < body.length) {
    const atom = skipAtomIn(body, p);
    if (atom != null && (body[p] === '"' || body[p] === "'" || body[p] === '`' || body[p] === '/')) {
      p = atom;
      continue;
    }
    if (body[p] === '{' || body[p] === '(' || body[p] === '[') depth2 += 1;
    else if (body[p] === '}' || body[p] === ')' || body[p] === ']') depth2 -= 1;
    else if (depth2 === 0 && body.startsWith('await', p) && !identChar(body[p - 1] || '') && !identChar(body[p + 5] || '')) {
      topAwait = true;
      break;
    }
    p += 1;
  }

  return { body, asyncFactory: id === entry, deps };

  function skipAtomIn(text, pos) {
    const c = text[pos];
    const n = text[pos + 1];
    if (c === '"' || c === "'") {
      let j = pos + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) return j + 1;
        else j += 1;
      }
    }
    if (c === '`') {
      const savedSrc = src;
      const savedI = i;
      src = text;
      const end = skipTemplateAt(pos);
      src = savedSrc;
      i = savedI;
      return end;
    }
    if (c === '/' && n === '/') {
      let j = pos + 2;
      while (j < text.length && text[j] !== '\n') j += 1;
      return j;
    }
    if (c === '/' && n === '*') {
      let j = pos + 2;
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j += 1;
      return j + 2;
    }
    return null;
  }
}

const order = [];
const seen = new Set();
const cache = new Map();
function visit(id) {
  if (seen.has(id)) return;
  seen.add(id);
  const transformed = transformModule(loadSource(id), id);
  cache.set(id, transformed);
  transformed.deps.forEach(visit);
  order.push(id);
}
visit(entry);

const parts = [];
for (const id of order) {
  const transformed = cache.get(id);
  const asyncKw = transformed.asyncFactory ? 'async ' : '';
  parts.push(
    `__wgDef(${JSON.stringify(id)}, ${asyncKw}function (exports) {\n${transformed.body}\n});`,
  );
  if (transformed.asyncFactory && id !== entry) {
    console.warn('top-level await in', id);
  }
}

const runtime = `var __wgRegistry = Object.create(null);
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
`;

const boot = `
var __entry = __wgRegistry[${JSON.stringify(entry)}];
__entry.loading = true;
Promise.resolve(__entry.factory(__entry.exports)).then(function () {
  __entry.loaded = true;
}).catch(function (err) {
  console.error(err);
  var info = document.getElementById('splash-info');
  if (info) info.textContent = '\u542f\u52a8\u5931\u8d25\uff1a' + (err && err.message ? err.message : err);
});
`;

const output = `(function () {\n${runtime}\n${parts.join('\n\n')}\n${boot}\n})();\n`;
const outFile = path.join(jsDir, 'game.bundle.js');
fs.writeFileSync(outFile, output);
console.log('modules', order.length);
console.log('bytes', fs.statSync(outFile).size);
console.log(order.join('\n'));
