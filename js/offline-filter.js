/**
 * Strip online-only links, iframes, and external embeds for the offline remake.
 */

const OFFLINE_MSG = '\u672c\u7248\u4e3a\u5355\u673a\u7248\uff0c\u4e0d\u652f\u6301\u8054\u7f51\u529f\u80fd\u3002';

export function isOnlineSceneId(id) {
  return false;
}

export function isExternalUrl(href) {
  return /^https?:\/\//i.test(String(href || '').trim());
}

export function sanitizeHtmlForOffline(html) {
  if (!html) return html;
  let out = html;

  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<iframe\b[^>]*>/gi, '');
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<form\b[\s\S]*?<\/form>/gi, '');

  out = out.replace(/<td\b[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*"https?:\/\/[^"]*"[\s\S]*?<\/td>/gi, '');
  out = out.replace(/<a\b[^>]*href\s*=\s*'https?:\/\/[^']*'[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  out = out.replace(/<a\b[^>]*href\s*=\s*"https?:\/\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  out = out.replace(/<img\b[^>]*\ssrc\s*=\s*"https?:\/\/[^"]*"[^>]*>/gi, '');
  out = out.replace(/<img\b[^>]*\ssrc\s*=\s*'https?:\/\/[^']*'[^>]*>/gi, '');

  out = out.replace(/https?:\/\/(?:www\.)?finer2\.com\S*/gi, '');
  out = out.replace(/https?:\/\/word\.5d6d\.com\S*/gi, '');

  out = out.replace(/<CENTER>[\s\S]*?扫描二维码[\s\S]*?<\/CENTER>/gi, '');
  out = out.replace(/通过做了武林盟主扫描二维码分享到朋友圈群。/g, '');
  out = out.replace(/扫描二维码分享到朋友圈群。/g, '');

  out = out.replace(/\s*target\s*=\s*"_blank"/gi, '');
  return out;
}

export function sanitizeChatForOffline(html) {
  return sanitizeHtmlForOffline(html);
}

export { OFFLINE_MSG };
