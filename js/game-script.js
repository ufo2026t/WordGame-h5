import {
  STAT,
  ensureParty,
  findRoleIndex,
  readValues,
  writeValues,
  syncPlayerFromRole,
  syncRoleFromPlayer,
  getRoleCount,
  getRoleH,
  getRoleDisplayName,
  getGoodsTypeIcon,
  gameBaseRandom,
  gameBaseRandomZero,
  gameRandomChance,
  parseEventIdList,
  sceneEventValue,
  resEventValue,
  createRoleFromTemplate,
} from './game-runtime.js';
import { getBiaoYueduHtml, getIncludeCache } from './game-config.js';
import { preprocessSceneHtml } from './scene-parser.js';
import { getGoodsInfo } from './goods-data.js';

export function parseGameArgs(raw) {
  const args = [];
  let cur = '';
  let quote = '';
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inQuote) {
      cur += ch;
      if (ch === quote) inQuote = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = true;
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) args.push(parseGameArg(cur.trim()));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(parseGameArg(cur.trim()));
  return args;
}

function parseGameArg(token) {
  if (/^-?\d+$/.test(token)) return Number(token);
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1);
  }
  return token;
}

export function parseGameCall(expr) {
  const trimmed = expr.trim();
  const consumed = consumeGameCall(trimmed);
  return consumed ? consumed.call : null;
}

function consumeGameCall(text) {
  const m = String(text || '').match(/^\s*(game_\w+)\s*\(/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  let depth = 0;
  let inQuote = false;
  let quote = '';
  const start = m[0].length - 1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === quote) inQuote = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = true;
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          call: { name, args: parseGameArgs(text.slice(start + 1, i)) },
          length: i + 1,
        };
      }
    }
  }
  return null;
}

export function evalGameExpr(api, token) {
  const t = String(token ?? '').trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const plus = t.match(/^(game_\w+\([\s\S]*\))\s*\+\s*(-?\d+)$/i);
  if (plus) {
    const call = parseGameCall(plus[1]);
    if (call) return Number(api.invokeGame(call.name, call.args) || 0) + Number(plus[2]);
  }
  const call = parseGameCall(t);
  if (call) return Number(api.invokeGame(call.name, call.args) || 0);
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

function resolveHandlerArg(api, arg) {
  if (typeof arg === 'string' && /^game_\w+\s*\(/i.test(arg)) {
    const nested = parseGameCall(arg);
    if (nested) {
      return invokeHandlerSync(api, nested.name, nested.args.map((item) => resolveHandlerArg(api, item)));
    }
  }
  return arg;
}

function invokeHandlerSync(api, name, args) {
  const fn = api.handlers?.[name];
  if (!fn) return 0;
  const resolved = (args || []).map((arg) => resolveHandlerArg(api, arg));
  const result = fn(...resolved);
  if (result && typeof result.then === 'function') return 0;
  return result;
}

function compareNumbers(left, op, right) {
  const a = Number(left);
  const b = Number(right);
  if (op === '=' || op === '==') return a === b;
  if (op === '!=' || op === '<>') return a !== b;
  if (op === '>=') return a >= b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  return false;
}

export function evalConditionSync(api, expr) {
  const cleaned = String(expr || '').trim();
  if (!cleaned) return false;
  if (/^-?\d+$/.test(cleaned)) return Number(cleaned) !== 0;

  if (/\band\b/i.test(cleaned)) {
    return cleaned.split(/\band\b/i).every((part) => evalConditionSync(api, part.trim()));
  }
  if (/\bor\b/i.test(cleaned)) {
    return cleaned.split(/\bor\b/i).some((part) => evalConditionSync(api, part.trim()));
  }

  let m;
  if ((m = cleaned.match(/^not\s+(.+)$/i))) {
    return !evalConditionSync(api, m[1].trim());
  }

  if ((m = cleaned.match(/^(game_\w+\([\s\S]*\))\s*(===|==|=|!=|<>|>=|<=|>|<)\s*(-?\d+)\s*$/i))) {
    const call = parseGameCall(m[1]);
    if (!call) return false;
    return compareNumbers(invokeHandlerSync(api, call.name, call.args), m[2], m[3]);
  }

  const call = parseGameCall(cleaned);
  if (call) return !!invokeHandlerSync(api, call.name, call.args);

  if ((m = cleaned.match(/^game_check_scene_event\s*\(\s*(\d+)\s*\)$/i))) {
    return sceneEventValue(api.state, Number(m[1])) !== 0;
  }
  if ((m = cleaned.match(/^game_check_res_event\s*\(\s*(\d+)\s*\)$/i))) {
    return resEventValue(api.state, Number(m[1])) !== 0;
  }

  return false;
}

export function evalCondition(api, expr) {
  return evalConditionSync(api, expr);
}

export function evalTemplate(api, expr, ctx) {
  let rest = String(expr || '').trim();
  if (!rest) return '';

  let out = '';
  while (rest.length) {
    let m = rest.match(/^game_true\s*\(\s*(\d+)\s*\)/i);
    if (m) {
      if (Number(m[1]) === 0) return '';
      rest = rest.slice(m[0].length);
      continue;
    }

    m = rest.match(/^exeing\s+game_include_str\s*\(\s*'([^']*)'\s*\)/i);
    if (m) {
      out += api.renderInclude(m[1], ctx);
      rest = rest.slice(m[0].length);
      continue;
    }

    if (/^string\s+/i.test(rest)) {
      const after = rest.replace(/^string\s+/i, '');
      const consumed = consumeGameCall(after);
      if (consumed) {
        out += String(api.invokeGameString(consumed.call.name, consumed.call.args, ctx) ?? '');
        rest = rest.slice(rest.length - after.length + consumed.length);
        continue;
      }
    }

    const consumed = consumeGameCall(rest);
    if (consumed) {
      out += String(api.invokeGameString(consumed.call.name, consumed.call.args, ctx) ?? '');
      rest = rest.slice(consumed.length);
      continue;
    }

    const next = rest.search(/(?:game_true\s*\(|exeing\s+game_include_str|string\s+game_|game_\w+\()/i);
    if (next <= 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, next);
    rest = rest.slice(next);
  }
  return out;
}

export function bindGameHandlers(api) {
  const handlers = {
    game_page: (id) => api.game_page(id),
    game_show_scene: (id) => api.game_show_scene(id),
    game_pop: (n) => api.game_pop(n),
    game_pop_a: (n) => api.game_pop_a(n),
    game_pop_fight: (a, b) => api.game_pop_fight(a, b),
    game_pop_fight_a: (a, b) => api.game_pop_fight(a, b),
    game_pop_dig: (n) => api.game_pop_dig(n),
    game_pop_game: (a, b) => api.game_pop_game(a, b),
    game_start_now: () => api.game_start_now(),
    game_save: (mode) => api.game_save(mode),
    game_save_panel: () => api.game_save_panel(),
    game_goto_home: () => api.game_goto_home(),
    game_goto_oldpage: () => api.game_goto_oldpage(),
    game_reload_direct: () => api.game_reload_direct(),
    game_reload: () => api.game_reload_direct(),
    game_chat_cleans: () => api.game_chat_cleans(),
    game_chat_cleans2: () => api.game_chat_cleans2(),
    game_talk_stop: () => api.game_talk_stop(),
    game_chat: (msg) => api.game_chat(msg),
    game_infobox: (msg) => api.game_infobox(msg),
    game_add_message: (msg) => api.game_add_message(msg),
    game_add_scene_event: (id) => api.game_add_scene_event(id),
    game_del_scene_event: (id) => api.game_del_scene_event(id),
    game_check_scene_event: (id) => api.game_check_scene_event(id),
    game_inc_scene_event: (id, v) => api.game_inc_scene_event(id, v),
    game_dec_scene_event: (id, v) => api.game_dec_scene_event(id, v),
    game_read_scene_integer: (id) => api.game_read_scene_integer(id),
    game_write_scene_integer: (id, v) => api.game_write_scene_integer(id, v),
    game_add_res_event: (id) => api.game_add_res_event(id),
    game_del_res_event: (id) => api.game_del_res_event(id),
    game_check_res_event: (id) => api.game_check_res_event(id),
    game_not_res_event: (id) => api.game_not_res_event(id),
    game_not_scene_event: (id) => api.game_not_scene_event(id),
    game_check_res_event_and: (s) => api.game_check_res_event_and(s),
    game_check_res_event_or: (s) => api.game_check_res_event_or(s),
    game_not_res_event_and: (s) => api.game_not_res_event_and(s),
    game_not_res_event_or: (s) => api.game_not_res_event_or(s),
    game_check_scene_event_and: (s) => api.game_check_scene_event_and(s),
    game_check_scene_event_or: (s) => api.game_check_scene_event_or(s),
    game_not_scene_event_and: (s) => api.game_not_scene_event_and(s),
    game_not_scene_event_or: (s) => api.game_not_scene_event_or(s),
    game_goods_change_n: (name, delta) => api.game_goods_change_n(name, delta),
    game_reload_chatlist: () => api.game_reload_chatlist(),
    game_write_name: (name) => api.game_write_name(name),
    game_add_task: (id) => api.game_add_task(id),
    game_comp_task: (id) => api.game_comp_task(id),
    game_trade: (id, flag) => api.game_trade(id, flag),
    game_accouter1_wid: () => api.game_accouter1_wid(),
    game_check_money: (v) => (api.game_check_money(v) ? 1 : 0),
    game_change_money: (v) => api.game_change_money(v),
    game_question: (text) => (api.game_question(text) ? 1 : 0),
    game_change_sex: (name, sex) => api.game_change_sex(name, sex),
    game_npc_talk: (name) => api.game_npc_talk(name),
    game_spk_string: (text) => api.game_spk_string(text),
    game_random_chance: (n) => (gameRandomChance(api.state, n) ? 1 : 0),
    game_random_chance_2: (n) => gameBaseRandomZero(n),
    game_random_chance_at_sleep: (n) => (gameRandomChance(api.state, n) ? 1 : 0),
    game_sex_from_id: (id) => api.game_sex_from_id(id),
    game_role_count: (n) => (getRoleCount(api.state) >= n ? 1 : 0),
    game_check_goods_nmb: (name, n) => ((api.state.player.goods[name] || 0) >= n ? 1 : 0),
    game_get_goods_count: (name) => api.state.player.goods[name] || 0,
    game_grade: (name, g) => api.game_grade(name, g),
    game_check_role_values: (name, i, v) => (api.game_check_role_values(name, i, v) ? 1 : 0),
    game_check_role_values_byid: (id, statId, value) => api.game_check_role_values_byid(id, statId, value),
    game_id_is_name: (id, name) => api.game_id_is_name(id, name),
    game_can_fly: (i) => api.game_can_fly(i),
    game_read_temp: (id) => api.game_read_temp(id),
    game_write_temp: (id, v) => api.game_write_temp(id, v),
    game_clear_temp: () => api.game_clear_temp(),
    game_check_temp: (id, v) => (api.game_check_temp(id, v) ? 1 : 0),
    game_read_temp_string: (id) => api.game_read_temp_string(id),
    game_write_temp_string: (id, v) => api.game_write_temp_string(id, v),
    game_get_pscene_id: (i) => api.game_get_pscene_id(i),
    game_get_pscene_id_s: (i) => String(api.game_get_pscene_id(i)),
    game_get_newname_at_id: (id) => api.game_get_newname_at_id(id),
    game_get_oldname_at_id: (id) => api.game_get_oldname_at_id(id),
    game_newname_from_oldname: (name) => api.game_newname_from_oldname(name),
    game_role_is_exist: (name) => (findRoleIndex(api.state, name) >= 0 ? 1 : 0),
    game_add_friend: (name, mode) => api.game_add_friend(name, mode),
    game_del_friend: (name, showMsg) => api.game_del_friend(name, showMsg),
    game_attribute_change: (p, id, v) => api.game_attribute_change(p, id, v),
    game_role_value_half: (id) => api.game_role_value_half(id),
    game_role_only_show: (name) => api.game_role_only_show(name),
    game_role_reshow: () => api.game_role_reshow(),
    game_set_role_0_hide: (name, x) => api.game_set_role_0_hide(name, x),
    game_inner_html: (id, html) => api.game_inner_html(id, html),
    game_biao_html: (flag) => api.game_biao_html(flag),
    game_true: (v) => (v ? 1 : 0),
    game_inttostr: (v) => String(v),
    game_save_count: () => api.game_save_count(),
    game_at_net: () => 0,
    game_id_exist: (id) => (id <= getRoleCount(api.state) ? 1 : 0),
    game_get_role_suxing: (role, stat) => readValues(api.state, role <= 0 ? 0 : role - 1, stat),
    game_bet: (id, flag) => api.game_bet(id, flag),
    game_over: () => api.game_over(),
    game_kill_game_time: () => api.game_kill_game_time(),
    game_set_game_time: (t, page) => api.game_set_game_time(t, page),
    game_delay: (ms) => api.game_delay(ms),
    game_can_stop_chat: (v) => api.game_can_stop_chat(v),
    game_bubble: (n) => api.game_bubble(n),
    game_wuziqi: (n) => api.game_wuziqi(n),
    game_weather: (i) => api.game_weather(i),
    game_allow_gohome: (v) => api.game_allow_gohome(v),
    game_write_home_id: () => api.game_write_home_id(),
    game_get_money: () => readValues(api.state, 0, STAT.money),
    game_get_read_txt: (i) => api.game_get_read_txt(i),
    game_include_str: (file) => api.game_include_str(file),
    game_res_goods: (i, sl, name) => api.game_res_goods(i, sl, name),
    game_role_sex_count: (sex) => api.game_role_sex_count(sex),
    game_role_all_mtl: (p) => api.game_role_all_mtl(p),
    game_id_from_oldname: (name) => api.game_id_from_oldname(name),
    game_get_fm_1: (sex) => api.game_get_fm_1(sex),
    game_sex_from_name: (name) => api.game_sex_from_name(name),
    game_read_factor: () => api.game_read_factor(),
    game_write_factor: (v) => api.game_write_factor(v),
    game_chat_spk_add: (s) => api.game_chat_spk_add(s),
    game_show_set: () => api.game_show_set(),
    game_clear_money: () => api.game_clear_money(),
    game_not_rename: (id) => api.game_not_rename(id),
    game_checkname_abc: (name) => api.game_checkname_abc(name),
    game_time_exe: (ms, script) => api.game_time_exe(ms, script),
    game_run_off_no: (i) => api.game_run_off_no(i),
    game_integer_comp: (a, op, b) => api.game_integer_comp(a, op, b),
    game_del_friend_byid: (a, b) => api.game_del_friend_byid(a, b),
    game_rename: (name) => api.game_rename(name),
    game_rename_byid: (id, name) => api.game_rename_byid(id, name),
    game_get_accoutre: (role, slot) => api.game_get_accoutre(role, slot),
    game_show_logon: () => 0,
    game_show_dwjh: () => 0,
  };

  api.handlers = handlers;
  api.invokeGame = async (name, args) => {
    const fn = handlers[name];
    if (!fn) return 0;
    const resolved = (args || []).map((arg) => resolveHandlerArg(api, arg));
    return fn(...resolved);
  };
  api.invokeGameString = (name, args, ctx) => {
    const resolved = (args || []).map((arg) => {
      if (typeof arg === 'string' && /^game_\w+\s*\(/i.test(arg)) {
        const nested = parseGameCall(arg);
        if (nested) return api.invokeGameString(nested.name, nested.args, ctx);
      }
      return arg;
    });
    if (name === 'game_res_goods') return api.game_res_goods_html(resolved[0], resolved[1], resolved[2], ctx);
    if (name === 'game_get_read_txt') return api.game_get_read_txt(resolved[0]);
    if (name === 'game_include_str') return api.game_include_str(resolved[0]);
    const fn = handlers[name];
    if (!fn) return '';
    const result = fn(...resolved);
    if (result && typeof result.then === 'function') return '';
    return result ?? '';
  };
}

export function buildResGoodsHtml(api, i, sl, name, ctx) {
  const state = api.state;
  const getPic = () => `<img src="data/img/${getGoodsTypeIcon(name)}" border="0">`;

  if (i > 0 && i <= 100) {
    if (gameRandomChance(state, i)) {
      const spanId = i + Math.floor(Math.random() * 100);
      return `<span id="bo_${spanId}"><a href="game_goods_change_n('${name}',${sl});game_chat('\u6361\u5230${name}${sl}');game_inner_html(${spanId},' ')" title="\u6361\u8d77">${getPic()}</a></span>`;
    }
    return ' ';
  }

  let eventId = i;
  if (eventId <= 0) eventId = api.game_get_pscene_id(eventId);
  if (resEventValue(state, eventId) !== 0) return ' ';

  return `<span id="bo_${eventId}"><a href="game_goods_change_n('${name}',${sl});game_chat('\u6361\u5230${name}${sl}');game_add_res_event(${eventId});game_inner_html(${eventId},' ')" title="\u6361\u8d77">${getPic()}</a></span>`;
}

export function renderIncludeHtml(api, file, ctx) {
  const base = String(file || '').replace(/\.upp$/i, '').replace(/^dat[/\\]/i, '');
  const text = getIncludeCache(base) || (base === 'biao_yuedu' ? getBiaoYueduHtml() : '');
  if (!text) return '';
  return preprocessSceneHtml(text, ctx);
}
