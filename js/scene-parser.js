import { sanitizeHtmlForOffline } from './offline-filter.js';
import { findElseSplit, processConditionalBranch, evaluateHtmlIfBlocks } from './scene-conditions.js';

const K_ACTION = '\u52a8\u4f5c';
const K_DESC = '\u63cf\u8ff0';
const K_CHAT = '\u5bf9\u8bdd\u8d44\u6e90';
const K_NAME = '\u540d\u79f0';
const K_AUTHOR = '\u4f5c\u8005';
const K_ATTR = '\u5c5e\u6027';
const GPIC_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function parseSceneText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const meta = {};
  const sections = { action: [], description: [], chat: [] };
  let section = null;
  let inBlock = false;
  let awaitBrace = false;
  let block = [];

  for (const line of lines) {
    if (awaitBrace) {
      if (line.trim() === '{') {
        inBlock = true;
        awaitBrace = false;
      }
      continue;
    }

    if (!inBlock) {
      const header = matchSectionHeader(line);
      if (header) {
        section = header.key;
        if (header.inline) {
          block = [header.inline];
          sections[section] = block;
          section = null;
          block = [];
        } else if (header.open) {
          inBlock = true;
          block = header.prefix ? [header.prefix] : [];
        } else {
          awaitBrace = true;
          block = header.prefix ? [header.prefix] : [];
        }
        continue;
      }

      const eq = line.indexOf('=');
      if (eq > 0 && !section) meta[line.slice(0, eq).trim()] = line.slice(eq + 1);
      continue;
    }

    if (line.trim() === '}') {
      sections[section] = block;
      inBlock = false;
      section = null;
      block = [];
      continue;
    }
    block.push(line);
  }

  return {
    id: Number(meta.id || meta.ID || 0),
    name: meta[K_NAME] || meta.name || '',
    author: meta[K_AUTHOR] || '',
    attr: Number(meta[K_ATTR] || 0),
    beforeLoad: meta['\u8f7d\u5165\u524d'] || '',
    afterLoad: meta['\u8f7d\u5165\u540e'] || '',
    exitAfter: meta['\u9000\u51fa\u540e'] || '',
    actions: parseActionMap(sections.action),
    html: sections.description.join('\n'),
    chatScript: sections.chat.join('\n'),
  };
}

function matchSectionHeader(line) {
  const headers = [
    { key: 'action', label: K_ACTION },
    { key: 'description', label: K_DESC },
    { key: 'chat', label: K_CHAT },
  ];

  for (const { key, label } of headers) {
    if (!line.startsWith(`${label}=`)) continue;
    const rest = line.slice(label.length + 1);
    const trimmed = rest.trimEnd();
    if (trimmed.endsWith('{')) {
      const prefix = trimmed.slice(0, -1).trim();
      return { key, open: true, prefix: prefix || null };
    }
    if (rest.trim() === '') return { key, open: false, prefix: null };
    return { key, inline: rest };
  }
  return null;
}

function parseActionMap(lines) {
  const map = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';;')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

const sceneMetaCache = new Map();

export async function loadScene(id) {
  const res = await fetch(`data/scenes/${id}.txt`);
  if (!res.ok) throw new Error(`\u573a\u666f ${id} \u672a\u627e\u5230\u6216\u65e0\u6cd5\u52a0\u8f7d`);
  const text = await res.text();
  const scene = parseSceneText(text);
  sceneMetaCache.set(Number(id), { attr: scene.attr, name: scene.name });
  return scene;
}

/** Lightweight metadata for travel rules (attr bitfield). */
export async function peekSceneMeta(id) {
  const key = Number(id);
  if (sceneMetaCache.has(key)) return sceneMetaCache.get(key);
  const scene = await loadScene(key);
  return { attr: scene.attr, name: scene.name };
}

function stripSceneComments(html) {
  return String(html || '').replace(/^[ \t]*;;[^\n]*/gm, '');
}

function rewriteLocalImgSrc(tag) {
  const srcMatch = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
  if (!srcMatch) return tag;
  const src = srcMatch[1];
  if (src.startsWith('gpic:') || src.startsWith('data:')) return tag;
  if (/^https?:\/\//i.test(src) || /^mailto:/i.test(src)) return tag;
  if (src.startsWith('data/img/') || src.startsWith('data/gif/') || src.startsWith('data/music/')) return tag;

  const normalized = src.replace(/\\/g, '/').replace(/^\.\//, '');
  let next = src;
  if (normalized.startsWith('file://') || normalized.startsWith('file:/')) {
    const local = normalized.replace(/^file:\/+/, '').replace(/^\.\/+/, '').replace(/^img[/\\]/i, '');
    next = `data/img/${local.split(/[/\\]/).pop()}`;
  } else if (normalized.startsWith('gif/') || normalized.startsWith('img/')) {
    next = `data/${normalized}`;
  } else if (!normalized.startsWith('data/') && !normalized.startsWith('http')) {
    const folder = /\.gif$/i.test(normalized) ? 'gif' : 'img';
    next = `data/${folder}/${normalized.split('/').pop()}`;
  } else {
    return tag;
  }
  return tag.replace(srcMatch[0], `src="${next}"`);
}

export function preprocessSceneHtml(html, ctx) {
  let out = stripSceneComments(html);

  out = out.replace(/charset\s*=\s*gb2312/gi, 'charset=utf-8');
  out = out.replace(/charset\s*=\s*gbk/gi, 'charset=utf-8');
  out = out.replace(/\bcolor\s*=\s*#"/gi, 'color="#');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');

  const replaceTemplate = (body) => {
    const trimmed = body.trim();
    const conditional = evaluateConditionalBlock(trimmed, ctx);
    if (conditional !== null) return conditional;
    return evaluateTemplate(trimmed, ctx);
  };
  out = replaceInnermostTemplates(out, replaceTemplate);
  out = expandStringCalls(out, ctx);
  out = evaluateHtmlIfBlocks(out, (expr) => evalHtmlCondition(expr, ctx));

  out = out.replace(/\$apppath\$img\\/gi, 'data/img/');
  out = out.replace(/\$apppath\$img\//gi, 'data/img/');
  out = out.replace(/\$apppath\$gif\\/gi, 'data/gif/');
  out = out.replace(/\$apppath\$gif\//gi, 'data/gif/');
  out = out.replace(/\$apppath\$music\\/gi, 'data/music/');
  out = out.replace(/\$apppath\$music\//gi, 'data/music/');
  out = out.replace(/\$apppath\$dat\\/gi, 'data/upp/dat/');
  out = out.replace(/\$apppath\$dat\//gi, 'data/upp/dat/');
  out = out.replace(/\$apppath\$/gi, '');

  out = out.replace(/<body([^>]*)style="([^"]*)background:url\(\s*gpic:\/\/([^)]+)\)([^"]*)"/gi, (_, attrs, pre, gpicBody, post) => {
    const url = `gpic://${gpicBody}`;
    const style = `${pre}background-color:transparent;${post}`.replace(/;;+/g, ';');
    return `<body${attrs}style="${style}" data-gpic-bg="${encodeURIComponent(url)}"`;
  });

  out = out.replace(/<img(\s[^>]*?)src="(gpic:\/\/[^"]+)"([^>]*)>/gi, (full, before, src, after) => {
    const attrs = `${before}${after}`.replace(/\sclass="[^"]*"/gi, '').trim();
    return `<img ${attrs} class="gpic-img gpic-loading" data-gpic="${encodeURIComponent(src)}" src="${GPIC_PLACEHOLDER}" alt="">`;
  });

  out = out.replace(/<img\b[^>]*>/gi, (tag) => rewriteLocalImgSrc(tag));

  out = out.replace(/<a\b([^>]*?)href="([^"]*?)"([^>]*)>/gi, (full, before, href, after) => {
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      const textMatch = full.match(/>([\s\S]*?)<\/a>/i);
      return textMatch ? textMatch[1] : '';
    }
    if (href === '#' || /\bdata-game-link=/i.test(`${before}${after}`)) return full;
    return `<a${before}href="#" data-game-link="${encodeURIComponent(href)}"${after}>`;
  });

  out = out.replace(/<area\b([^>]*?)href="([^"]*?)"([^>]*)>/gi, (full, before, href, after) => {
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return full;
    if (href === '#' || /\bdata-game-link=/i.test(`${before}${after}`)) return full;
    return `<area${before}href="#" data-game-link="${encodeURIComponent(href)}"${after}>`;
  });

  out = out.replace(/onMouseOver=location\.href="([^"]+)"/gi, (_, href) => {
    return `data-game-hover="${encodeURIComponent(href)}"`;
  });

  out = out.replace(/<body([^>]*)>/gi, (_, attrs) => `<div class="scene-body"${attrs}>`);
  out = out.replace(/<\/body>/gi, '</div>');
  out = out.replace(/<\/?(?:html|head)\b[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*revealTrans[^>]*>/gi, '');
  out = out.replace(/<bgsound\b([^>]*?)src="([^"]*)"([^>]*)>/gi, (_, before, src, after) => {
    const loop = /loop\s*=\s*"-1"/i.test(`${before}${after}`) ? ' loop' : '';
    const normalized = src.replace(/\\/g, '/');
    return `<audio class="scene-bgm" src="${normalized}"${loop} autoplay preload="auto"></audio>`;
  });

  out = sanitizeHtmlForOffline(out);
  return out;
}

function evalHtmlCondition(expr, ctx) {
  if (ctx.evalCondition) return !!ctx.evalCondition(expr);
  return evalSceneCondition(expr, ctx);
}

function replaceInnermostTemplates(html, replacer) {
  let out = String(html || '');
  const re = /<:((?:(?!<:)[\s\S])*?):>/;
  for (let i = 0; i < 400; i += 1) {
    const next = out.replace(re, (_, body) => replacer(body.trim()));
    if (next === out) break;
    out = next;
  }
  return out;
}

function evaluateConditionalBlock(body, ctx) {
  if (/^if\s+/i.test(body)) {
    return processConditionalBranch(body, ctx);
  }

  const runOnly = body.match(/^run\s+(.+)$/i);
  if (runOnly) {
    ctx.queueScript?.(runOnly[1].trim());
    return '';
  }

  const resMatch = body.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (resMatch) {
    const id = Number(resMatch[1]);
    const rest = resMatch[2];
    const elseIdx = findElseSplit(rest);
    const hit = ctx.resEvents[id] ? true : false;
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

  const eventMatch = body.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (eventMatch) {
    const id = Number(eventMatch[1]);
    const rest = eventMatch[2];
    const elseIdx = findElseSplit(rest);
    const hit = evalHtmlCondition(`game_check_scene_event(${id})`, ctx);
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

    const chanceMatch = body.match(/^game_random_chance\s*\(\s*(\d+)\s*\)\s*([\s\S]*)$/i);
  if (chanceMatch) {
    const rest = chanceMatch[2];
    const hit = evalHtmlCondition(`game_random_chance(${chanceMatch[1]})`, ctx);
    const elseIdx = findElseSplit(rest);
    if (elseIdx >= 0) {
      const truePart = rest.slice(0, elseIdx).trim();
      const falsePart = rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? rest.trim() : '', ctx);
  }

  const lead = splitLeadingGameCall(body);
  if (lead && lead.rest.trim() && !/^(string|exeing)\b/i.test(lead.rest.trim())) {
    const elseIdx = findElseSplit(lead.rest);
    const hit = evalHtmlCondition(lead.expr, ctx);
    if (elseIdx >= 0) {
      const truePart = lead.rest.slice(0, elseIdx).trim();
      const falsePart = lead.rest.slice(elseIdx + 4).trim();
      return processConditionalBranch(hit ? truePart : falsePart, ctx);
    }
    return processConditionalBranch(hit ? lead.rest.trim() : '', ctx);
  }

  return null;
}

function splitLeadingGameCall(text) {
  const src = String(text || '');
  const notPrefix = src.match(/^(not\s+)/i);
  const start = notPrefix ? notPrefix[0].length : 0;
  const m = src.slice(start).match(/^(game_\w+)\s*\(/i);
  if (!m) return null;
  let depth = 0;
  const open = start + m[0].length - 1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { expr: src.slice(0, i + 1).trim(), rest: src.slice(i + 1) };
      }
    }
  }
  return null;
}

function expandStringCalls(html, ctx) {
  if (!ctx?.evalTemplate) return html;
  let out = '';
  let rest = String(html || '');
  while (rest.length) {
    const idx = rest.search(/string\s+game_/i);
    if (idx < 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, idx);
    const chunk = rest.slice(idx);
    const afterKw = chunk.replace(/^string\s+/i, '');
    const callLen = leadingGameCallLength(afterKw);
    if (callLen < 0) {
      out += chunk.slice(0, 7);
      rest = chunk.slice(7);
      continue;
    }
    out += String(ctx.evalTemplate(chunk.slice(0, chunk.length - afterKw.length + callLen)) ?? '');
    rest = afterKw.slice(callLen);
  }
  return out;
}

function leadingGameCallLength(text) {
  const m = String(text || '').match(/^(game_\w+)\s*\(/i);
  if (!m) return -1;
  let depth = 0;
  for (let i = m[0].length - 1; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function evalSceneCondition(expr, ctx) {
  if (ctx.evalCondition) return ctx.evalCondition(expr);
  let m;
  if ((m = expr.match(/^not\s+game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !ctx.sceneEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !!ctx.sceneEvents[Number(m[1])];
  }
  if ((m = expr.match(/^not\s+game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !ctx.resEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return !!ctx.resEvents[Number(m[1])];
  }
  if ((m = expr.match(/^game_random_chance\s*\(\s*(\d+)\s*\)$/i))) {
    return Math.random() < 1 / Number(m[1]);
  }
  return false;
}

function decodeGpicLabel(url) {
  const m = url.match(/,([^,]+),AT/i);
  if (m) return m[1];
  const tail = url.split(',').pop();
  return tail ? tail.replace(/\/\d+\.bmp/i, '') : '';
}

function evaluateTemplate(expr, ctx) {
  if (ctx.evalTemplate) return ctx.evalTemplate(expr);
  let m;
  if ((m = expr.match(/game_save_count\s*\(\s*0\s*\)/i))) {
    return ctx.saveCount > 0 ? String(ctx.saveCount) : '0';
  }
  if (/game_true\s*\(\s*1\s*\)/i.test(expr)) return 'true';
  if ((m = expr.match(/game_check_scene_event\s*\(\s*(\d+)\s*\)/i))) {
    return ctx.sceneEvents[Number(m[1])] ? '' : 'hidden';
  }
  return '';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeGameLinks(root) {
  if (!root) return;
  root.querySelectorAll('a[href]:not([data-game-link]), area[href]:not([data-game-link])').forEach((el) => {
    const href = el.getAttribute('href');
    if (!href || href === '#' || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return;
    el.setAttribute('href', '#');
    el.setAttribute('data-game-link', encodeURIComponent(href));
  });
}

export function wireGameLinks(root, handler) {
  normalizeGameLinks(root);
  if (!handler) return;
  root.querySelectorAll('[data-game-link]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handler(decodeURIComponent(el.getAttribute('data-game-link')));
    });
  });
}
