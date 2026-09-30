/** Labels for legacy Simplified Chinese text (Delphi ANSI / GBK). */
const GB_LABELS = ['gb18030', 'gbk', 'windows-936'];

/**
 * Fetch a text resource and decode as UTF-8 or GBK/ANSI automatically.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchDecodedText(url) {
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
export function decodeTextBytes(buffer) {
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

export function detectTextEncodingLabel(buffer) {
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
