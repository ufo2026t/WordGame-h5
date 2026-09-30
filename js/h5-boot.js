/**
 * HTML5 offline boot.
 * On file:// the browser blocks fetch() and ES modules, so text and canvas
 * images are served from the packs loaded before this script.
 * Over http(s) the original files are used, and the packs are a fallback.
 */
(function () {
  const textPack = window.__WG_TEXT__ || {};
  const binPack = window.__WG_BIN__ || {};
  const textIndex = indexKeys(textPack);
  const binIndex = indexKeys(binPack);
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const isFile = location.protocol === 'file:';

  function indexKeys(pack) {
    const map = Object.create(null);
    Object.keys(pack).forEach((key) => {
      map[key.toLowerCase()] = key;
    });
    return map;
  }

  function normalize(url) {
    let s = String(url || '');
    try {
      s = decodeURIComponent(s);
    } catch (err) {
      /* keep raw */
    }
    s = s.split('#')[0].split('?')[0].replace(/\\/g, '/');
    const marker = s.toLowerCase().lastIndexOf('/data/');
    if (marker >= 0) s = s.slice(marker + 1);
    if (s.startsWith('./')) s = s.slice(2);
    if (s.startsWith('/')) s = s.slice(1);
    return s;
  }

  function lookup(pack, index, url) {
    const key = normalize(url);
    if (Object.prototype.hasOwnProperty.call(pack, key)) return pack[key];
    const real = index[key.toLowerCase()];
    if (real && Object.prototype.hasOwnProperty.call(pack, real)) return pack[real];
    return undefined;
  }

  function contentType(key) {
    const lower = key.toLowerCase();
    if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
    if (lower.endsWith('.js')) return 'text/javascript; charset=utf-8';
    return 'text/plain; charset=utf-8';
  }

  function packedResponse(body, key) {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentType(key) },
    });
  }

  window.__WG_RESOLVE_URL__ = function (url) {
    if (!isFile) return url;
    const packed = lookup(binPack, binIndex, url);
    return packed || url;
  };

  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const key = normalize(raw);
    const packed = lookup(textPack, textIndex, raw);

    if (isFile) {
      if (packed != null) return Promise.resolve(packedResponse(packed, key));
      return Promise.resolve(new Response('Not found: ' + key, { status: 404, statusText: 'Not Found' }));
    }

    if (!nativeFetch) {
      if (packed != null) return Promise.resolve(packedResponse(packed, key));
      return Promise.reject(new Error('fetch unavailable'));
    }

    return nativeFetch(input, init).then((res) => {
      if (!res.ok && packed != null) return packedResponse(packed, key);
      return res;
    }).catch((err) => {
      if (packed != null) return packedResponse(packed, key);
      throw err;
    });
  };
})();
