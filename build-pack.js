/**
 * Pack text and canvas images so the game can open from index.html (file://).
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dataDir = path.join(root, 'data');
const jsDir = path.join(root, 'js');

const TEXT_EXT = new Set(['.txt', '.json', '.ini', '.html', '.htm', '.xml', '.csv', '.upp']);
const BIN_EXT = new Set(['.gif', '.bmp', '.jpg', '.jpeg', '.png', '.webp']);
const MIME = {
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const GB_LABELS = ['gb18030', 'gbk', 'windows-936'];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function readBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', body: bytes.subarray(3) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', body: bytes.subarray(2) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', body: bytes.subarray(2) };
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
      /* next */
    }
  }
  for (const label of GB_LABELS) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* next */
    }
  }
  return null;
}

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

function decodeFile(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length) return '';
  const bom = readBom(bytes);
  if (bom) return decodeWithLabel(bom.body, bom.encoding);
  if (isValidUtf8(bytes)) {
    const utf8Text = decodeWithLabel(bytes, 'utf-8');
    const gbText = tryDecodeGb(bytes);
    if (gbText && shouldPreferGbOverUtf8(utf8Text, gbText)) return gbText;
    return utf8Text;
  }
  const gbText = tryDecodeGb(bytes);
  if (gbText) return gbText;
  return decodeWithLabel(bytes, 'utf-8');
}

function relPath(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const text = {};
const bin = {};
let textCount = 0;
let binCount = 0;

for (const file of walk(dataDir)) {
  const ext = path.extname(file).toLowerCase();
  const rel = relPath(file);
  if (TEXT_EXT.has(ext)) {
    text[rel] = decodeFile(fs.readFileSync(file));
    textCount += 1;
  } else if (BIN_EXT.has(ext) && rel.startsWith('data/img/')) {
    const mime = MIME[ext] || 'application/octet-stream';
    const b64 = fs.readFileSync(file).toString('base64');
    bin[rel] = `data:${mime};base64,${b64}`;
    binCount += 1;
  }
}

fs.writeFileSync(path.join(jsDir, 'h5-text-pack.js'), `window.__WG_TEXT__=${JSON.stringify(text)};\n`);
fs.writeFileSync(path.join(jsDir, 'h5-bin-pack.js'), `window.__WG_BIN__=${JSON.stringify(bin)};\n`);

const textSize = fs.statSync(path.join(jsDir, 'h5-text-pack.js')).size;
const binSize = fs.statSync(path.join(jsDir, 'h5-bin-pack.js')).size;
console.log(`text files: ${textCount} (${(textSize / 1024 / 1024).toFixed(2)} MB)`);
console.log(`img files: ${binCount} (${(binSize / 1024 / 1024).toFixed(2)} MB)`);
console.log('sample scene', (text['data/scenes/10000.txt'] || '').includes('开始游戏'));
console.log('sample word', (text['data/lib/基础单词1500个.ini'] || '').includes('宇航员'));
