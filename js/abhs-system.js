/** Ebbinghaus bucket thresholds (seconds), matching Unit_pop.pas get_abhs_value. */
const ABHS_BUCKETS = [
  { key: 'b5', next: 'b30', wait: 300 },
  { key: 'b30', next: 'b240', wait: 1500 },
  { key: 'b240', next: 'd1', wait: 5400 },
  { key: 'd1', next: 'd2', wait: 72000 },
  { key: 'd2', next: 'd4', wait: 86400 },
  { key: 'd4', next: 'd7', wait: 172800 },
  { key: 'd7', next: 'd15', wait: 259200 },
  { key: 'd15', next: null, wait: 691200 },
];

export function createAbhsState() {
  return {
    b5: [],
    b30: [],
    b240: [],
    d1: [],
    d2: [],
    d4: [],
    d7: [],
    d15: [],
    lastId: -1,
    repeatCount: 0,
  };
}

export function getAbhsState(saveRef, libName) {
  if (!saveRef.abhsByLib) saveRef.abhsByLib = {};
  if (!saveRef.abhsByLib[libName]) saveRef.abhsByLib[libName] = createAbhsState();
  return saveRef.abhsByLib[libName];
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseEntry(line) {
  const comma = line.indexOf(',');
  if (comma <= 0) return null;
  const t = Number(line.slice(0, comma));
  const id = Number(line.slice(comma + 1));
  if (!Number.isFinite(t) || !Number.isFinite(id)) return null;
  return { t, id };
}

/** Import legacy .abhs sidecar (files 4-8 concatenated or single file lines). */
export function importAbhsLines(state, text) {
  if (!text) return;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const entry = parseEntry(line);
    if (entry) state.d1.push(entry);
  }
}

export function pickAbhsWordId(state, entryCount) {
  const now = nowSec();
  state.repeatCount = 0;

  for (const bucket of ABHS_BUCKETS) {
    const list = state[bucket.key];
    if (!list.length) continue;
    const head = list[0];
    if (now - head.t <= bucket.wait) continue;

    list.shift();
    const id = head.id;
    if (bucket.next) {
      state[bucket.next].push({ t: now, id });
    }

    if (id >= entryCount) {
      return { wordIndex: Math.floor(Math.random() * entryCount), fromAbhs: false };
    }

    if (state.lastId !== id) {
      state.lastId = id;
      state.repeatCount = 0;
    } else {
      state.repeatCount += 1;
      if (state.repeatCount >= 2) {
        return pickAbhsWordId(state, entryCount);
      }
    }
    return { wordIndex: id, fromAbhs: true };
  }

  return null;
}

export function abhsOnCorrect(state, wordIndex, fromAbhs) {
  if (fromAbhs) return;
  state.b5.push({ t: nowSec(), id: wordIndex });
}

export function removeWordFromAbhs(state, wordIndex) {
  for (const bucket of ABHS_BUCKETS) {
    state[bucket.key] = state[bucket.key].filter((e) => e.id !== wordIndex);
  }
}

export function serializeAbhsForSave(state) {
  const out = {};
  for (const bucket of ABHS_BUCKETS) {
    out[bucket.key] = state[bucket.key].map((e) => `${e.t},${e.id}`);
  }
  out.lastId = state.lastId;
  out.repeatCount = state.repeatCount;
  return out;
}

export function deserializeAbhsFromSave(raw) {
  const state = createAbhsState();
  if (!raw) return state;
  for (const bucket of ABHS_BUCKETS) {
    const lines = raw[bucket.key];
    if (!Array.isArray(lines)) continue;
    state[bucket.key] = lines
      .map((line) => parseEntry(String(line)))
      .filter(Boolean);
  }
  state.lastId = raw.lastId ?? -1;
  state.repeatCount = raw.repeatCount ?? 0;
  return state;
}
