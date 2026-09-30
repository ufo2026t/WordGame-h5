/**
 * GPIC renderer - client-side approximation of Delphi game_pic_from_text / AAFont.
 */
import { fetchDecodedText } from './text-encoding.js';

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

export function loadGpicEffects() {
  if (!effectsPromise) {
    effectsPromise = fetchDecodedText('data/effect.ini')
      .then(parseEffectIni)
      .catch(() => ({}));
  }
  return effectsPromise;
}

export function parseEffectIni(text) {
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

export function parseGpicUrl(rawUrl) {
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

export function delphiColor(value) {
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

export async function renderGpic(rawUrl, effects, options = {}) {
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

export async function hydrateGpicElements(root, options = {}) {
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

export { TRANSPARENT_PIXEL };
