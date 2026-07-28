/* ============================================================
   The Cookbook Board
   ------------------------------------------------------------
   Storage lives in IndexedDB (database "cookbook"):

     meals    one record per meal, photo bytes stripped out
     images   one JPEG Blob per photo, key "<mealId>__<itemId>"
     backups  numbered snapshots, restorable by a 4-digit code
     meta     settings, meal order, pantry, deletion tombstones

   Photos are Blobs rather than base64 data URLs: about a third
   smaller, disk-backed rather than held in memory, and shared by
   reference with backups so a snapshot costs almost nothing.
   They only become data URLs when you export a backup file, which
   keeps that file byte-compatible with the original artifact
   version of this app.
   ============================================================ */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const html = htm.bind(React.createElement);
const Frag = React.Fragment;

/* data.js and recipe-parser.js are separate files, which means either can fail
   to arrive — a half-finished upload, a stale cache, a typo in a filename. When
   that happens the app carries on with empty charts and says so, rather than
   dying the moment you open a tab that needed them. */
const COOK_TEMPS = window.COOK_TEMPS || [];
const DONENESS = window.DONENESS || [];
const PANTRY_GROUPS = window.PANTRY_GROUPS || [];
const STARTER_MEALS = window.STARTER_MEALS || [];
const Parser = window.RecipeParser || {
  parseRecipe: () => null,
  ingredientKey: (s) => String(s || "").toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim(),
};
const MISSING_FILES = [
  !window.COOK_TEMPS && "data.js",
  !window.RecipeParser && "recipe-parser.js",
].filter(Boolean);

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack", "Dessert"];
const DEVICES = ["Oven", "Air fryer", "Stovetop", "Microwave", "Grill", "Slow cooker", "No-cook"];
const RATING_BANDS = [
  { id: "r9", label: "9.0 +", test: (r) => r >= 9 },
  { id: "r7", label: "7.0 – 8.9", test: (r) => r >= 7 && r < 9 },
  { id: "r5", label: "5.0 – 6.9", test: (r) => r >= 5 && r < 7 },
  { id: "r0", label: "Below 5", test: (r) => r < 5 },
];
const TIME_BANDS = [
  { id: "t15", label: "Under 15 min", test: (t) => t < 15 },
  { id: "t30", label: "15 – 30 min", test: (t) => t >= 15 && t <= 30 },
  { id: "t60", label: "30 – 60 min", test: (t) => t > 30 && t <= 60 },
  { id: "t99", label: "Over 60 min", test: (t) => t > 60 },
];
const SWATCHES = [
  "#1C2419", "#5B6152", "#9AA08F", "#FFFFFF", "#D8341F", "#F06543",
  "#E8720C", "#F5A623", "#F5D90A", "#B8C42A", "#3E8E4F", "#1E6E5C",
  "#35B6B4", "#2465C9", "#173F8A", "#7A3FBF", "#C13FA6", "#7A4A21",
];
const FRAMES = {
  none: { label: "No frame" },
  sakura: { label: "Sakura blossoms", emoji: ["🌸", "💮", "🌷"], edge: "#F0BFCE" },
  leaves: { label: "Fresh leaves", emoji: ["🍃", "🌿", "☘️"], edge: "#B8D3A8" },
  autumn: { label: "Autumn leaves", emoji: ["🍁", "🍂", "🌰"], edge: "#E0B183" },
  citrus: { label: "Citrus grove", emoji: ["🍋", "🍊", "🍃"], edge: "#EEDA96" },
  berries: { label: "Berries", emoji: ["🍓", "🫐", "🍒"], edge: "#E3AEBE" },
  herbs: { label: "Herb garden", emoji: ["🌱", "🪴", "🌾"], edge: "#C6CCA4" },
};
const FRAME_SPOTS = [
  { top: 4, left: 3, s: 22, r: -15 }, { top: 2, left: 22, s: 15, r: 20 }, { top: 5, left: 44, s: 18, r: -8 },
  { top: 2, left: 66, s: 14, r: 12 }, { top: 4, left: 88, s: 21, r: -22 }, { top: 30, left: 1, s: 15, r: 30 },
  { top: 58, left: 2, s: 18, r: -12 }, { top: 82, left: 1, s: 14, r: 18 }, { top: 32, right: 1, s: 16, r: -25 },
  { top: 60, right: 2, s: 19, r: 10 }, { top: 84, right: 1, s: 14, r: -18 }, { bottom: 3, left: 6, s: 20, r: 14 },
  { bottom: 1, left: 30, s: 15, r: -20 }, { bottom: 4, left: 52, s: 18, r: 8 }, { bottom: 2, left: 74, s: 14, r: -10 },
  { bottom: 3, left: 93, s: 21, r: 24 },
];

/* Things almost everyone has. Missing one of these shouldn't stop a recipe
   being suggested, so they score much lower than real ingredients. */
const STAPLES = new Set(["salt", "black pepper", "pepper", "water", "olive oil", "vegetable oil",
  "oil", "butter", "sugar", "flour", "garlic", "onion", "seasoning"]);

/* "Salt and pepper" is two staples on one line, and shouldn't end up on a
   shopping list just because the pair isn't a single catalogue entry. */
function isStaple(key) {
  if (STAPLES.has(key)) return true;
  const parts = String(key).split(/\s+(?:and|&|\+)\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 && parts.every((p) => STAPLES.has(p));
}

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const imgKey = (mealId, itemId) => mealId + "__" + itemId;

function newMeal() {
  return {
    id: uid(), name: "New meal", mealType: "Dinner", device: "Stovetop",
    prepTime: 30, rating: 7.0, favorite: false, coverId: null, variants: [],
    instructions: "", notes: "", ingredients: [], items: [], strokes: [], boardH: 640,
    created: Date.now(), modified: Date.now(),
  };
}

/* Steps live inside the plain `instructions` string, one per line, so the
   backup file stays exactly the shape the original artifact wrote and there are
   never two copies of the same text to fall out of step. The editor splits on
   newlines, strips any numbering it finds, and writes numbering back. */
function stepsOf(instructions) {
  return String(instructions || "")
    .split("\n")
    .map((s) => s.replace(/^\s*(?:step\s*)?\d+\s*[.)]\s*/i, "").trim())
    .filter(Boolean);
}
const stepsToText = (steps) => steps.map((s, i) => (i + 1) + ". " + s).join("\n");

/* ------------------------------------------------------------------ */
/*  IndexedDB                                                          */
/* ------------------------------------------------------------------ */
const DB_NAME = "cookbook";
const DB_VER = 2;
let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("meals")) d.createObjectStore("meals", { keyPath: "id" });
      if (!d.objectStoreNames.contains("images")) d.createObjectStore("images");
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("backups")) d.createObjectStore("backups", { keyPath: "code" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _dbPromise;
}
function req(q) {
  return new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
const idb = {
  async get(store, key) { const d = await openDb(); return req(d.transaction(store).objectStore(store).get(key)); },
  async getAll(store) { const d = await openDb(); return req(d.transaction(store).objectStore(store).getAll()); },
  async keys(store) { const d = await openDb(); return req(d.transaction(store).objectStore(store).getAllKeys()); },
  async put(store, value, key) {
    const d = await openDb();
    const tx = d.transaction(store, "readwrite");
    const q = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    return req(q);
  },
  async del(store, key) {
    const d = await openDb();
    return req(d.transaction(store, "readwrite").objectStore(store).delete(key));
  },
};

/* Photos being written right now. A photo reaches IndexedDB a moment before its
   item reaches React state, and autosave can fall in that gap — without this the
   orphan sweep would see a blob no meal references yet and delete it. */
const pendingImages = new Set();

/* ---------- object URLs for photos ---------- */
const urlCache = new Map();
function urlFor(key, blob) {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}
function dropUrl(key) {
  const u = urlCache.get(key);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(key); }
}

/* ---------- image helpers ---------- */
function loadImgEl(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("img failed"));
    i.src = src;
  });
}
function canvasToBlob(c, type, q) {
  return new Promise((res, rej) => {
    if (c.toBlob) c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q);
    else rej(new Error("no toBlob"));
  });
}
async function processImageFile(file) {
  const MAX = 1200;
  let src = null;
  try {
    src = URL.createObjectURL(file);
    const img = await loadImgEl(src);
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("no dimensions");
    const scale = Math.min(1, MAX / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(c, "image/jpeg", 0.82);
    return { blob, w, h };
  } finally {
    if (src) URL.revokeObjectURL(src);
  }
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  const [head, body] = String(dataURL).split(",");
  const mime = (head.match(/:(.*?);/) || [, "image/jpeg"])[1];
  if (/;base64/.test(head)) {
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

/* ---------- meal <-> storage ---------- */
function stripMeal(meal) {
  return {
    ...meal,
    items: meal.items.map((it) => (it.kind === "image" ? { ...it, src: undefined } : it)),
  };
}
async function hydrateMeal(meal) {
  const items = [];
  for (const it of meal.items || []) {
    if (it.kind !== "image") { items.push(it); continue; }
    const key = imgKey(meal.id, it.id);
    let src = null;
    try {
      const blob = await idb.get("images", key);
      if (blob) src = urlFor(key, blob);
    } catch { /* unreadable photo — the card just shows a gap */ }
    items.push({ ...it, src });
  }
  return {
    ...meal, items,
    variants: meal.variants || [], strokes: meal.strokes || [],
    ingredients: meal.ingredients || [], notes: meal.notes || "",
  };
}

/* ---------- pantry matching ---------- */
const normalize = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ");

/* Singular/plural and the handful of names that genuinely differ. */
function matchKeys(name) {
  const n = normalize(name);
  const out = new Set([n]);
  if (n.endsWith("es")) out.add(n.slice(0, -2));
  if (n.endsWith("s")) out.add(n.slice(0, -1));
  out.add(n + "s");
  const ALIAS = {
    "aubergine": "eggplant", "courgette": "zucchini", "coriander": "cilantro",
    "spring onion": "scallion", "chickpeas": "garbanzo", "prawns": "shrimp",
    "mince": "ground beef", "bicarbonate of soda": "baking soda", "passata": "tomato sauce",
  };
  for (const [a, b] of Object.entries(ALIAS)) {
    if (n.includes(a)) out.add(n.replace(a, b));
    if (n.includes(b)) out.add(n.replace(b, a));
  }
  return [...out].filter(Boolean);
}

/* Whole words only: "cornflour" must not count as having "corn". */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function containsWords(haystack, needle) {
  return new RegExp("(^|\\s)" + escapeRe(needle) + "($|\\s)").test(haystack);
}

/* Does the pantry cover this ingredient?
   The match is deliberately one-directional. Your pantry item may be MORE
   specific than the recipe asks for — having "chicken breast" satisfies
   "chicken", having "olive oil" satisfies "oil" — but never less. Matching both
   ways, as this used to, meant ticking "butter" made the app believe you had
   "peanut butter", and "cream" covered "sour cream": it would tell you a recipe
   was ready to cook and leave the missing thing off your shopping list.
   Erring towards buying a spare is much cheaper than finding out at the stove. */
function pantryHas(haveSet, ingredient) {
  const keys = matchKeys(Parser.ingredientKey(ingredient) || ingredient);
  for (const k of keys) {
    if (!k || k.length < 3) continue;
    if (haveSet.has(k)) return true;
    for (const h of haveSet) {
      if (h.length < 3) continue;
      if (containsWords(h, k)) return true;
    }
  }
  return false;
}

function scoreRecipe(recipe, haveSet) {
  const ing = recipe.ingredients || [];
  if (!ing.length) return null;
  const missing = [], have = [];
  for (const i of ing) {
    const key = normalize(Parser.ingredientKey(i) || i);
    if (pantryHas(haveSet, i)) have.push(i);
    else if (isStaple(key)) have.push(i);            // assume you have salt
    else missing.push(i);
  }
  return { have, missing, pct: Math.round((have.length / ing.length) * 100) };
}

/* ------------------------------------------------------------------ */
/*  Backups                                                            */
/* ------------------------------------------------------------------ */
const MAX_BACKUPS = 20;

function makeCode(taken) {
  for (let i = 0; i < 500; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    if (!taken.has(c)) return c;
  }
  return String(Date.now()).slice(-4);
}

/* How many snapshots travel to the cloud. They hold meal text, not photos, so
   they're small — but the whole set lives in a single row, so it shouldn't grow
   without limit. Older ones stay on the device that made them. */
const SYNC_BACKUPS = 10;

/* Two devices offline at once can both invent the same 4-digit code for
   different snapshots. Identity is therefore the moment it was taken, not the
   code; when codes clash the newer snapshot keeps it and the older is given a
   fresh one, so neither is lost. */
function mergeBackups(local, remote) {
  const byTime = new Map();
  for (const b of [...(remote || []), ...(local || [])]) {
    if (!b || !b.at) continue;
    byTime.set(b.at, { ...(byTime.get(b.at) || {}), ...b });
  }
  const all = [...byTime.values()].sort((a, b) => b.at - a.at);
  const taken = new Set();
  for (const b of all) {
    if (!b.code || taken.has(b.code)) b.code = makeCode(taken);
    taken.add(b.code);
  }
  return all.slice(0, MAX_BACKUPS);
}

/* A snapshot stores meal records and the photo keys they point at. The photos
   themselves are not copied — the orphan sweep just knows not to delete a photo
   any backup still references, so a snapshot costs a few KB however many
   photos your cookbook holds. */
async function createBackup(meals, label) {
  const existing = await idb.getAll("backups");
  const code = makeCode(new Set(existing.map((b) => b.code)));
  const imageKeys = [];
  for (const m of meals) for (const it of m.items) if (it.kind === "image") imageKeys.push(imgKey(m.id, it.id));
  await idb.put("backups", {
    code, at: Date.now(), label: label || "",
    meals: meals.map(stripMeal), imageKeys,
    mealCount: meals.length, photoCount: imageKeys.length,
  });
  // Keep the list from growing forever; oldest automatic ones go first.
  const all = (await idb.getAll("backups")).sort((a, b) => b.at - a.at);
  for (const old of all.slice(MAX_BACKUPS)) await idb.del("backups", old.code);
  return code;
}

/* ------------------------------------------------------------------ */
/*  Supabase sync (optional — see config.js)                           */
/* ------------------------------------------------------------------ */
const BUCKET = "cookbook";
/* Prefixed on purpose. One Supabase project can host several apps, but only if
   they don't all reach for a table called "meta" — sharing one would mean two
   apps overwriting each other's settings and deleted-item lists, with no error
   to point at. These names must match schema.sql. */
const T_MEALS = "cookbook_meals";
const T_META = "cookbook_meta";

const Sync = {
  supa: null,
  user: null,
  configured() {
    const c = window.COOKBOOK_CONFIG || {};
    return !!(c.url && c.anonKey && !/^YOUR_/.test(c.url) && !/^YOUR_/.test(c.anonKey));
  },
  init() {
    if (this.supa || !this.configured() || !window.supabase) return this.supa;
    const c = window.COOKBOOK_CONFIG;
    this.supa = window.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return this.supa;
  },
  path(mealId, itemId) { return this.user.id + "/meals/" + imgKey(mealId, itemId) + ".jpg"; },

  async signIn(email, password) {
    const { data, error } = await this.supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data.user;
  },
  async signUp(email, password) {
    const { data, error } = await this.supa.auth.signUp({ email, password });
    if (error) throw error;
    this.user = data.user || null;
    return data;
  },
  async signOut() {
    try { await this.supa.auth.signOut(); } catch { /* already gone */ }
    this.user = null;
  },

  async pushMeal(meal) {
    const items = [];
    for (const it of meal.items) {
      if (it.kind !== "image" || it.remote) { items.push(it); continue; }
      const blob = await idb.get("images", imgKey(meal.id, it.id));
      if (!blob) { items.push(it); continue; }
      const p = this.path(meal.id, it.id);
      const { error } = await this.supa.storage.from(BUCKET).upload(p, blob, {
        upsert: true, contentType: "image/jpeg",
      });
      items.push(error ? it : { ...it, remote: p });
    }
    const next = { ...meal, items };
    const { error } = await this.supa.from(T_MEALS).upsert({
      user_id: this.user.id, id: next.id,
      data: stripMeal(next), modified: next.modified || Date.now(),
    });
    if (error) throw error;
    return next;
  },

  async pullMeal(row) {
    const meal = row.data;
    meal.id = row.id;
    meal.modified = row.modified;
    for (const it of meal.items || []) {
      if (it.kind !== "image" || !it.remote) continue;
      const key = imgKey(meal.id, it.id);
      if (await idb.get("images", key)) continue;
      const { data, error } = await this.supa.storage.from(BUCKET).download(it.remote);
      if (!error && data) await idb.put("images", data, key);
    }
    return meal;
  },

  /* Pull down any photo this meal points at that we don't already hold. Needed
     when restoring a snapshot that was taken on another device: the meal text
     travelled through the meta row, but the pictures live in the bucket. */
  async fetchPhotos(meal) {
    if (!this.user) return;
    for (const it of meal.items || []) {
      if (it.kind !== "image" || !it.remote) continue;
      const key = imgKey(meal.id, it.id);
      try {
        if (await idb.get("images", key)) continue;
        const { data, error } = await this.supa.storage.from(BUCKET).download(it.remote);
        if (!error && data) await idb.put("images", data, key);
      } catch { /* the photo is gone from the bucket; the meal restores without it */ }
    }
  },

  async deleteMeal(mealId, items) {
    for (const it of items || []) {
      if (it.kind === "image" && it.remote) {
        try { await this.supa.storage.from(BUCKET).remove([it.remote]); } catch { /* already gone */ }
      }
    }
    await this.supa.from(T_MEALS).delete().eq("id", mealId).eq("user_id", this.user.id);
  },

  async getMeta(key) {
    const { data } = await this.supa.from(T_META).select("value").eq("key", key).maybeSingle();
    return data ? data.value : null;
  },
  async setMeta(key, value) {
    await this.supa.from(T_META).upsert({ user_id: this.user.id, key, value });
  },
};

/* ------------------------------------------------------------------ */
/*  Timers                                                             */
/*  Countdowns are stored as an end time, not a decrementing number, so */
/*  they stay accurate while the tab is in the background — browsers    */
/*  throttle timers there, but the clock keeps moving.                  */
/* ------------------------------------------------------------------ */
let audioCtx = null;

/* Built the first time you start a timer, which is a real tap, so the browser
   lets it make sound later when the timer actually finishes. */
function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* no audio on this device */ }
}
function alarm() {
  try {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [0, 0.32, 0.64, 0.96].forEach((t) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, now + t);
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.24);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(now + t); o.stop(now + t + 0.26);
    });
  } catch { /* sound is a bonus, never a requirement */ }
  try { if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]); } catch { /* no vibration */ }
}
const mmss = (s) => {
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(ss).padStart(2, "0");
};

/* A timer that only beeps is no use once you've switched to another app, which
   is exactly when a long roast finishes. Asked for the first time you start one. */
function askNotify() {
  try {
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
  } catch { /* not available */ }
}
function notify(label) {
  try {
    if (!window.Notification || Notification.permission !== "granted") return;
    if (!document.hidden) return;   // you're looking at it; the sound is enough
    new Notification("Timer finished", { body: label, tag: "cookbook-timer", icon: "icon.svg" });
  } catch { /* not available */ }
}

function useTimers() {
  const [timers, setTimers] = useState([]);
  const [, force] = useState(0);
  const rang = useRef(new Set());
  const loaded = useRef(false);

  /* Timers are stored as the moment they end, so closing the tab, reloading, or
     the phone killing a backgrounded app doesn't lose them — reopening picks the
     countdown back up where the clock actually is. */
  useEffect(() => {
    (async () => {
      try {
        const saved = await idb.get("meta", "timers");
        if (Array.isArray(saved) && saved.length) {
          const cutoff = Date.now() - 6 * 3600 * 1000;   // forget yesterday's
          const live = saved.filter((t) => t.endsAt > cutoff);
          live.forEach((t) => { if (Date.now() >= t.endsAt) rang.current.add(t.id); });
          setTimers(live.map((t) => ({ ...t, done: Date.now() >= t.endsAt })));
        }
      } catch { /* nothing saved */ }
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    idb.put("meta", timers, "timers").catch(() => { });
  }, [timers]);

  useEffect(() => {
    if (!timers.some((t) => !t.done)) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [timers]);

  // Ringing is a side effect of time passing, so it belongs here rather than
  // in the render that noticed it.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      let changed = false;
      for (const t of timers) {
        if (!t.done && now >= t.endsAt && !rang.current.has(t.id)) {
          rang.current.add(t.id);
          alarm();
          notify(t.label);
          changed = true;
        }
      }
      if (changed) setTimers((ts) => ts.map((t) => (Date.now() >= t.endsAt ? { ...t, done: true } : t)));
    };
    const id = setInterval(check, 300);
    return () => clearInterval(id);
  }, [timers]);

  const start = (seconds, label) => {
    primeAudio();
    askNotify();
    const t = { id: uid(), label: label || mmss(seconds), total: seconds, endsAt: Date.now() + seconds * 1000, done: false };
    setTimers((ts) => [...ts, t]);
    return t.id;
  };
  const stop = (id) => { rang.current.delete(id); setTimers((ts) => ts.filter((t) => t.id !== id)); };
  const addMinute = (id) => setTimers((ts) => ts.map((t) => {
    if (t.id !== id) return t;
    rang.current.delete(id);
    return { ...t, done: false, endsAt: Math.max(Date.now(), t.endsAt) + 60000, total: t.total + 60 };
  }));

  return { timers, start, stop, addMinute };
}

function TimerBar({ timers, stop, addMinute }) {
  if (!timers.length) return null;
  return html`
    <div className="timer-bar">
      ${timers.map((t) => {
        const left = (t.endsAt - Date.now()) / 1000;
        const done = left <= 0;
        const pct = Math.max(0, Math.min(100, (left / t.total) * 100));
        return html`
          <div key=${t.id} className=${"timer" + (done ? " timer-done" : "")}>
            <div className="timer-fill" style=${{ width: pct + "%" }}></div>
            <span className="timer-label">${t.label}</span>
            <span className="timer-left">${done ? "done!" : mmss(left)}</span>
            ${done
              ? html`<button title="Snooze one minute" onClick=${() => addMinute(t.id)}>+1</button>`
              : html`<button title="Add a minute" onClick=${() => addMinute(t.id)}>+1</button>`}
            <button title="Clear this timer" onClick=${() => stop(t.id)}>✕</button>
          </div>`;
      })}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                           */
/* ------------------------------------------------------------------ */
function strokeBBoxCenter(s) {
  if (s.points) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of s.points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }
  return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
}
function translateStroke(s, dx, dy) {
  if (s.points) return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy]) };
  return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
}
const inside = (cx, cy, it) => cx >= it.x && cx <= it.x + it.w && cy >= it.y && cy <= it.y + it.h;

/* ------------------------------------------------------------------ */
/*  Small UI bits                                                      */
/* ------------------------------------------------------------------ */
function Frame({ theme }) {
  const f = FRAMES[theme];
  if (!f || !f.emoji) return null;
  return html`
    <div className="frame" style=${{ boxShadow: `inset 0 0 0 6px ${f.edge}, inset 0 0 0 8px #FFFFFF` }}>
      ${FRAME_SPOTS.map((p, i) => html`
        <span key=${i} className="frame-emoji" style=${{
          top: p.top !== undefined ? p.top + "%" : "auto",
          bottom: p.bottom !== undefined ? p.bottom + "%" : "auto",
          left: p.left !== undefined ? p.left + "%" : "auto",
          right: p.right !== undefined ? p.right + "%" : "auto",
          fontSize: p.s, transform: `rotate(${p.r}deg)`,
        }}>${f.emoji[i % f.emoji.length]}</span>`)}
    </div>`;
}

function Chip({ active, onClick, children, tone }) {
  return html`
    <button className=${"chip" + (active ? " chip-on" : "") + (tone ? " chip-" + tone : "")}
      aria-pressed=${!!active} onClick=${onClick}>
      ${children}
    </button>`;
}

function Star({ on, onClick, size = 18 }) {
  return html`
    <button className="starbtn" onClick=${onClick} title=${on ? "Unfavorite" : "Favorite"}
      style=${{ fontSize: size, color: on ? "var(--paprika)" : "var(--line-dark)" }}>
      ${on ? "★" : "☆"}
    </button>`;
}

/* Ten stars, each half-tappable, so a rating is one touch instead of typing
   "8.7" on a phone keypad. The exact number stays available beside it. */
function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(null);
  const shown = hover !== null ? hover : value;
  return html`
    <span className="stars" onPointerLeave=${() => setHover(null)}>
      ${Array.from({ length: 10 }, (_, i) => {
        const full = i + 1, half = i + 0.5;
        const state = shown >= full ? "full" : shown >= half ? "half" : "empty";
        return html`
          <span key=${i} className=${"star star-" + state}>
            <button aria-label=${half + " out of 10"} onClick=${() => onChange(half)}
              onPointerEnter=${() => setHover(half)}></button>
            <button aria-label=${full + " out of 10"} onClick=${() => onChange(full)}
              onPointerEnter=${() => setHover(full)}></button>
          </span>`;
      })}
    </span>`;
}

const lastCooked = (meal) => {
  const log = meal.cookLog || [];
  return log.length ? log[log.length - 1] : null;
};
function cookedSummary(meal) {
  const log = meal.cookLog || [];
  if (!log.length) return "";
  const last = new Date(log[log.length - 1]);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  const when = days === 0 ? "today" : days === 1 ? "yesterday"
    : days < 30 ? days + " days ago"
    : last.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return "Cooked " + log.length + (log.length === 1 ? " time" : " times") + " · last " + when;
}

function coverOf(meal) {
  const imgs = meal.items.filter((i) => i.kind === "image");
  return imgs.find((i) => i.id === meal.coverId) || imgs[0] || null;
}

function MealCard({ meal, onOpen, onFav, onCook }) {
  const cov = coverOf(meal);
  return html`
    <div className="card" onClick=${() => onOpen(meal.id)}>
      <div className="card-img">
        ${cov && cov.src
          ? html`<img src=${cov.src} alt=${meal.name} draggable=${false} />`
          : html`<div className="card-noimg">${cov ? "photo unavailable" : "no photo yet"}</div>`}
        <span className="card-rating">${meal.rating.toFixed(1)}</span>
        ${onCook && html`
          <button className="card-cook" title=${"Cook " + meal.name} aria-label=${"Cook " + meal.name}
            onClick=${(e) => { e.stopPropagation(); onCook(meal.id); }}>▶</button>`}
      </div>
      <div className="card-body">
        <div className="card-title-row">
          <span className="card-title">${meal.name}</span>
          <${Star} on=${meal.favorite} onClick=${(e) => { e.stopPropagation(); onFav(meal.id); }} />
        </div>
        <div className="card-meta">
          ${meal.mealType} · ${meal.device} · ${meal.prepTime} min
          ${(meal.variants || []).length > 0 &&
            html`<span className="var-tag"> +${meal.variants.length} prep${meal.variants.length > 1 ? "s" : ""}</span>`}
        </div>
        ${(meal.cookLog || []).length > 0 && html`
          <div className="card-cooked">🍽 ${cookedSummary(meal)}</div>`}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Photo lightbox                                                     */
/* ------------------------------------------------------------------ */
function Lightbox({ photos, index, onIndex, onClose }) {
  const photo = photos[index];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % photos.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex, onClose]);
  if (!photo) return null;
  return html`
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo"
      onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="lb-close" aria-label="Close photo" onClick=${onClose}>✕</button>
      ${photos.length > 1 && html`
        <${Frag}>
          <button className="lb-nav lb-prev" aria-label="Previous photo"
            onClick=${() => onIndex((index - 1 + photos.length) % photos.length)}>‹</button>
          <button className="lb-nav lb-next" aria-label="Next photo"
            onClick=${() => onIndex((index + 1) % photos.length)}>›</button>
          <span className="lb-count">${index + 1} / ${photos.length}</span>
        <//>`}
      <img src=${photo.src} alt="" />
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Color wheel                                                        */
/* ------------------------------------------------------------------ */
function ColorWheel({ color, onChange }) {
  const [hue, setHue] = useState(10);
  const [light, setLight] = useState(45);
  const ref = useRef(null);
  const pick = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const h = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 450) % 360);
    setHue(h);
    onChange(`hsl(${h} 85% ${light}%)`);
  };
  return html`
    <div className="wheel-wrap">
      <div ref=${ref} className="wheel" onPointerDown=${pick} onPointerMove=${(e) => e.buttons && pick(e)} title="Pick a hue">
        <div className="wheel-hole" style=${{ background: color }}></div>
      </div>
      <input type="range" min="15" max="85" value=${light}
        onChange=${(e) => { const l = +e.target.value; setLight(l); onChange(`hsl(${hue} 85% ${l}%)`); }} />
      <div className="swatch-grid">
        ${SWATCHES.map((c) => html`
          <button key=${c} className="swatch" style=${{ background: c }} onClick=${() => onChange(c)}></button>`)}
      </div>
      <label className="exact-color">exact color
        <input type="color" onChange=${(e) => onChange(e.target.value)} />
      </label>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Meal page canvas                                                   */
/*  Items and strokes are positioned against the WHOLE meal page, not  */
/*  a board box, so a photo can sit over the rating fields or beside   */
/*  the instructions. The dotted area is just a hint about where       */
/*  there's free room.                                                 */
/* ------------------------------------------------------------------ */
function PageCanvas({ meal, mode, draw, update, pageRef, onViewPhoto }) {
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const layerRef = useRef(null);
  const [ephem, setEphem] = useState(null);
  const [live, setLive] = useState(null);

  const pt = (e) => {
    const r = pageRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  /* ----- drawing ----- */
  const drawDown = (e) => {
    if (mode !== "draw" || !e.isPrimary) return;
    e.preventDefault();
    try { layerRef.current.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    drawRef.current = e.pointerId;
    const [x, y] = pt(e);
    if (draw.tool === "pen" || draw.tool === "highlight") {
      setLive({
        id: uid(), tool: draw.tool, color: draw.color,
        size: draw.tool === "highlight" ? Math.max(draw.size, 14) : draw.size,
        points: [[x, y]],
      });
    } else {
      setLive({ id: uid(), tool: draw.tool, color: draw.color, size: draw.size, x1: x, y1: y, x2: x, y2: y });
    }
  };
  const drawMove = (e) => {
    if (!live || drawRef.current !== e.pointerId) return;
    e.preventDefault();
    const [x, y] = pt(e);
    setLive((s) => (!s ? s : s.points ? { ...s, points: [...s.points, [x, y]] } : { ...s, x2: x, y2: y }));
  };
  const drawUp = (e) => {
    if (!live) return;
    if (e && drawRef.current !== e.pointerId) return;
    drawRef.current = null;
    const [cx, cy] = strokeBBoxCenter(live);
    const pad = [...meal.items].reverse().find((it) => it.kind === "note" && inside(cx, cy, it));
    update((m) => ({ ...m, strokes: [...m.strokes, { ...live, parent: pad ? pad.id : null }] }));
    setLive(null);
  };
  const drawCancel = () => { drawRef.current = null; setLive(null); };

  /* ----- move / resize ----- */
  const startMove = (e, item) => {
    if (mode !== "arrange" || !e.isPrimary) return;
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    dragRef.current = { kind: "move", id: item.id, isPad: item.kind === "note", sx: e.clientX, sy: e.clientY, pid: e.pointerId };
    setEphem({ id: item.id, padId: item.kind === "note" ? item.id : null, dx: 0, dy: 0 });
  };
  const startResize = (e, item) => {
    if (!e.isPrimary) return;
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    dragRef.current = { kind: "resize", id: item.id, sx: e.clientX, sy: e.clientY, w: item.w, h: item.h, pid: e.pointerId };
    setEphem({ id: item.id, dw: 0, dh: 0 });
  };
  const dragMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    if (d.kind === "move") setEphem({ id: d.id, padId: d.isPad ? d.id : null, dx: e.clientX - d.sx, dy: e.clientY - d.sy });
    else setEphem({ id: d.id, dw: e.clientX - d.sx, dh: e.clientY - d.sy });
  };
  const dragEnd = (e) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    if (d.kind === "move") {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      /* Keep whatever you dropped fully inside the page width. Without this you
         can shove something off the right edge — unreachable on a phone, and the
         whole page grows a sideways scrollbar to accommodate it. */
      const pageW = pageRef.current ? pageRef.current.clientWidth : 900;
      update((m) => {
        /* Work out the delta once, from the item actually grabbed, then apply
           that same delta to a notepad's contents and drawings so a clamped pad
           never drifts apart from the things stuck to it. */
        const grabbed = m.items.find((it) => it.id === d.id);
        let adx = dx, ady = dy;
        if (grabbed) {
          const nx = Math.min(Math.max(grabbed.x + dx, 0), Math.max(0, pageW - grabbed.w));
          const ny = Math.max(0, grabbed.y + dy);
          adx = Math.round(nx - grabbed.x);
          ady = Math.round(ny - grabbed.y);
        }
        let items = m.items.map((it) => {
          if (it.id === d.id || (d.isPad && it.parent === d.id)) return { ...it, x: it.x + adx, y: it.y + ady };
          return it;
        });
        const strokes = d.isPad ? m.strokes.map((s) => (s.parent === d.id ? translateStroke(s, adx, ady) : s)) : m.strokes;
        if (!d.isPad) {
          const moved = items.find((it) => it.id === d.id);
          if (moved && moved.kind !== "note") {
            const cx = moved.x + moved.w / 2, cy = moved.y + moved.h / 2;
            const pad = [...items].reverse().find((it) => it.kind === "note" && inside(cx, cy, it));
            items = items.map((it) => (it.id === d.id ? { ...it, parent: pad ? pad.id : null } : it));
          }
        }
        return { ...m, items, strokes };
      });
    } else {
      const dw = e.clientX - d.sx, dh = e.clientY - d.sy;
      const pageW = pageRef.current ? pageRef.current.clientWidth : 900;
      update((m) => ({
        ...m,
        items: m.items.map((it) => (it.id === d.id
          ? {
              ...it,
              // Not wider than the room left to its right, for the same reason
              // dropping is clamped: nothing should push the page sideways.
              w: Math.max(60, Math.min(Math.round(d.w + dw), Math.max(60, pageW - it.x))),
              h: Math.max(50, Math.round(d.h + dh)),
            }
          : it)),
      }));
    }
    setEphem(null);
  };
  const dragCancel = () => { dragRef.current = null; setEphem(null); };

  const off = (it) => {
    if (!ephem) return [0, 0];
    if (ephem.id === it.id && ephem.dx !== undefined) return [ephem.dx, ephem.dy];
    if (ephem.padId && it.parent === ephem.padId) return [ephem.dx, ephem.dy];
    return [0, 0];
  };
  const dims = (it) => {
    if (ephem && ephem.id === it.id && ephem.dw !== undefined)
      return [Math.max(60, it.w + ephem.dw), Math.max(50, it.h + ephem.dh)];
    return [it.w, it.h];
  };

  const renderStroke = (s, key) => {
    const common = {
      stroke: s.color, strokeWidth: s.size, fill: "none",
      strokeLinecap: "round", strokeLinejoin: "round",
      opacity: s.tool === "highlight" ? 0.4 : 1,
    };
    const tf = ephem && ephem.padId && s.parent === ephem.padId ? `translate(${ephem.dx},${ephem.dy})` : undefined;
    if (s.points) return html`<polyline key=${key} transform=${tf} points=${s.points.map((p) => p.join(",")).join(" ")} ...${common} />`;
    if (s.tool === "line") return html`<line key=${key} transform=${tf} x1=${s.x1} y1=${s.y1} x2=${s.x2} y2=${s.y2} ...${common} />`;
    if (s.tool === "arrow") {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const hl = Math.max(11, s.size * 3.2);
      const a1 = [s.x2 - hl * Math.cos(ang - 0.45), s.y2 - hl * Math.sin(ang - 0.45)];
      const a2 = [s.x2 - hl * Math.cos(ang + 0.45), s.y2 - hl * Math.sin(ang + 0.45)];
      return html`
        <g key=${key} transform=${tf}>
          <line x1=${s.x1} y1=${s.y1} x2=${s.x2} y2=${s.y2} ...${common} />
          <line x1=${a1[0]} y1=${a1[1]} x2=${s.x2} y2=${s.y2} ...${common} />
          <line x1=${a2[0]} y1=${a2[1]} x2=${s.x2} y2=${s.y2} ...${common} />
        </g>`;
    }
    if (s.tool === "rect") return html`
      <rect key=${key} transform=${tf} x=${Math.min(s.x1, s.x2)} y=${Math.min(s.y1, s.y2)}
        width=${Math.abs(s.x2 - s.x1)} height=${Math.abs(s.y2 - s.y1)} ...${common} />`;
    return html`
      <ellipse key=${key} transform=${tf} cx=${(s.x1 + s.x2) / 2} cy=${(s.y1 + s.y2) / 2}
        rx=${Math.abs(s.x2 - s.x1) / 2} ry=${Math.abs(s.y2 - s.y1) / 2} ...${common} />`;
  };

  const imgs = meal.items.filter((i) => i.kind === "image");
  const layered = meal.items
    .map((it, i) => ({ ...it, _layer: it.layer !== undefined ? it.layer : i }))
    .sort((a, b) => a._layer - b._layer);
  const allLayers = layered.map((o) => o._layer);
  const setLayer = (id, v) => update((m) => ({ ...m, items: m.items.map((x) => (x.id === id ? { ...x, layer: v } : x)) }));
  const toFront = (id) => setLayer(id, (allLayers.length ? Math.max(...allLayers) : 0) + 1);
  const toBack = (id) => setLayer(id, (allLayers.length ? Math.min(...allLayers) : 0) - 1);
  const setOpacity = (id, v) => update((m) => ({ ...m, items: m.items.map((x) => (x.id === id ? { ...x, opacity: v } : x)) }));
  const removeItem = (id) => update((m) => ({
    ...m,
    items: m.items.filter((x) => x.id !== id).map((x) => (x.parent === id ? { ...x, parent: null } : x)),
    strokes: m.strokes.map((s) => (s.parent === id ? { ...s, parent: null } : s)),
    coverId: m.coverId === id ? null : m.coverId,
  }));
  const patchItem = (id, patch) => update((m) => ({
    ...m, items: m.items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));

  const dragHandlers = { onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragCancel };

  return html`
    <div ref=${layerRef} className=${"pagelayer pagelayer-" + mode}
      onPointerDown=${drawDown} onPointerMove=${drawMove} onPointerUp=${drawUp} onPointerCancel=${drawCancel}>

      ${layered.map((it, idx) => {
        const [dx, dy] = off(it); const [w, h] = dims(it);
        const z = 5 + idx;

        if (it.kind === "note") return html`
          <div key=${it.id} className="note"
            style=${{ left: it.x + dx, top: it.y + dy, width: w, height: h, zIndex: z, background: it.color || "#FFF7CF" }}>
            <div className="note-bar" onPointerDown=${(e) => startMove(e, it)} ...${dragHandlers}>
              <span>notepad</span>
              ${mode === "arrange" && html`
                <button className="mini-x" onPointerDown=${(e) => e.stopPropagation()}
                  onClick=${() => removeItem(it.id)}>✕</button>`}
            </div>
            <textarea className="note-text" value=${it.text || ""} placeholder="jot something…"
              readOnly=${mode === "draw"}
              onChange=${(e) => patchItem(it.id, { text: e.target.value })}
              onPointerDown=${(e) => { if (mode !== "draw") e.stopPropagation(); }} />
            ${mode === "arrange" && html`
              <div className="handle" onPointerDown=${(e) => startResize(e, it)} ...${dragHandlers}></div>`}
          </div>`;

        if (it.kind === "table") return html`
          <div key=${it.id} className=${"ptable" + (mode === "arrange" ? " ptable-arr" : "")}
            style=${{ left: it.x + dx, top: it.y + dy, width: w, height: h, zIndex: z }}>
            <div className="ptable-bar" onPointerDown=${(e) => startMove(e, it)} ...${dragHandlers}>
              <input className="ptable-title" value=${it.title || ""} placeholder="table"
                readOnly=${mode === "draw"}
                onChange=${(e) => patchItem(it.id, { title: e.target.value })}
                onPointerDown=${(e) => { if (mode !== "draw") e.stopPropagation(); }} />
              ${mode === "arrange" && html`
                <button className="mini-x" onPointerDown=${(e) => e.stopPropagation()}
                  onClick=${() => removeItem(it.id)}>✕</button>`}
            </div>
            <div className="ptable-scroll" onPointerDown=${(e) => { if (mode !== "draw") e.stopPropagation(); }}>
              <table>
                <thead><tr>${(it.headers || []).map((hd, ci) => html`<th key=${ci}>${hd}</th>`)}</tr></thead>
                <tbody>
                  ${(it.rows || []).map((row, ri) => html`
                    <tr key=${ri}>
                      ${row.map((cell, ci) => html`
                        <td key=${ci}>
                          <input value=${cell} readOnly=${mode === "draw"}
                            onChange=${(e) => {
                              const rows = it.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? e.target.value : c)) : r));
                              patchItem(it.id, { rows });
                            }} />
                        </td>`)}
                      ${mode === "arrange" && html`
                        <td className="ptable-del">
                          <button onClick=${() => patchItem(it.id, { rows: it.rows.filter((_, i) => i !== ri) })}>✕</button>
                        </td>`}
                    </tr>`)}
                </tbody>
              </table>
              ${mode === "arrange" && html`
                <button className="ptable-add"
                  onClick=${() => patchItem(it.id, { rows: [...(it.rows || []), (it.headers || []).map(() => "")] })}>
                  + row
                </button>`}
            </div>
            ${mode === "arrange" && html`
              <div className="handle" onPointerDown=${(e) => startResize(e, it)} ...${dragHandlers}></div>`}
          </div>`;

        const isCover = meal.coverId === it.id || (!meal.coverId && imgs[0] && imgs[0].id === it.id);
        return html`
          <div key=${it.id} className=${"bimg" + (mode === "arrange" ? " bimg-arr" : "")}
            style=${{ left: it.x + dx, top: it.y + dy, width: w, height: h, zIndex: z,
                      opacity: it.opacity !== undefined ? it.opacity : 1 }}
            onPointerDown=${(e) => startMove(e, it)} ...${dragHandlers}>
            ${it.src
              ? html`<img src=${it.src} alt="" draggable=${false} />`
              : html`<div className="bimg-missing">photo unavailable</div>`}
            ${mode === "view" && it.src && html`
              <button className="bimg-zoom" aria-label="View this photo full size"
                onClick=${(e) => { e.stopPropagation(); onViewPhoto(it.id); }}>⤢</button>`}
            ${mode === "arrange" && html`
              <${Frag}>
                <div className="img-ctrl" onPointerDown=${(e) => e.stopPropagation()}>
                  <button title="Send to back" onClick=${() => toBack(it.id)}>⬇ back</button>
                  <button title="Bring to front" onClick=${() => toFront(it.id)}>⬆ front</button>
                  <input type="range" min="10" max="100" title="Transparency"
                    value=${Math.round((it.opacity !== undefined ? it.opacity : 1) * 100)}
                    onChange=${(e) => setOpacity(it.id, +e.target.value / 100)} />
                </div>
                <button className=${"cover-btn" + (isCover ? " cover-on" : "")} onPointerDown=${(e) => e.stopPropagation()}
                  onClick=${() => update((m) => ({ ...m, coverId: it.id }))}>
                  ${isCover ? "✓ list image" : "use as list image"}
                </button>
                <button className="mini-x" onPointerDown=${(e) => e.stopPropagation()}
                  onClick=${() => removeItem(it.id)}>✕</button>
                <div className="handle" onPointerDown=${(e) => startResize(e, it)} ...${dragHandlers}></div>
              <//>`}
          </div>`;
      })}

      <svg className="strokes">
        ${meal.strokes.map((s, i) => renderStroke(s, s.id || i))}
        ${live && renderStroke(live, "live")}
      </svg>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Ingredients editor                                                 */
/* ------------------------------------------------------------------ */
function Ingredients({ list, have, onChange, servings, onScale }) {
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("");
  const add = () => {
    const parts = draft.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...list, ...parts]);
    setDraft("");
  };

  /* Only worth offering if there's something to scale: lines like
     "salt and pepper" have no number and are left exactly as they are. */
  const scalable = list.filter((i) => Parser.parseQuantity(i).qty !== null).length;
  const doScale = (factor, newServings) => {
    if (!factor || factor === 1) return;
    onScale(list.map((i) => Parser.scaleIngredient(i, factor)), newServings);
  };

  return html`
    <div className="ing-block">
      <div className="var-head">
        <span className="fg-label" style=${{ width: "auto" }}>Ingredients</span>
        <span className="hint">used by “What can I cook?” — green means it's in your pantry</span>
      </div>

      ${scalable > 0 && html`
        <div className="scale-row">
          <span className="hint">Scale the amounts:</span>
          <button className="btn" onClick=${() => doScale(2, servings ? servings * 2 : null)}>×2</button>
          <button className="btn" onClick=${() => doScale(3, servings ? servings * 3 : null)}>×3</button>
          <button className="btn" onClick=${() => doScale(0.5, servings ? Math.max(1, Math.round(servings / 2)) : null)}>÷2</button>
          ${servings > 0 && html`
            <span className="unit-wrap">
              <span className="hint">or make it serve</span>
              <input type="number" inputMode="numeric" min="1" max="99" placeholder=${servings} value=${target}
                onChange=${(e) => setTarget(e.target.value)}
                onKeyDown=${(e) => {
                  if (e.key !== "Enter") return;
                  const n = +target;
                  if (n > 0 && n !== servings) { doScale(n / servings, n); setTarget(""); }
                }} />
              <button className="btn" disabled=${!(+target > 0) || +target === servings}
                onClick=${() => { const n = +target; doScale(n / servings, n); setTarget(""); }}>apply</button>
            </span>`}
          ${scalable < list.length && html`
            <span className="hint">${list.length - scalable} without an amount stay as they are</span>`}
        </div>`}
      <div className="ing-chips">
        ${list.map((ing, i) => html`
          <span key=${i} className=${"ing-chip" + (pantryHas(have, ing) ? " ing-have" : "")}>
            ${ing}
            <button onClick=${() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </span>`)}
        ${list.length === 0 && html`<span className="var-empty">None yet — add a few and this meal joins the suggestions.</span>`}
      </div>
      <div className="ing-add">
        <input value=${draft} placeholder="add an ingredient, or paste a comma-separated list"
          onChange=${(e) => setDraft(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn" onClick=${add}>Add</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Step-by-step instructions — the main body of a meal page           */
/* ------------------------------------------------------------------ */
function Steps({ instructions, onChange }) {
  const [bulk, setBulk] = useState(false);
  const [draft, setDraft] = useState("");
  const steps = stepsOf(instructions);
  const write = (next) => onChange(stepsToText(next));

  const addStep = () => {
    const parts = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    write([...steps, ...parts]);
    setDraft("");
  };
  const setStep = (i, v) => write(steps.map((s, j) => (j === i ? v : s)));
  const removeStep = (i) => write(steps.filter((_, j) => j !== i));
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    write(next);
  };

  return html`
    <div className="steps-wrap">
      <div className="steps-head">
        <h3>Instructions</h3>
        <button className="btn btn-ghost" onClick=${() => setBulk((b) => !b)}>
          ${bulk ? "← back to steps" : "edit as plain text"}
        </button>
      </div>

      ${bulk ? html`
        <textarea className="steps-bulk" value=${instructions}
          placeholder=${"One step per line.\nPaste a whole method here and it becomes numbered steps."}
          onChange=${(e) => onChange(e.target.value)} />`
      : html`
        <${Frag}>
          ${steps.length === 0 && html`
            <p className="steps-empty">
              No steps yet. Write the first one below — or use <b>⎘ Paste a recipe</b> up in the toolbar
              and they'll be filled in for you.
            </p>`}
          <ol className="steps">
            ${steps.map((s, i) => html`
              <li key=${i} className="step">
                <span className="step-n">${i + 1}</span>
                <textarea className="step-text" value=${s} rows="1"
                  onChange=${(e) => setStep(i, e.target.value)}
                  onInput=${(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                  ref=${(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} />
                <span className="step-btns">
                  <button title="Move up" disabled=${i === 0} onClick=${() => moveStep(i, -1)}>↑</button>
                  <button title="Move down" disabled=${i === steps.length - 1} onClick=${() => moveStep(i, 1)}>↓</button>
                  <button title="Delete this step" onClick=${() => removeStep(i)}>✕</button>
                </span>
              </li>`)}
          </ol>
          <div className="step-add">
            <textarea value=${draft} rows="1" placeholder="add the next step…"
              onChange=${(e) => setDraft(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addStep(); } }} />
            <button className="btn" onClick=${addStep}>+ Step</button>
          </div>
        <//>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Cook mode                                                          */
/*  For following a recipe with your hands full: big type, tap a step   */
/*  to tick it off, nothing editable so you can't wreck the recipe by   */
/*  leaning on the screen, and the display kept awake.                  */
/* ------------------------------------------------------------------ */
function CookMode({ meal, onClose, timers, progress, setProgress, onFinished }) {
  const [wake, setWake] = useState("off");
  const lockRef = useRef(null);
  const steps = stepsOf(meal.instructions);
  const ingredients = meal.ingredients || [];

  /* Ticks are kept outside this component so walking away mid-recipe — which is
     most of cooking — doesn't wipe them. */
  const mine = progress[meal.id] || { done: {}, got: {} };
  const done = mine.done || {};
  const got = mine.got || {};
  const patch = (part) => setProgress((p) => ({
    ...p, [meal.id]: { ...(p[meal.id] || { done: {}, got: {} }), ...part, at: Date.now() },
  }));
  const toggleStep = (i) => patch({ done: { ...done, [i]: !done[i] } });
  const toggleGot = (i) => patch({ got: { ...got, [i]: !got[i] } });
  const resetTicks = () => setProgress((p) => ({ ...p, [meal.id]: { done: {}, got: {}, at: Date.now() } }));

  /* Keep the screen on. Not every browser has this — when it's missing we say
     so rather than pretending, because a screen that sleeps mid-recipe is
     exactly the annoyance this mode exists to remove. */
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      if (!navigator.wakeLock) { setWake("unsupported"); return; }
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) { l.release(); return; }
        lockRef.current = l;
        setWake("on");
        l.addEventListener("release", () => setWake("off"));
      } catch { setWake("failed"); }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible" && !cancelled) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { if (lockRef.current) lockRef.current.release(); } catch { /* already released */ }
      lockRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doneCount = steps.filter((_, i) => done[i]).length;
  const cover = coverOf(meal);

  const renderStep = (text) => Parser.splitByDurations(text).map((p, i) =>
    p.kind === "text"
      ? html`<span key=${i}>${p.text}</span>`
      : html`
        <button key=${i} className="time-chip" title=${"Start a " + p.label + " timer"}
          onClick=${(e) => { e.stopPropagation(); timers.start(p.seconds, p.label); }}>
          ⏱ ${p.text.trim()}
        </button>`);

  return html`
    <div className="cook">
      <header className="cook-top">
        <button className="btn cook-exit" onClick=${onClose}>✕ Close</button>
        <div className="cook-title">
          <b>${meal.name}</b>
          <span>${meal.device} · ${meal.prepTime} min${doneCount ? " · " + doneCount + " of " + steps.length + " done" : ""}</span>
        </div>
        ${cover && cover.src && html`<img className="cook-cover" src=${cover.src} alt="" />`}
      </header>

      <div className="cook-progress"><div style=${{ width: steps.length ? (doneCount / steps.length) * 100 + "%" : "0%" }}></div></div>

      <div className="cook-body">
        ${ingredients.length > 0 && html`
          <section className="cook-ing">
            <h3>Ingredients</h3>
            <div className="cook-ing-list">
              ${ingredients.map((ing, i) => html`
                <button key=${i} className=${"cook-ing-item" + (got[i] ? " got" : "")}
                  aria-pressed=${!!got[i]} onClick=${() => toggleGot(i)}>
                  <span className="chk-box">${got[i] ? "✓" : ""}</span>${ing}
                </button>`)}
            </div>
          </section>`}

        <section>
          <h3>Method</h3>
          ${steps.length === 0 && html`
            <p className="cook-empty">This meal has no steps yet. Add some on the meal page and they'll show up here.</p>`}
          <ol className="cook-steps">
            ${steps.map((s, i) => html`
              <li key=${i}>
                <div className=${"cook-step" + (done[i] ? " cook-done" : "")}
                  role="checkbox" tabIndex=${0} aria-checked=${!!done[i]}
                  aria-label=${"Step " + (i + 1)}
                  onClick=${() => toggleStep(i)}
                  onKeyDown=${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleStep(i); } }}>
                  <span className="cook-n">${done[i] ? "✓" : i + 1}</span>
                  <span className="cook-text">${renderStep(s)}</span>
                </div>
              </li>`)}
          </ol>
        </section>

        ${meal.notes && html`
          <section className="cook-notes"><h3>Notes</h3><p>${meal.notes}</p></section>`}

        <div className="cook-finish">
          <button className="btn btn-cook" onClick=${() => onFinished(meal.id)}>✓ I cooked this</button>
          <span className="hint">records today's date and clears the ticks</span>
          ${(doneCount > 0 || Object.values(got).some(Boolean)) && html`
            <button className="btn btn-ghost" onClick=${resetTicks}>clear ticks only</button>`}
        </div>

        <p className="cook-foot">
          Tap a step to tick it off. Tap a time to start a timer.
          ${wake === "on" ? " The screen is being kept awake." : ""}
          ${wake === "unsupported" ? " This browser can't keep the screen awake — you may want to lengthen its sleep timeout." : ""}
          ${wake === "failed" ? " Couldn't keep the screen awake on this device." : ""}
        </p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Meal detail                                                        */
/* ------------------------------------------------------------------ */
function MealDetail({ meal, update, onDelete, have, onPasteRecipe, onCook, onAddToShopping, inShopping, offerUndo }) {
  const [mode, setMode] = useState("view");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#D8341F");
  const [size, setSize] = useState(4);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);
  const pageRef = useRef(null);
  const boardRef = useRef(null);
  const cascade = useRef(0);
  const mealId = meal.id;
  const photos = meal.items.filter((i) => i.kind === "image" && i.src);

  /* Where a newly added thing should land: inside the dotted area, which is
     measured against the meal page because that's the item coordinate space. */
  const dropSpot = useCallback((w, h) => {
    const board = boardRef.current;
    const top = board ? board.offsetTop : 300;
    const width = board ? board.offsetWidth : 900;
    const n = (cascade.current = (cascade.current + 1) % 8);
    return {
      x: Math.max(8, Math.min(24 + n * 34, width - w - 8)),
      y: top + 24 + n * 26,
    };
  }, []);

  const addImages = useCallback(async (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy((b) => b + list.length);
    for (const f of list) {
      let key = null;
      try {
        const { blob, w, h } = await processImageFile(f);
        const itemId = uid();
        key = imgKey(mealId, itemId);
        pendingImages.add(key);
        await idb.put("images", blob, key);
        const boardW = boardRef.current ? boardRef.current.offsetWidth : 900;
        const scale = Math.min(1, Math.min(260, boardW - 32) / Math.max(w, h));
        const iw = Math.round(w * scale), ih = Math.round(h * scale);
        const { x, y } = dropSpot(iw, ih);
        update((m) => ({
          ...m,
          items: [...m.items, {
            id: itemId, kind: "image", src: urlFor(key, blob),
            x, y, w: iw, h: ih, parent: null,
          }],
        }));
      } catch { /* skip unreadable file */ }
      // Released on a timer, not straight away: the state update above still has
      // to be rendered before mealsRef — which the sweep reads — knows about it.
      finally { if (key) { const k = key; setTimeout(() => pendingImages.delete(k), 5000); } }
      setBusy((b) => b - 1);
    }
  }, [update, mealId, dropSpot]);

  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addImages]);

  const addNote = () => update((m) => {
    const boardW = boardRef.current ? boardRef.current.offsetWidth : 900;
    const w = Math.min(240, Math.max(140, boardW - 48));
    const { x, y } = dropSpot(w, 200);
    return { ...m, items: [...m.items, { id: uid(), kind: "note", x, y, w, h: 200, text: "", parent: null }] };
  });

  const addTable = () => update((m) => {
    const boardW = boardRef.current ? boardRef.current.offsetWidth : 900;
    const w = Math.min(380, Math.max(220, boardW - 48));
    const { x, y } = dropSpot(w, 190);
    return {
      ...m,
      items: [...m.items, {
        id: uid(), kind: "table", x, y, w, h: 190, parent: null,
        title: "Times & temps",
        headers: ["What", "°C", "Time"],
        rows: [["", "", ""], ["", "", ""], ["", "", ""]],
      }],
    };
  });

  const set = (k) => (e) => update((m) => ({ ...m, [k]: e.target.value }));

  return html`
    <div className="detail" ref=${pageRef}
      onDragOver=${(e) => { if (e.dataTransfer && e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop=${(e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addImages([...e.dataTransfer.files]);
      }}>
      <div className="fields">
        <div className="f-name">
          <input className="name-input" value=${meal.name} onChange=${set("name")} placeholder="Meal name" />
          <${Star} on=${meal.favorite} size=${24} onClick=${() => update((m) => ({ ...m, favorite: !m.favorite }))} />
        </div>
        <div className="main-label">Main preparation <span>— used in lists, search & sorting</span></div>
        <div className="f-row">
          <label>Type
            <select value=${meal.mealType} onChange=${set("mealType")}>
              ${MEAL_TYPES.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
            </select>
          </label>
          <label>Device
            <select value=${meal.device} onChange=${set("device")}>
              ${DEVICES.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
            </select>
          </label>
          <label>Prep time
            <span className="unit-wrap">
              <input type="number" inputMode="numeric" min="1" max="999" value=${meal.prepTime}
                onChange=${(e) => update((m) => ({ ...m, prepTime: Math.max(1, +e.target.value || 1) }))} /> min
            </span>
          </label>
          <label>Servings
            <span className="unit-wrap">
              <input type="number" inputMode="numeric" min="1" max="99" placeholder="—" value=${meal.servings ?? ""}
                onChange=${(e) => update((m) => ({ ...m, servings: e.target.value === "" ? null : Math.max(1, +e.target.value || 1) }))} />
            </span>
          </label>
          <label>Rating
            <span className="unit-wrap rate-wrap">
              <${StarRating} value=${meal.rating}
                onChange=${(v) => update((m) => ({ ...m, rating: v }))} />
              <input type="number" inputMode="decimal" min="1" max="10" step="0.1" value=${meal.rating}
                onChange=${(e) => update((m) => ({ ...m, rating: Math.min(10, Math.max(1, +e.target.value || 1)) }))} />
            </span>
          </label>
        </div>
        ${(meal.cookLog || []).length > 0 && html`
          <div className="cooked-line">🍽 ${cookedSummary(meal)}</div>`}

        <${Ingredients} list=${meal.ingredients || []} have=${have} servings=${meal.servings}
          onChange=${(ingredients) => update((m) => ({ ...m, ingredients }))}
          onScale=${(ingredients, servings) => {
            const before = { ingredients: meal.ingredients || [], servings: meal.servings };
            update((m) => ({ ...m, ingredients, servings: servings ?? m.servings }));
            offerUndo("Amounts rescaled.", () => update((m) => ({ ...m, ...before })));
          }} />

        <div className="variants">
          <div className="var-head">
            <span className="fg-label" style=${{ width: "auto" }}>Other preparations</span>
            <button className="btn btn-ghost" style=${{ padding: "2px 6px" }}
              onClick=${() => update((m) => ({
                ...m,
                variants: [...(m.variants || []), { id: uid(), device: m.device === "Oven" ? "Air fryer" : "Oven", prepTime: null, rating: null }],
              }))}>+ add preparation</button>
          </div>
          ${(meal.variants || []).length === 0 && html`
            <div className="var-empty">Same meal, different device? Add a preparation with its own prep time and rating — leave a field blank if you haven't tried it yet.</div>`}
          ${(meal.variants || []).map((v) => html`
            <div key=${v.id} className="var-row">
              <select value=${v.device}
                onChange=${(e) => update((m) => ({ ...m, variants: m.variants.map((x) => (x.id === v.id ? { ...x, device: e.target.value } : x)) }))}>
                ${DEVICES.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
              </select>
              <span className="unit-wrap">
                <input type="number" inputMode="numeric" min="1" max="999" placeholder="—" value=${v.prepTime ?? ""}
                  onChange=${(e) => update((m) => ({
                    ...m,
                    variants: m.variants.map((x) => (x.id === v.id ? { ...x, prepTime: e.target.value === "" ? null : Math.max(1, +e.target.value || 1) } : x)),
                  }))} /> min
              </span>
              <span className="unit-wrap">
                <input type="number" inputMode="decimal" min="1" max="10" step="0.1" placeholder="—" value=${v.rating ?? ""}
                  onChange=${(e) => update((m) => ({
                    ...m,
                    variants: m.variants.map((x) => (x.id === v.id ? { ...x, rating: e.target.value === "" ? null : Math.min(10, Math.max(1, +e.target.value || 1)) } : x)),
                  }))} /> / 10
              </span>
              <button className="btn var-main-btn" title="Swap this preparation with the main one"
                onClick=${() => update((m) => {
                  const cur = (m.variants || []).find((x) => x.id === v.id);
                  if (!cur) return m;
                  const demoted = { id: uid(), device: m.device, prepTime: m.prepTime, rating: m.rating };
                  return {
                    ...m,
                    device: cur.device ?? m.device,
                    prepTime: cur.prepTime ?? m.prepTime,
                    rating: cur.rating ?? m.rating,
                    variants: m.variants.map((x) => (x.id === v.id ? demoted : x)),
                  };
                })}>↑ make main</button>
              <button className="mini-x var-x"
                onClick=${() => update((m) => ({ ...m, variants: m.variants.filter((x) => x.id !== v.id) }))}>✕</button>
            </div>`)}
        </div>
      </div>

      <div className="toolbar">
        <button className="btn btn-cook" onClick=${onCook}>▶ Cook this</button>
        <div className="mode-seg">
          ${["view", "arrange", "draw"].map((mo) => html`
            <button key=${mo} className=${mode === mo ? "seg-on" : ""} onClick=${() => setMode(mo)}>
              ${mo === "view" ? "View" : mo === "arrange" ? "Arrange" : "Draw"}
            </button>`)}
        </div>
        <button className="btn" onClick=${() => fileRef.current.click()}>Upload photos</button>
        <input ref=${fileRef} type="file" accept="image/*" multiple style=${{ display: "none" }}
          onChange=${(e) => { addImages([...e.target.files]); e.target.value = ""; }} />
        <button className="btn" onClick=${addNote}>+ Notepad</button>
        <button className="btn" onClick=${addTable}>+ Table</button>
        <button className="btn" onClick=${onPasteRecipe}>⎘ Paste a recipe</button>
        <button className="btn" onClick=${() => onAddToShopping(meal.id)}
          disabled=${inShopping || !(meal.ingredients || []).length}
          title=${!(meal.ingredients || []).length ? "Add some ingredients first" : ""}>
          ${inShopping ? "✓ on the shopping list" : "🛒 Add to shopping list"}
        </button>
        ${busy > 0
          ? html`<span className="hint">adding ${busy} photo${busy > 1 ? "s" : ""}…</span>`
          : html`<span className="hint">…or paste / drop an image anywhere on this page</span>`}

        ${mode === "draw" && html`
          <div className="draw-tools">
            ${[["pen", "✎ pen"], ["line", "∕ line"], ["arrow", "→ arrow"], ["rect", "▭ box"], ["ellipse", "◯ circle"], ["highlight", "▮ highlight"]]
              .map(([t, l]) => html`
                <button key=${t} className=${"tool" + (tool === t ? " tool-on" : "")} onClick=${() => setTool(t)}>${l}</button>`)}
            <button className="tool color-tool" onClick=${() => setWheelOpen((o) => !o)}>
              <span className="dot" style=${{ background: color }}></span> color
            </button>
            <label className="sizer">size
              <input type="range" min="2" max="24" value=${size} onChange=${(e) => setSize(+e.target.value)} />
            </label>
            <button className="tool" onClick=${() => update((m) => ({ ...m, strokes: m.strokes.slice(0, -1) }))}>↩ undo</button>
            <button className="tool" disabled=${!meal.strokes.length}
              onClick=${() => {
                const kept = meal.strokes;
                update((m) => ({ ...m, strokes: [] }));
                offerUndo("Cleared " + kept.length + " drawing" + (kept.length === 1 ? "" : "s") + ".",
                  () => update((m) => ({ ...m, strokes: kept })));
              }}>clear drawings</button>
            ${wheelOpen && html`
              <div className="wheel-pop">
                <${ColorWheel} color=${color} onChange=${setColor} />
              </div>`}
          </div>`}
        ${mode === "arrange" && html`
          <span className="hint">drag anything anywhere on the page · corner handle resizes · drop onto a notepad and it sticks</span>`}
        ${mode === "view" && html`
          <span className="hint">switch to Arrange to move photos, pads and tables around the page</span>`}
      </div>

      <div ref=${boardRef} className="board" style=${{ minHeight: meal.boardH }}>
        <${Steps} instructions=${meal.instructions}
          onChange=${(instructions) => update((m) => ({ ...m, instructions }))} />
        ${meal.items.length === 0 && meal.strokes.length === 0 && html`
          <div className="board-hint">Photos, notepads and tables land on this page and can be dragged
            anywhere — including over the fields above. Paste, drop or upload one to start.</div>`}
      </div>
      <button className="btn btn-ghost" onClick=${() => update((m) => ({ ...m, boardH: m.boardH + 320 }))}>+ more space</button>

      <h3 className="sec-h">Notes</h3>
      <textarea className="instructions" value=${meal.notes || ""} onChange=${set("notes")}
        placeholder=${"Anything that isn't a step — what to serve it with, what to change next time, who liked it."} />

      <div className="danger-zone">
        <button className="btn btn-danger" onClick=${onDelete}>Delete this meal</button>
        <span className="hint">a backup is taken first, so it can be brought back</span>
      </div>

      <${PageCanvas} meal=${meal} mode=${mode} draw=${{ tool, color, size }} update=${update} pageRef=${pageRef}
        onViewPhoto=${(id) => setLightbox(Math.max(0, photos.findIndex((p) => p.id === id)))} />

      ${lightbox !== null && html`
        <${Lightbox} photos=${photos} index=${lightbox} onIndex=${setLightbox} onClose=${() => setLightbox(null)} />`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Paste-a-recipe                                                     */
/* ------------------------------------------------------------------ */
function RecipePaste({ onClose, onCreate, onFill, openMealName }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const taRef = useRef(null);

  useEffect(() => { if (taRef.current) taRef.current.focus(); }, []);

  const run = () => {
    const p = Parser.parseRecipe(text);
    if (!p) return;
    setParsed(p);
  };
  const patch = (k, v) => setParsed((p) => ({ ...p, [k]: v }));

  return html`
    <div className="modal-back" onPointerDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Paste a recipe</h3>
          <button className="mini-x" onClick=${onClose}>✕</button>
        </div>

        ${!parsed ? html`
          <${Frag}>
            <p className="sub">
              Copy the recipe text from the page you're reading and paste it here — the whole lot,
              headings and all. This works offline by spotting patterns, not by understanding the
              recipe, so check what it worked out before you keep it. Pasting a <b>link</b> won't
              work; browsers don't let one site read another.
            </p>
            <textarea ref=${taRef} className="paste-box" value=${text} placeholder=${"Paste the recipe here…"}
              onChange=${(e) => setText(e.target.value)} />
            <div className="modal-btns">
              <button className="btn btn-primary" disabled=${!text.trim()} onClick=${run}>Sort it out →</button>
              <button className="btn" onClick=${onClose}>Cancel</button>
            </div>
          <//>`
        : html`
          <${Frag}>
            <p className="sub">
              Here's what it made of that${parsed.usedHeadings ? " — it found proper Ingredients/Method headings, so this should be close" : " — no headings found, so it guessed line by line; check it carefully"}.
              Everything below is editable.
            </p>
            <div className="rp-grid">
              <label>Name<input value=${parsed.name} onChange=${(e) => patch("name", e.target.value)} /></label>
              <label>Type
                <select value=${parsed.mealType} onChange=${(e) => patch("mealType", e.target.value)}>
                  ${MEAL_TYPES.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
                </select>
              </label>
              <label>Device
                <select value=${parsed.device} onChange=${(e) => patch("device", e.target.value)}>
                  ${DEVICES.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
                </select>
              </label>
              <label>Prep time
                <span className="unit-wrap">
                  <input type="number" min="1" value=${parsed.prepTime}
                    onChange=${(e) => patch("prepTime", Math.max(1, +e.target.value || 1))} /> min
                </span>
              </label>
              <label>Temperature
                <span className="unit-wrap">
                  <input type="number" placeholder="—" value=${parsed.temp ?? ""}
                    onChange=${(e) => patch("temp", e.target.value === "" ? null : +e.target.value)} /> °C
                  ${parsed.tempFrom === "F" && html`<span className="hint">converted from °F</span>`}
                  ${parsed.tempFrom === "gas" && html`<span className="hint">from gas mark</span>`}
                </span>
              </label>
              ${parsed.servings && html`<label>Serves<input readOnly value=${parsed.servings} /></label>`}
            </div>

            <div className="rp-cols">
              <div>
                <div className="fg-label">Ingredients (${parsed.ingredients.length})</div>
                <textarea className="rp-list" value=${parsed.ingredients.join("\n")}
                  onChange=${(e) => patch("ingredients", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
              </div>
              <div>
                <div className="fg-label">Steps (${parsed.steps.length})</div>
                <textarea className="rp-list" value=${parsed.steps.join("\n")}
                  onChange=${(e) => patch("steps", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
              </div>
            </div>
            ${(!parsed.ingredients.length || !parsed.steps.length) && html`
              <div className="rp-warn">
                ${!parsed.ingredients.length ? "No ingredients were recognised. " : ""}
                ${!parsed.steps.length ? "No steps were recognised. " : ""}
                Move lines between the two boxes above, or go back and paste a bit more of the page.
              </div>`}

            <div className="modal-btns">
              <button className="btn btn-primary" onClick=${() => onCreate(parsed)}>Create a new meal</button>
              ${openMealName && html`
                <button className="btn" onClick=${() => onFill(parsed)}>Fill “${openMealName}” instead</button>`}
              <button className="btn" onClick=${() => setParsed(null)}>← Back to the text</button>
              <button className="btn" onClick=${onClose}>Cancel</button>
            </div>
          <//>`}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Temps & times                                                      */
/* ------------------------------------------------------------------ */
const cell = (v) => (v ? (v[0] ? v[0] + " °C · " + v[1] : v[1]) : "—");

function TempsTab({ meals, onInsert, customTemps, setCustomTemps }) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState({ food: "", oven: "", air: "", pan: "" });

  const needle = q.trim().toLowerCase();
  const groups = COOK_TEMPS
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !needle || r.food.toLowerCase().includes(needle)) }))
    .filter((g) => g.rows.length);

  const insertRows = (title, rows) => {
    if (!target) return;
    onInsert(target, {
      title,
      headers: ["Food", "Oven", "Air fryer", "Pan / hob"],
      rows: rows.map((r) => [r.food, cell(r.oven), cell(r.air), cell(r.pan)]),
    });
  };

  const addCustom = () => {
    if (!draft.food.trim()) return;
    setCustomTemps([...customTemps, { ...draft, id: uid() }]);
    setDraft({ food: "", oven: "", air: "", pan: "" });
  };

  return html`
    <div>
      <h3 className="sec-h">Temps & times</h3>
      <p className="sub">
        Everything in °C, for a preheated oven or air fryer. Times suit an average-sized piece of
        whatever it is — treat them as a solid starting point and write your own version underneath
        once you know better. Fan ovens: knock about 20 °C off.
      </p>

      <div className="temp-controls">
        <input className="temp-search" value=${q} placeholder="search foods…" onChange=${(e) => setQ(e.target.value)} />
        <label className="sortsel">Insert into
          <select value=${target} onChange=${(e) => setTarget(e.target.value)}>
            <option value="">— pick a meal —</option>
            ${meals.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
          </select>
        </label>
        ${!meals.length && html`<span className="hint">create a meal first to insert tables into it</span>`}
      </div>

      ${groups.map((g) => html`
        <div key=${g.group} className="panel temp-panel">
          <div className="temp-head">
            <h4>${g.group}</h4>
            <button className="btn btn-ghost" disabled=${!target}
              onClick=${() => insertRows(g.group + " — times & temps", g.rows)}>insert this table</button>
          </div>
          <div className="table-scroll">
            <table className="temp-table">
              <thead><tr><th>Food</th><th>Oven</th><th>Air fryer</th><th>Pan / hob</th><th></th></tr></thead>
              <tbody>
                ${g.rows.map((r) => html`
                  <tr key=${r.food}>
                    <td className="tt-food">${r.food}</td>
                    <td>${cell(r.oven)}</td>
                    <td>${cell(r.air)}</td>
                    <td>${cell(r.pan)}</td>
                    <td className="tt-ins">
                      <button title="Insert just this row" disabled=${!target}
                        onClick=${() => insertRows(r.food, [r])}>insert</button>
                    </td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>`)}
      ${!groups.length && html`<p className="sub">Nothing matches “${q}”.</p>`}

      <h3 className="sec-h">Your own</h3>
      <div className="panel temp-panel">
        <div className="table-scroll">
          <table className="temp-table">
            <thead><tr><th>Food</th><th>Oven</th><th>Air fryer</th><th>Pan / hob</th><th></th></tr></thead>
            <tbody>
              ${customTemps.map((r, i) => html`
                <tr key=${r.id}>
                  ${["food", "oven", "air", "pan"].map((k) => html`
                    <td key=${k}>
                      <input value=${r[k] || ""}
                        onChange=${(e) => setCustomTemps(customTemps.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                    </td>`)}
                  <td className="tt-ins">
                    <button onClick=${() => setCustomTemps(customTemps.filter((_, j) => j !== i))}>remove</button>
                  </td>
                </tr>`)}
              <tr>
                ${["food", "oven", "air", "pan"].map((k) => html`
                  <td key=${k}>
                    <input value=${draft[k]} placeholder=${k === "food" ? "food…" : "200 °C · 20 min"}
                      onChange=${(e) => setDraft({ ...draft, [k]: e.target.value })}
                      onKeyDown=${(e) => { if (e.key === "Enter") addCustom(); }} />
                  </td>`)}
                <td className="tt-ins"><button onClick=${addCustom}>add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        ${customTemps.length > 0 && target && html`
          <button className="btn btn-ghost"
            onClick=${() => insertRows("My times & temps", customTemps.map((r) => ({
              food: r.food, oven: [null, r.oven], air: [null, r.air], pan: [null, r.pan],
            })))}>insert my table</button>`}
      </div>

      <h3 className="sec-h">Cooked all the way through</h3>
      <p className="sub">Internal temperature at the thickest part. The poultry, pork and mince rows are the ones that matter for safety.</p>
      <div className="panel temp-panel">
        <div className="table-scroll">
          <table className="temp-table">
            <thead><tr><th>Food</th><th>Internal</th><th></th></tr></thead>
            <tbody>
              ${DONENESS.map((d) => html`
                <tr key=${d.food}><td className="tt-food">${d.food}</td><td><b>${d.temp}</b></td><td className="tt-note">${d.note}</td></tr>`)}
            </tbody>
          </table>
        </div>
        <button className="btn btn-ghost" disabled=${!target}
          onClick=${() => onInsert(target, {
            title: "Cooked-through temperatures",
            headers: ["Food", "Internal", "Note"],
            rows: DONENESS.map((d) => [d.food, d.temp, d.note]),
          })}>insert this table</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  What can I cook?                                                   */
/* ------------------------------------------------------------------ */
/* Which aisle an ingredient belongs to, worked out from the pantry catalogue.
   Anything unrecognised goes to the bottom under "Other". */
function aisleOf(name) {
  const keys = matchKeys(Parser.ingredientKey(name) || name).filter((k) => k && k.length >= 3);
  /* Exact names first. Without this "tomato puree" is filed under Vegetables,
     because it contains "tomato" and that group is listed earlier. */
  for (const g of PANTRY_GROUPS) {
    for (const item of g.items) if (keys.includes(item)) return g.group;
  }
  for (const g of PANTRY_GROUPS) {
    for (const item of g.items) {
      for (const k of keys) if (k.includes(item) || item.includes(k)) return g.group;
    }
  }
  return "Other";
}

/* Local yyyy-mm-dd. Deliberately not toISOString, which converts to UTC and can
   put an evening meal on the wrong day. */
const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
  "-" + String(d.getDate()).padStart(2, "0");
function weekStart(offsetWeeks) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;                 // Monday = 0
  d.setDate(d.getDate() - dow + offsetWeeks * 7);
  return d;
}

function WeekPlan({ meals, plan, setPlan, onOpen, onCook, onSendToShopping }) {
  const [week, setWeek] = useState(0);
  const [adding, setAdding] = useState(null);       // the day key being added to
  const start = weekStart(week);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i); return d;
  });
  const today = dayKey(new Date());
  const byId = new Map(meals.map((m) => [m.id, m]));

  const label = start.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " – " +
    days[6].toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const add = (key, id) => {
    setPlan((p) => ({ ...p, [key]: [...(p[key] || []), id] }));
    setAdding(null);
  };
  const remove = (key, i) => setPlan((p) => ({ ...p, [key]: (p[key] || []).filter((_, j) => j !== i) }));

  const weekMealIds = [...new Set(days.flatMap((d) => plan[dayKey(d)] || []))].filter((id) => byId.has(id));

  return html`
    <${Frag}>
      <div className="plan-head">
        <h3 className="sec-h" style=${{ margin: 0 }}>Week plan</h3>
        <div className="plan-nav">
          <button className="btn" onClick=${() => setWeek((w) => w - 1)} aria-label="Previous week">←</button>
          <span>${week === 0 ? "This week" : week === 1 ? "Next week" : week === -1 ? "Last week" : label}</span>
          <button className="btn" onClick=${() => setWeek((w) => w + 1)} aria-label="Next week">→</button>
          ${week !== 0 && html`<button className="btn btn-ghost" onClick=${() => setWeek(0)}>today</button>`}
        </div>
      </div>
      <p className="sub">${label} · plan what you're cooking, then send the whole week to the shopping list.</p>

      ${meals.length === 0
        ? html`<p className="sub">Add some meals first and they'll be pickable here.</p>`
        : html`
          <${Frag}>
            <div className="plan-grid">
              ${days.map((d) => {
                const key = dayKey(d);
                const ids = plan[key] || [];
                return html`
                  <div key=${key} className=${"plan-day" + (key === today ? " plan-today" : "")}>
                    <div className="plan-date">
                      <b>${d.toLocaleDateString(undefined, { weekday: "short" })}</b>
                      <span>${d.getDate()}</span>
                    </div>
                    ${ids.map((id, i) => {
                      const m = byId.get(id);
                      if (!m) return null;
                      return html`
                        <div key=${i} className="plan-meal">
                          <button className="plan-name" onClick=${() => onOpen(id)} title=${m.name}>${m.name}</button>
                          <button className="plan-cook" title=${"Cook " + m.name} onClick=${() => onCook(id)}>▶</button>
                          <button className="plan-x" title="Remove" onClick=${() => remove(key, i)}>✕</button>
                        </div>`;
                    })}
                    ${adding === key
                      ? html`
                        <select className="plan-pick" autoFocus size="1"
                          onChange=${(e) => e.target.value && add(key, e.target.value)}
                          onBlur=${() => setAdding(null)}>
                          <option value="">choose a meal…</option>
                          ${meals.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
                        </select>`
                      : html`<button className="plan-add" onClick=${() => setAdding(key)}>+ add</button>`}
                  </div>`;
              })}
            </div>

            <div className="plan-foot">
              <button className="btn btn-primary" disabled=${!weekMealIds.length}
                onClick=${() => onSendToShopping(weekMealIds)}>
                Send ${weekMealIds.length || ""} meal${weekMealIds.length === 1 ? "" : "s"} to the shopping list
              </button>
              ${weekMealIds.length > 0 && html`
                <button className="btn" onClick=${() => {
                  setPlan((p) => { const next = { ...p }; days.forEach((d) => delete next[dayKey(d)]); return next; });
                }}>Clear this week</button>`}
            </div>
          <//>`}
    <//>`;
}

function ShoppingList({ meals, pantry, shopping, setShopping }) {
  const [extra, setExtra] = useState("");
  const chosen = shopping.mealIds || [];
  const ticked = shopping.ticked || {};

  const have = useMemo(() => {
    const s = new Set();
    for (const k of Object.keys(pantry.have || {})) if (pantry.have[k]) matchKeys(k).forEach((x) => s.add(x));
    return s;
  }, [pantry]);

  const toggleMeal = (id) => setShopping((s) => ({
    ...s,
    mealIds: (s.mealIds || []).includes(id)
      ? (s.mealIds || []).filter((x) => x !== id)
      : [...(s.mealIds || []), id],
  }));

  /* One line per thing to buy, remembering which meals wanted it — seeing
     "onion — carbonara, chilli" is the difference between buying one and
     buying enough. */
  const list = useMemo(() => {
    const byKey = new Map();
    for (const id of chosen) {
      const meal = meals.find((m) => m.id === id);
      if (!meal) continue;
      for (const raw of meal.ingredients || []) {
        const key = normalize(Parser.ingredientKey(raw) || raw);
        if (!key) continue;
        if (pantryHas(have, raw) || isStaple(key)) continue;
        const hit = byKey.get(key) || { key, name: raw, amounts: [], forMeals: [], aisle: aisleOf(raw) };
        if (!hit.forMeals.includes(meal.name)) hit.forMeals.push(meal.name);
        hit.amounts.push(raw);
        byKey.set(key, hit);
      }
    }
    for (const x of shopping.extra || []) {
      const key = normalize(x);
      if (!byKey.has(key)) byKey.set(key, { key, name: x, forMeals: [], aisle: aisleOf(x), manual: true });
    }
    /* Two meals wanting "250 g potatoes" and "500 g potatoes" can't be added up
       from free text, and showing just one of them would be a lie about how much
       to buy. One source keeps its amount; several fall back to the bare name
       with the amounts listed after it. */
    const groups = new Map();
    for (const item of byKey.values()) {
      const distinct = [...new Set(item.amounts || [])];
      if (distinct.length > 1) {
        item.name = item.key;
        item.note = distinct.join(" + ");
      }
      if (!groups.has(item.aisle)) groups.set(item.aisle, []);
      groups.get(item.aisle).push(item);
    }
    const order = PANTRY_GROUPS.map((g) => g.group).concat("Other");
    return [...groups.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([aisle, items]) => [aisle, items.sort((a, b) => a.name.localeCompare(b.name))]);
  }, [chosen, meals, have, shopping.extra]);

  const total = list.reduce((n, [, items]) => n + items.length, 0);
  const left = list.reduce((n, [, items]) => n + items.filter((i) => !ticked[i.key]).length, 0);

  const addExtra = () => {
    const parts = extra.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setShopping((s) => ({ ...s, extra: [...new Set([...(s.extra || []), ...parts])] }));
    setExtra("");
  };
  const asText = () => list.map(([aisle, items]) =>
    aisle + "\n" + items.map((i) => (ticked[i.key] ? "[x] " : "[ ] ") + i.name).join("\n")).join("\n\n");

  return html`
    <${Frag}>
      <h3 className="sec-h">Pick the meals you're cooking</h3>
      <p className="sub">
        Anything already ticked in your pantry is left off the list, as are staples like salt and oil.
      </p>
      ${meals.length === 0
        ? html`<p className="sub">No meals yet — add some first.</p>`
        : html`
          <div className="shop-picker">
            ${meals.map((m) => html`
              <${Check} key=${m.id} on=${chosen.includes(m.id)} onClick=${() => toggleMeal(m.id)}>${m.name}<//>`)}
          </div>`}

      <div className="shop-head">
        <h3 className="sec-h" style=${{ margin: 0 }}>
          Shopping list ${total > 0 ? html`<span className="count">(${left} of ${total} left)</span>` : ""}
        </h3>
        ${total > 0 && html`
          <div className="store-btns" style=${{ marginLeft: "auto" }}>
            <button className="btn" onClick=${() => { navigator.clipboard?.writeText(asText()); }}>Copy as text</button>
            <button className="btn" onClick=${() => setShopping((s) => ({ ...s, ticked: {} }))}>Untick all</button>
            <button className="btn" onClick=${() => setShopping({ mealIds: [], ticked: {}, extra: [] })}>Start over</button>
          </div>`}
      </div>

      <div className="shop-add">
        <input value=${extra} placeholder="add something else — comma-separated is fine"
          onChange=${(e) => setExtra(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }} />
        <button className="btn" onClick=${addExtra}>Add</button>
      </div>

      ${total === 0
        ? html`<p className="sub">
            ${chosen.length
              ? "Nothing to buy — you already have everything for those meals."
              : "Tick a meal above, or add something by hand, and the list builds itself."}
          </p>`
        : html`
          <div className="shop-list">
            ${list.map(([aisle, items]) => html`
              <div key=${aisle} className="shop-aisle">
                <h4>${aisle}</h4>
                ${items.map((i) => html`
                  <button key=${i.key} className=${"shop-item" + (ticked[i.key] ? " shop-got" : "")}
                    onClick=${() => setShopping((s) => ({ ...s, ticked: { ...s.ticked, [i.key]: !(s.ticked || {})[i.key] } }))}>
                    <span className="chk-box">${ticked[i.key] ? "✓" : ""}</span>
                    <span className="shop-name">
                      ${i.name}
                      ${i.note && html`<span className="shop-amt"> (${i.note})</span>`}
                    </span>
                    ${i.forMeals.length > 0
                      ? html`<span className="shop-for">${i.forMeals.join(", ")}</span>`
                      : html`<span className="shop-for">added by hand</span>`}
                    ${i.manual && html`
                      <span className="shop-x" onClick=${(e) => {
                        e.stopPropagation();
                        setShopping((s) => ({ ...s, extra: (s.extra || []).filter((x) => normalize(x) !== i.key) }));
                      }}>✕</span>`}
                  </button>`)}
              </div>`)}
          </div>`}
    <//>`;
}

function PantryTab({ meals, pantry, setPantry, onOpen, onAddStarter, shopping, setShopping,
                     plan, setPlan, onCook }) {
  const [tab, setTab] = useState("suggest");
  const [draft, setDraft] = useState("");
  const [onlyComplete, setOnlyComplete] = useState(false);

  const have = useMemo(() => {
    const s = new Set();
    for (const k of Object.keys(pantry.have || {})) if (pantry.have[k]) matchKeys(k).forEach((x) => s.add(x));
    return s;
  }, [pantry]);

  /* Functional updates throughout: ticking several things quickly must not have
     each click overwrite the one before it from a stale copy of the pantry. */
  const toggle = (name) => setPantry((p) => ({ ...p, have: { ...p.have, [name]: !p.have[name] } }));
  const addCustom = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setPantry((p) => {
      const haveNext = { ...p.have };
      parts.forEach((x) => { haveNext[x] = true; });
      return { ...p, custom: [...new Set([...(p.custom || []), ...parts])], have: haveNext };
    });
    setDraft("");
  };
  const removeCustom = (name) => setPantry((p) => {
    const haveNext = { ...p.have }; delete haveNext[name];
    return { ...p, custom: (p.custom || []).filter((c) => c !== name), have: haveNext };
  });

  const haveCount = Object.values(pantry.have || {}).filter(Boolean).length;

  const suggestions = useMemo(() => {
    const mine = meals
      .filter((m) => (m.ingredients || []).length)
      .map((m) => ({ id: m.id, name: m.name, mealType: m.mealType, device: m.device, prepTime: m.prepTime,
        rating: m.rating, ingredients: m.ingredients, mine: true }));

    /* Once you've added a built-in recipe it becomes your meal, and showing the
       original alongside it looks exactly like a duplicate. Matched by where the
       meal came from, and by name as well so meals added before this existed
       aren't listed twice either. */
    const adopted = new Set();
    const names = new Set();
    for (const m of meals) {
      if (m.fromStarter) adopted.add(m.fromStarter);
      names.add(normalize(m.name));
    }
    const starters = STARTER_MEALS
      .filter((r) => !adopted.has(r.id) && !names.has(normalize(r.name)))
      .map((r) => ({ ...r, mine: false }));

    const pool = [...mine, ...starters];
    return pool
      .map((r) => ({ recipe: r, score: scoreRecipe(r, have) }))
      .filter((x) => x.score)
      .filter((x) => !onlyComplete || x.score.missing.length === 0)
      .sort((a, b) =>
        a.score.missing.length - b.score.missing.length ||
        b.score.pct - a.score.pct ||
        (b.recipe.rating || 0) - (a.recipe.rating || 0))
      .slice(0, 40);
  }, [meals, have, onlyComplete]);

  const canCookNow = suggestions.filter((s) => s.score.missing.length === 0).length;

  return html`
    <div>
      <div className="pantry-tabs">
        <button className=${tab === "suggest" ? "seg-on" : ""} onClick=${() => setTab("suggest")}>Suggest a meal</button>
        <button className=${tab === "pantry" ? "seg-on" : ""} onClick=${() => setTab("pantry")}>My pantry (${haveCount})</button>
        <button className=${tab === "plan" ? "seg-on" : ""} onClick=${() => setTab("plan")}>Week plan</button>
        <button className=${tab === "shop" ? "seg-on" : ""} onClick=${() => setTab("shop")}>Shopping list</button>
      </div>

      ${tab === "plan" ? html`
        <${WeekPlan} meals=${meals} plan=${plan} setPlan=${setPlan} onOpen=${onOpen} onCook=${onCook}
          onSendToShopping=${(ids) => { setShopping((s) => ({ ...s, mealIds: ids })); setTab("shop"); }} />`
      : tab === "shop" ? html`
        <${ShoppingList} meals=${meals} pantry=${pantry} shopping=${shopping} setShopping=${setShopping} />`
      : tab === "pantry" ? html`
        <${Frag}>
          <h3 className="sec-h">What have you got in?</h3>
          <p className="sub">Tick everything you have. Salt, pepper, oil, flour, sugar, onion and garlic are assumed — no need to tick those unless you like.</p>
          <div className="pantry-add">
            <input value=${draft} placeholder="add your own — comma-separated is fine"
              onChange=${(e) => setDraft(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
            <button className="btn btn-primary" onClick=${addCustom}>Add</button>
            ${haveCount > 0 && html`
              <button className="btn" onClick=${() => setPantry((p) => ({ ...p, have: {} }))}>Untick everything</button>`}
          </div>
          ${(pantry.custom || []).length > 0 && html`
            <div className="fgroup">
              <span className="fg-label">Mine</span>
              ${(pantry.custom || []).map((c) => html`
                <span key=${c} className=${"ing-chip" + (pantry.have[c] ? " ing-have" : "")}>
                  <button className="ing-tog" onClick=${() => toggle(c)}>${pantry.have[c] ? "✓ " : ""}${c}</button>
                  <button onClick=${() => removeCustom(c)}>✕</button>
                </span>`)}
            </div>`}
          ${PANTRY_GROUPS.map((g) => html`
            <div key=${g.group} className="fgroup pantry-group">
              <span className="fg-label">${g.group}</span>
              ${g.items.map((i) => html`
                <${Chip} key=${i} active=${!!pantry.have[i]} onClick=${() => toggle(i)}>${i}<//>`)}
            </div>`)}
        <//>`
      : html`
        <${Frag}>
          <h3 className="sec-h">What can I cook?</h3>
          ${haveCount === 0 ? html`
            <p className="sub">
              Your pantry is empty, so this is showing everything. Open <b>My pantry</b> and tick what you
              actually have — then this list reorders itself around what you can cook right now.
            </p>`
          : html`
            <p className="sub">
              Based on ${haveCount} thing${haveCount === 1 ? "" : "s"} in your pantry.
              ${canCookNow > 0 ? " You can cook " + canCookNow + " of these right now." : " Nothing's a complete match yet — the closest are first."}
            </p>`}
          <div className="fgroup" style=${{ marginBottom: 10 }}>
            <${Chip} active=${onlyComplete} onClick=${() => setOnlyComplete((v) => !v)}>Only what I can cook now<//>
          </div>

          ${suggestions.length === 0 && html`
            <p className="sub">Nothing to suggest yet. Add ingredients to your own meals, or untick the filter above.</p>`}

          <div className="sugg-list">
            ${suggestions.map(({ recipe, score }) => html`
              <div key=${recipe.id} className=${"sugg" + (score.missing.length === 0 ? " sugg-ready" : "")}>
                <div className="sugg-top">
                  <span className="sugg-name">${recipe.name}</span>
                  <span className=${"sugg-pct" + (score.missing.length === 0 ? " pct-full" : "")}>${score.pct}%</span>
                </div>
                <div className="card-meta">
                  ${recipe.mealType} · ${recipe.device} · ${recipe.prepTime} min
                  ${recipe.mine ? html`<span className="var-tag"> · your meal</span>` : html`<span className="hint"> · built-in recipe</span>`}
                </div>
                ${score.missing.length === 0
                  ? html`<div className="sugg-ok">You have everything.</div>`
                  : html`<div className="sugg-miss">Missing: ${score.missing.join(", ")}</div>`}
                <div className="sugg-btns">
                  ${recipe.mine
                    ? html`<button className="btn btn-ghost" onClick=${() => onOpen(recipe.id)}>Open meal →</button>`
                    : html`<button className="btn btn-ghost" onClick=${() => onAddStarter(recipe)}>Add to my meals →</button>`}
                </div>
              </div>`)}
          </div>
        <//>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Backups                                                            */
/* ------------------------------------------------------------------ */
function BackupsPanel({ backups, onCreate, onRestore, onDelete, busy, signedIn }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState(null);

  const when = (t) => {
    const d = new Date(t);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  const byCode = () => {
    const c = code.trim();
    const hit = backups.find((b) => b.code === c);
    if (!hit) return;
    setConfirm(hit); setCode("");
  };

  return html`
    <div className="panel cloud">
      <div className="cloud-head">${signedIn ? "Backups" : "Backups in this browser"}</div>
      <p className="sub" style=${{ margin: "0 0 8px" }}>
        Snapshots of your whole cookbook — each one gets a 4-digit code you can type in to bring it back.
        ${signedIn
          ? html`<${Frag}> They travel with your account, so a code made on one device works on the others
              once both have synced. Photos come back too, as long as the meal still exists in the cloud. </>`
          : html`<${Frag}> <b>These stay on this device</b> — a code made here won't work on your phone.
              To move a cookbook between devices, use <b>Download backup</b> and <b>Restore from backup
              file</b>, or turn on cloud sync below. </>`}
        Either way a <b>downloaded backup file</b> is the copy that survives anything.
      </p>
      <div className="store-btns" style=${{ marginLeft: 0, marginBottom: 10 }}>
        <span className="mk-backup">
          <input className="bk-label" value=${label} maxLength="40" placeholder="what's this backup for? (optional)"
            onChange=${(e) => setLabel(e.target.value)}
            onKeyDown=${(e) => { if (e.key === "Enter") { onCreate(label.trim()); setLabel(""); } }} />
          <button className="btn btn-primary" disabled=${busy}
            onClick=${() => { onCreate(label.trim()); setLabel(""); }}>Create a backup now</button>
        </span>
        <span className="code-entry">
          <input value=${code} inputMode="numeric" maxLength="4" placeholder="code"
            onChange=${(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown=${(e) => { if (e.key === "Enter") byCode(); }} />
          <button className="btn" disabled=${code.trim().length !== 4} onClick=${byCode}>Restore by code</button>
        </span>
      </div>

      ${backups.length === 0
        ? html`<p className="sub" style=${{ margin: 0 }}>No snapshots yet. One is taken automatically the first time you save on a new day.</p>`
        : html`
          <div className="table-scroll">
            <table className="bk-table">
              <thead><tr><th>Code</th><th>Taken</th><th>Meals</th><th>Photos</th><th>Why</th><th></th></tr></thead>
              <tbody>
                ${backups.map((b) => html`
                  <tr key=${b.code}>
                    <td><span className="bk-code">${b.code}</span></td>
                    <td>${when(b.at)}</td>
                    <td>${b.mealCount}</td>
                    <td>${b.photoCount}</td>
                    <td className="tt-note">${b.label || "manual"}</td>
                    <td className="tt-ins">
                      <button onClick=${() => setConfirm(b)}>restore</button>
                      <button onClick=${() => onDelete(b.code)}>delete</button>
                    </td>
                  </tr>`)}
              </tbody>
            </table>
          </div>`}

      ${confirm && html`
        <div className="modal-back" onPointerDown=${(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="modal modal-sm">
            <div className="modal-head"><h3>Restore backup ${confirm.code}?</h3></div>
            <p className="sub">
              ${"This replaces your current cookbook with the " + confirm.mealCount +
                (confirm.mealCount === 1 ? " meal" : " meals") + " saved on " + when(confirm.at) + ". "}
              A snapshot of what you have right now is taken first, so this is reversible.
            </p>
            <div className="modal-btns">
              <button className="btn btn-primary" onClick=${() => { const c = confirm; setConfirm(null); onRestore(c); }}>Restore it</button>
              <button className="btn" onClick=${() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Background picker                                                  */
/* ------------------------------------------------------------------ */
const BG_KEY = "__background__";

function BackgroundPanel({ background, setBackground, customUrl, onUploadCustom, onClearCustom, busy }) {
  const fileRef = useRef(null);
  return html`
    <div className="panel cloud">
      <div className="cloud-head">Page background</div>
      <p className="sub" style=${{ margin: "0 0 10px" }}>
        Applies everywhere and is remembered between visits. All of these are pale on purpose —
        the writing is dark, so a dark background would be hard to read.
      </p>
      <div className="bg-grid">
        ${BACKGROUNDS.map((b) => html`
          <button key=${b.id} title=${b.label}
            className=${"bg-sw" + (background.id === b.id && !background.custom ? " bg-on" : "")}
            style=${{ background: b.css }}
            onClick=${() => setBackground({ id: b.id, custom: false })}>
            <span className="bg-label">${b.label}</span>
          </button>`)}
        ${customUrl && html`
          <button title="Your picture"
            className=${"bg-sw" + (background.custom ? " bg-on" : "")}
            style=${{ backgroundImage: "url(" + customUrl + ")", backgroundSize: "cover", backgroundPosition: "center" }}
            onClick=${() => setBackground({ id: "custom", custom: true })}>
            <span className="bg-label">Your picture</span>
          </button>`}
      </div>
      <div className="store-btns" style=${{ marginLeft: 0, marginTop: 10 }}>
        <button className="btn" disabled=${busy} onClick=${() => fileRef.current.click()}>
          ${customUrl ? "Replace my picture" : "Use my own picture"}
        </button>
        ${customUrl && html`<button className="btn" onClick=${onClearCustom}>Remove my picture</button>`}
        <input ref=${fileRef} type="file" accept="image/*" style=${{ display: "none" }}
          onChange=${(e) => { if (e.target.files[0]) onUploadCustom(e.target.files[0]); e.target.value = ""; }} />
      </div>
      ${customUrl && html`
        <p className="sub" style=${{ margin: "8px 0 0" }}>
          A picture behind the whole app can make text harder to read — it's faded and fixed in place
          to help, but a busy photo will still fight the writing.
        </p>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Cloud panel                                                        */
/* ------------------------------------------------------------------ */
function CloudPanel({ user, onSignIn, onSignUp, onSignOut, onSyncNow, syncing, lastSync }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState(false);

  if (!Sync.configured()) return html`
    <div className="panel cloud">
      <div className="cloud-head">Cloud sync</div>
      <p className="sub" style=${{ margin: 0 }}>
        Not set up — the cookbook lives in this browser only. Add your Supabase project URL and key to
        <b> config.js</b> to open the same cookbook on your phone and your computer. Backups work either way.
      </p>
    </div>`;

  const run = async (fn, okMsg) => {
    setPending(true); setMsg("");
    try { await fn(); setMsg(okMsg || ""); }
    catch (err) { setMsg(err && err.message ? err.message : "That didn't work."); }
    finally { setPending(false); }
  };

  if (!user) return html`
    <div className="panel cloud">
      <div className="cloud-head">Cloud sync</div>
      <p className="sub" style=${{ margin: "0 0 8px" }}>Sign in to keep this cookbook on every device.</p>
      <div className="cloud-form">
        <input type="email" autoComplete="username" placeholder="email"
          value=${email} onChange=${(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="password"
          value=${pw} onChange=${(e) => setPw(e.target.value)} />
        <button className="btn btn-primary" disabled=${pending}
          onClick=${() => run(() => onSignIn(email, pw))}>Sign in</button>
        <button className="btn" disabled=${pending}
          onClick=${() => run(() => onSignUp(email, pw), "Account created — check your email if confirmation is required.")}>Create account</button>
      </div>
      ${msg && html`<div className="status">${msg}</div>`}
    </div>`;

  return html`
    <div className="panel cloud">
      <div className="cloud-head">Cloud sync</div>
      <div className="cloud-row">
        <span className="sub" style=${{ margin: 0 }}>Signed in as <b>${user.email}</b>${lastSync ? " · last synced " + lastSync : ""}</span>
        <div className="store-btns">
          <button className="btn btn-primary" disabled=${syncing} onClick=${onSyncNow}>${syncing ? "Syncing…" : "Sync now"}</button>
          <button className="btn" onClick=${onSignOut}>Sign out</button>
        </div>
      </div>
      ${msg && html`<div className="status">${msg}</div>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Search tab                                                         */
/* ------------------------------------------------------------------ */
function Check({ on, onClick, children, tone }) {
  return html`
    <button className=${"chk" + (on ? " chk-on" : "") + (tone ? " chk-" + tone : "")}
      role="checkbox" aria-checked=${!!on} onClick=${onClick}>
      <span className="chk-box" aria-hidden="true">${on ? "✓" : ""}</span>${children}
    </button>`;
}

function SearchTab({ meals, onOpen, onFav }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState({ types: [], devices: [], ratings: [], times: [], ings: [], fav: false });
  const [ingMode, setIngMode] = useState("all");
  const [ingQ, setIngQ] = useState("");

  const toggle = (group, id) =>
    setSel((s) => ({ ...s, [group]: s[group].includes(id) ? s[group].filter((x) => x !== id) : [...s[group], id] }));
  const clearAll = () => {
    setSel({ types: [], devices: [], ratings: [], times: [], ings: [], fav: false });
    setQ(""); setIngQ("");
  };

  /* Every ingredient across the cookbook, normalised so "2 cloves garlic" and
     "Garlic" are one entry, with a count so the common ones sort to the top. */
  const allIngredients = useMemo(() => {
    const counts = new Map();
    for (const m of meals) {
      const seen = new Set();
      for (const raw of m.ingredients || []) {
        const key = normalize(Parser.ingredientKey(raw) || raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, n }));
  }, [meals]);

  const shownIngredients = allIngredients.filter((i) => !ingQ.trim() || i.name.includes(ingQ.trim().toLowerCase()));

  const mealIngKeys = (m) =>
    (m.ingredients || []).map((raw) => normalize(Parser.ingredientKey(raw) || raw)).filter(Boolean);

  const needle = q.trim().toLowerCase();
  const anyFilter = needle || sel.types.length || sel.devices.length || sel.ratings.length ||
    sel.times.length || sel.ings.length || sel.fav;

  const results = meals.filter((m) => {
    if (sel.types.length && !sel.types.includes(m.mealType)) return false;
    if (sel.devices.length && !sel.devices.includes(m.device)) return false;
    if (sel.ratings.length && !sel.ratings.some((id) => RATING_BANDS.find((b) => b.id === id).test(m.rating))) return false;
    if (sel.times.length && !sel.times.some((id) => TIME_BANDS.find((b) => b.id === id).test(m.prepTime))) return false;
    if (sel.fav && !m.favorite) return false;
    if (sel.ings.length) {
      const keys = mealIngKeys(m);
      const hit = (want) => keys.some((k) => k === want || k.includes(want) || want.includes(k));
      if (ingMode === "all" ? !sel.ings.every(hit) : !sel.ings.some(hit)) return false;
    }
    if (needle) {
      const hay = [m.name, m.mealType, m.device, m.instructions, m.notes,
        (m.ingredients || []).join(" ")].join(" ").toLowerCase();
      if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  return html`
    <div>
      <h3 className="sec-h">Search</h3>
      <p className="sub">
        Type words, tick categories, tick ingredients — they all narrow the same list together.
      </p>

      <input className="big-search" value=${q}
        placeholder="search names, ingredients, steps and notes…"
        onChange=${(e) => setQ(e.target.value)} />

      <div className="filter-groups">
        <div className="fgroup"><span className="fg-label">Meal type</span>
          ${MEAL_TYPES.map((t) => html`<${Check} key=${t} on=${sel.types.includes(t)} onClick=${() => toggle("types", t)}>${t}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Device</span>
          ${DEVICES.map((t) => html`<${Check} key=${t} on=${sel.devices.includes(t)} onClick=${() => toggle("devices", t)}>${t}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Rating</span>
          ${RATING_BANDS.map((b) => html`<${Check} key=${b.id} on=${sel.ratings.includes(b.id)} onClick=${() => toggle("ratings", b.id)}>${b.label}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Prep time</span>
          ${TIME_BANDS.map((b) => html`<${Check} key=${b.id} on=${sel.times.includes(b.id)} onClick=${() => toggle("times", b.id)}>${b.label}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Favorites</span>
          <${Check} on=${sel.fav} tone="fav" onClick=${() => setSel((s) => ({ ...s, fav: !s.fav }))}>★ Favorites only<//>
        </div>
      </div>

      <div className="ing-search">
        <div className="ing-search-head">
          <span className="fg-label" style=${{ width: "auto" }}>Ingredients</span>
          ${allIngredients.length > 0 && html`
            <${Frag}>
              <div className="mode-seg mode-sm">
                <button className=${ingMode === "all" ? "seg-on" : ""} onClick=${() => setIngMode("all")}>has all of these</button>
                <button className=${ingMode === "any" ? "seg-on" : ""} onClick=${() => setIngMode("any")}>has any of them</button>
              </div>
              <input className="ing-filter" value=${ingQ} placeholder="filter this list…"
                onChange=${(e) => setIngQ(e.target.value)} />
            <//>`}
        </div>
        ${allIngredients.length === 0
          ? html`<p className="sub" style=${{ margin: 0 }}>
              No ingredients recorded yet. Add some to a meal and they'll be searchable here.</p>`
          : html`
            <div className="ing-check-grid">
              ${shownIngredients.map((i) => html`
                <${Check} key=${i.name} on=${sel.ings.includes(i.name)} onClick=${() => toggle("ings", i.name)}>
                  ${i.name}<span className="ing-n">${i.n}</span>
                <//>`)}
              ${shownIngredients.length === 0 && html`<span className="sub">Nothing matches “${ingQ}”.</span>`}
            </div>`}
      </div>

      ${anyFilter ? html`
        <${Frag}>
          <h3 className="sec-h">
            ${results.length} match${results.length === 1 ? "" : "es"}
            <button className="btn btn-ghost" onClick=${clearAll}>clear search</button>
          </h3>
          <div className="grid">
            ${results.map((m) => html`<${MealCard} key=${m.id} meal=${m} onOpen=${onOpen} onFav=${onFav} />`)}
          </div>
          ${results.length === 0 && html`
            <p className="sub">Nothing matches all of that${sel.ings.length > 1 && ingMode === "all"
              ? " — try “has any of them” for the ingredients." : " — untick something to widen it."}</p>`}
        <//>`
        : html`<p className="sub">Type something or tick anything above to start searching.</p>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Overview tab                                                       */
/* ------------------------------------------------------------------ */
function Overview(props) {
  const { meals, status, onSave, onLoad, onBackup, onRestoreFile, usage } = props;
  const restoreRef = useRef(null);
  const imgCount = meals.reduce((n, m) => n + m.items.filter((i) => i.kind === "image").length, 0);

  return html`
    <div>
      <div className="panel storage">
        <div className="stats">
          <div><b>${meals.length}</b><span>meals</span></div>
          <div><b>${imgCount}</b><span>photos</span></div>
          <div><b>${usage}</b><span>in use</span></div>
        </div>
        <div className="store-btns">
          <button className="btn btn-primary" onClick=${onSave}>Save</button>
          <button className="btn" onClick=${onLoad}>Restore last save</button>
          <button className="btn" onClick=${onBackup}>Download backup</button>
          <button className="btn" onClick=${() => restoreRef.current.click()}>Restore from backup file</button>
          <input ref=${restoreRef} type="file" accept=".json,application/json" style=${{ display: "none" }}
            onChange=${(e) => { if (e.target.files[0]) onRestoreFile(e.target.files[0]); e.target.value = ""; }} />
        </div>
        ${status && html`<div className="status">${status}</div>`}
      </div>

      <${BackupsPanel} ...${props.backupsPanel} />
      <${CloudPanel} ...${props.cloud} />
      <${BackgroundPanel} ...${props.background} />
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Meals list tab                                                     */
/* ------------------------------------------------------------------ */
function MealsTab({ meals, onOpen, onFav, onNew, onPasteRecipe, onCook }) {
  const [sort, setSort] = useState("newest");
  const [typeF, setTypeF] = useState([]);
  const [devF, setDevF] = useState([]);
  const [favOnly, setFavOnly] = useState(false);

  const tg = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const list = meals.filter((m) =>
    (!typeF.length || typeF.includes(m.mealType)) &&
    (!devF.length || devF.includes(m.device)) &&
    (!favOnly || m.favorite));

  const sorters = {
    newest: (a, b) => b.created - a.created,
    rating: (a, b) => b.rating - a.rating,
    time: (a, b) => a.prepTime - b.prepTime,
    name: (a, b) => a.name.localeCompare(b.name),
    // Never-cooked first, then longest ago — the "what have I been neglecting" list.
    stale: (a, b) => (lastCooked(a) || 0) - (lastCooked(b) || 0),
    mostcooked: (a, b) => ((b.cookLog || []).length) - ((a.cookLog || []).length),
  };
  let groups;
  if (sort === "type") groups = MEAL_TYPES.map((t) => [t, list.filter((m) => m.mealType === t)]).filter(([, l]) => l.length);
  else if (sort === "device") groups = DEVICES.map((t) => [t, list.filter((m) => m.device === t)]).filter(([, l]) => l.length);
  else if (sort === "favorites") groups = [["★ Favorites", list.filter((m) => m.favorite)], ["Everything else", list.filter((m) => !m.favorite)]].filter(([, l]) => l.length);
  else groups = [[null, [...list].sort(sorters[sort])]];

  return html`
    <div>
      <div className="list-controls">
        <button className="btn btn-primary" onClick=${onNew}>+ New meal</button>
        <button className="btn" onClick=${onPasteRecipe}>⎘ Paste a recipe</button>
        <label className="sortsel">Sort / group
          <select value=${sort} onChange=${(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="rating">Rating (high → low)</option>
            <option value="time">Prep time (short → long)</option>
            <option value="name">Name A–Z</option>
            <option value="stale">Not cooked in longest</option>
            <option value="mostcooked">Cooked most often</option>
            <option value="type">Group by meal type</option>
            <option value="device">Group by device</option>
            <option value="favorites">Favorites first</option>
          </select>
        </label>
        <div className="quickchips">
          ${MEAL_TYPES.map((t) => html`<${Chip} key=${t} active=${typeF.includes(t)} onClick=${() => tg(typeF, setTypeF, t)}>${t}<//>`)}
          ${DEVICES.map((t) => html`<${Chip} key=${t} active=${devF.includes(t)} onClick=${() => tg(devF, setDevF, t)}>${t}<//>`)}
          <${Chip} active=${favOnly} tone="fav" onClick=${() => setFavOnly((f) => !f)}>★<//>
        </div>
      </div>
      ${groups.map(([label, ms]) => html`
        <div key=${label || "all"}>
          ${label && html`<h3 className="sec-h">${label} <span className="count">(${ms.length})</span></h3>`}
          <div className="grid">
            ${(label ? [...ms].sort(sorters.rating) : ms).map((m) => html`
              <${MealCard} key=${m.id} meal=${m} onOpen=${onOpen} onFav=${onFav} onCook=${onCook} />`)}
          </div>
        </div>`)}

      ${list.length === 0 && (meals.length > 0
        ? html`<p className="sub">Nothing matches those filters — untick something to widen it.</p>`
        : html`
          <div className="welcome">
            <h3>Your cookbook is empty</h3>
            <p>Three ways to start — any of them works, and you can mix them freely.</p>
            <div className="welcome-opts">
              <button className="welcome-opt" onClick=${onNew}>
                <b>Write one down</b>
                <span>A blank meal page. Add photos, steps and a rating as you go.</span>
              </button>
              <button className="welcome-opt" onClick=${onPasteRecipe}>
                <b>Paste one from the internet</b>
                <span>Copy a recipe's text and it's sorted into ingredients and steps for you.</span>
              </button>
              <button className="welcome-opt" onClick=${() => onOpen("pantry")}>
                <b>Start from a built-in recipe</b>
                <span>Fourteen everyday recipes under “What can I cook?” — add any with one click.</span>
              </button>
            </div>
          </div>`)}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
function CookingOrganizer() {
  const [meals, setMeals] = useState([]);
  const [tab, setTab] = useState("meals"); // meals | search | pantry | temps | overview | <meal id>
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState("none");
  const [usage, setUsage] = useState("—");
  const [user, setUser] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [backups, setBackups] = useState([]);
  const [pantry, setPantryState] = useState({ have: {}, custom: [] });
  const [customTemps, setCustomTempsState] = useState([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [background, setBackgroundState] = useState({ id: "paper", custom: false });
  const [customBgUrl, setCustomBgUrl] = useState(null);
  const [shopping, setShoppingState] = useState({ mealIds: [], ticked: {}, extra: [] });
  const [cookId, setCookId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cookProgress, setCookProgress] = useState({});
  const [dark, setDark] = useState("auto");   // auto | light | dark
  const [saveError, setSaveError] = useState("");
  const [undo, setUndo] = useState(null);     // { message, restore }
  const [plan, setPlanState] = useState({});  // { "2026-07-28": [mealId, …] }
  const undoTimer = useRef(null);

  /* Anything that throws work away offers it back for a few seconds. Cheaper
     than a confirmation dialog on every destructive button, and kinder. */
  const offerUndo = useCallback((message, restore) => {
    clearTimeout(undoTimer.current);
    setUndo({ message, restore });
    undoTimer.current = setTimeout(() => setUndo(null), 9000);
  }, []);
  const takeUndo = () => {
    clearTimeout(undoTimer.current);
    if (undo && undo.restore) undo.restore();
    setUndo(null);
  };
  const timers = useTimers();
  const unsynced = useRef(false);          // real edits made here since the last sync
  const lastSyncAt = useRef(0);
  const savedIds = useRef([]);
  const deletions = useRef({});
  const autoTimer = useRef(null);
  const mealsRef = useRef(meals);
  mealsRef.current = meals;

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus((s) => (s === msg ? "" : s)), 4000); };

  const haveSet = useMemo(() => {
    const s = new Set();
    for (const k of Object.keys(pantry.have || {})) if (pantry.have[k]) matchKeys(k).forEach((x) => s.add(x));
    return s;
  }, [pantry]);

  const refreshUsage = useCallback(async () => {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage: u } = await navigator.storage.estimate();
        if (typeof u === "number") {
          setUsage(u > 1048576 ? (u / 1048576).toFixed(1) + " MB" : (u / 1024).toFixed(0) + " KB");
          return;
        }
      }
    } catch { /* estimate unsupported */ }
    setUsage("—");
  }, []);

  const refreshBackups = useCallback(async () => {
    try {
      const all = await idb.getAll("backups");
      setBackups(all.sort((a, b) => b.at - a.at));
    } catch { setBackups([]); }
  }, []);

  /* ---------- load ---------- */
  const loadAll = useCallback(async () => {
    try {
      const index = (await idb.get("meta", "index")) || {};
      const stored = await idb.getAll("meals");
      const byId = new Map(stored.map((m) => [m.id, m]));
      const order = Array.isArray(index.ids) ? index.ids : stored.map((m) => m.id);
      const ordered = order.map((id) => byId.get(id)).filter(Boolean);
      for (const m of stored) if (!order.includes(m.id)) ordered.push(m);
      const out = [];
      for (const m of ordered) out.push(await hydrateMeal(m));
      savedIds.current = out.map((m) => m.id);
      setMeals(out);
      setDirty(false);
      refreshUsage();
      return out.length;
    } catch { return 0; }
  }, [refreshUsage]);

  useEffect(() => {
    (async () => {
      try {
        const s = await idb.get("meta", "settings");
        if (s && s.theme && FRAMES[s.theme]) setTheme(s.theme);
      } catch { /* no settings yet */ }
      try { deletions.current = (await idb.get("meta", "deletions")) || {}; } catch { /* none */ }
      try {
        const p = await idb.get("meta", "pantry");
        if (p && p.have) setPantryState({ have: p.have || {}, custom: p.custom || [] });
      } catch { /* none */ }
      try { setCustomTempsState((await idb.get("meta", "customTemps")) || []); } catch { /* none */ }
      try {
        const b = await idb.get("meta", "background");
        if (b && b.id) setBackgroundState(b);
        const blob = await idb.get("images", BG_KEY);
        if (blob) setCustomBgUrl(urlFor(BG_KEY, blob));
      } catch { /* no background chosen yet */ }
      try {
        const s = await idb.get("meta", "shopping");
        if (s && Array.isArray(s.mealIds)) setShoppingState({ mealIds: s.mealIds, ticked: s.ticked || {}, extra: s.extra || [] });
      } catch { /* no list yet */ }
      try { setCookProgress((await idb.get("meta", "cookProgress")) || {}); } catch { /* none */ }
      try { setPlanState((await idb.get("meta", "plan")) || {}); } catch { /* nothing planned */ }
      try {
        const d = await idb.get("meta", "dark");
        if (d) setDark(d);
      } catch { /* default to following the system */ }
      await loadAll();
      await refreshBackups();
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* unsupported */ }
    })().finally(() => setReady(true));
  }, [loadAll, refreshBackups]);

  useEffect(() => {
    if (!Sync.configured()) return;
    const supa = Sync.init();
    if (!supa) return;
    supa.auth.getSession().then(({ data }) => {
      if (data && data.session) { Sync.user = data.session.user; setUser(data.session.user); }
    }).catch(() => { });
    const { data: sub } = supa.auth.onAuthStateChange((_e, session) => {
      Sync.user = session ? session.user : null;
      setUser(session ? session.user : null);
    });
    return () => { try { sub.subscription.unsubscribe(); } catch { /* gone */ } };
  }, []);

  const changeTheme = (t) => {
    setTheme(t);
    idb.put("meta", { theme: t }, "settings").catch(() => { });
    if (Sync.user) Sync.setMeta("settings", { theme: t }).catch(() => { });
  };
  /* These two are passed straight down so callers can use functional updates —
     ticking several pantry items quickly must not clobber earlier ticks.
     Persistence rides on an effect rather than the setter for the same reason. */
  const setPantry = setPantryState;
  const setCustomTemps = setCustomTempsState;

  useEffect(() => {
    if (!ready) return;
    idb.put("meta", pantry, "pantry").catch(() => { });
    if (Sync.user) Sync.setMeta("pantry", pantry).catch(() => { });
  }, [pantry, ready]);

  useEffect(() => {
    if (!ready) return;
    idb.put("meta", customTemps, "customTemps").catch(() => { });
    if (Sync.user) Sync.setMeta("customTemps", customTemps).catch(() => { });
  }, [customTemps, ready]);

  const setShopping = setShoppingState;
  useEffect(() => {
    if (!ready) return;
    idb.put("meta", shopping, "shopping").catch(() => { });
  }, [shopping, ready]);

  useEffect(() => {
    if (!ready) return;
    idb.put("meta", cookProgress, "cookProgress").catch(() => { });
  }, [cookProgress, ready]);

  const setPlan = setPlanState;
  useEffect(() => {
    if (!ready) return;
    idb.put("meta", plan, "plan").catch(() => { });
    if (Sync.user) Sync.setMeta("plan", plan).catch(() => { });
  }, [plan, ready]);

  /* "auto" leaves it to the system, which is what most people want most of the
     time; the explicit settings are for when it's wrong. */
  useEffect(() => {
    const apply = () => {
      const wantDark = dark === "dark" ||
        (dark === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.setAttribute("data-theme", wantDark ? "dark" : "light");
    };
    apply();
    if (dark !== "auto" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply); };
  }, [dark]);
  const changeDark = (d) => { setDark(d); idb.put("meta", d, "dark").catch(() => { }); };

  const setBackground = (b) => {
    setBackgroundState(b);
    idb.put("meta", b, "background").catch(() => { });
    if (Sync.user) Sync.setMeta("background", b).catch(() => { });
  };
  /* The picture is stored like any other photo — downscaled, as a Blob — but
     under a reserved key so the orphan sweep leaves it alone. */
  const uploadCustomBg = async (file) => {
    try {
      const { blob } = await processImageFile(file);
      await idb.put("images", blob, BG_KEY);
      dropUrl(BG_KEY);
      setCustomBgUrl(urlFor(BG_KEY, blob));
      setBackground({ id: "custom", custom: true });
      flash("Background updated.");
    } catch { flash("Couldn't read that picture."); }
  };
  const clearCustomBg = async () => {
    try { await idb.del("images", BG_KEY); } catch { /* already gone */ }
    dropUrl(BG_KEY);
    setCustomBgUrl(null);
    setBackground({ id: "paper", custom: false });
  };

  const bgStyle = useMemo(() => {
    if (background.custom && customBgUrl) {
      return {
        backgroundImage: "linear-gradient(rgba(255,255,255,.72),rgba(255,255,255,.72)), url(" + customBgUrl + ")",
        backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed",
      };
    }
    const preset = BACKGROUNDS.find((b) => b.id === background.id) || BACKGROUNDS[0];
    return preset ? { background: preset.css, backgroundAttachment: "fixed" } : {};
  }, [background, customBgUrl]);

  /* ---------- save ---------- */
  const saveAll = useCallback(async (quiet) => {
    const list = mealsRef.current;
    try {
      for (const m of list) await idb.put("meals", stripMeal(m));
      const gone = savedIds.current.filter((id) => !list.some((m) => m.id === id));
      for (const id of gone) { try { await idb.del("meals", id); } catch { /* already gone */ } }
      await idb.put("meta", { ids: list.map((m) => m.id), at: Date.now() }, "index");
      await idb.put("meta", deletions.current, "deletions");

      /* One automatic snapshot per day, taken on the first save of that day. */
      const lastDay = await idb.get("meta", "lastAutoBackup");
      const today = new Date().toISOString().slice(0, 10);
      if (list.length && lastDay !== today) {
        try {
          await createBackup(list, "automatic");
          await idb.put("meta", today, "lastAutoBackup");
          refreshBackups();
        } catch { /* a failed snapshot must never block the save */ }
      }

      /* Sweep photos nothing points at any more — meals, in-flight writes and
         every stored snapshot all count as "pointing at". */
      const live = new Set([BG_KEY]);   // the background picture belongs to no meal
      for (const m of list) for (const it of m.items) if (it.kind === "image") live.add(imgKey(m.id, it.id));
      for (const b of await idb.getAll("backups")) for (const k of b.imageKeys || []) live.add(k);
      for (const k of await idb.keys("images")) {
        if (live.has(k) || pendingImages.has(k)) continue;
        await idb.del("images", k); dropUrl(k);
      }

      savedIds.current = list.map((m) => m.id);
      setDirty(false);
      setSaveError("");
      refreshUsage();
      if (!quiet) flash("Saved ✓ (" + list.length + " meals)");
    } catch (err) {
      /* A failed autosave used to be swallowed: nothing was written, nothing was
         said, and the header sat on "saving…" indefinitely while you carried on
         believing your work was safe. Whatever else happens, this must be loud. */
      const full = err && (err.name === "QuotaExceededError" || /quota/i.test(err.message || ""));
      setSaveError(full
        ? "This browser's storage is full, so nothing new is being saved."
        : "Couldn't save to this browser's storage.");
      if (!quiet) flash("Save failed — use Download backup to keep a copy.");
    }
  }, [refreshUsage, refreshBackups]);

  useEffect(() => {
    if (!ready || !dirty) return;
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { saveAll(true); }, 1500);
    return () => clearTimeout(autoTimer.current);
  }, [ready, dirty, meals, saveAll]);

  /* ---------- backup file ---------- */
  /* Format stays exactly as the original artifact wrote it — photos inlined as
     data URLs — so files move between the two versions. Pantry and custom temps
     ride along as extra top-level keys the old version simply ignores. */
  const backup = async () => {
    flash("Preparing backup…");
    const out = [];
    for (const m of mealsRef.current) {
      const items = [];
      for (const it of m.items) {
        if (it.kind !== "image") { items.push(it); continue; }
        const { remote, ...rest } = it;
        let src = null;
        try {
          const blob = await idb.get("images", imgKey(m.id, it.id));
          if (blob) src = await blobToDataURL(blob);
        } catch { /* photo unreadable — geometry still exported */ }
        items.push({ ...rest, src });
      }
      out.push({ ...m, items });
    }
    const payload = { app: "cooking-organizer", exported: Date.now(), meals: out, pantry, customTemps };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cookbook-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    flash("Backup file downloaded.");
  };

  const restoreFile = (file) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result);
        if (!Array.isArray(data.meals)) throw new Error("not a cookbook backup");
        const restored = [];
        for (const raw of data.meals) {
          const m = {
            ...raw, id: raw.id || uid(), items: raw.items || [],
            strokes: raw.strokes || [], variants: raw.variants || [],
            ingredients: raw.ingredients || [], notes: raw.notes || "",
          };
          const items = [];
          for (const it of m.items) {
            if (it.kind !== "image") { items.push(it); continue; }
            const key = imgKey(m.id, it.id);
            if (it.src && /^data:/.test(it.src)) {
              const blob = dataURLToBlob(it.src);
              await idb.put("images", blob, key);
              dropUrl(key);
              items.push({ ...it, src: urlFor(key, blob), remote: undefined });
            } else {
              const blob = await idb.get("images", key);
              items.push({ ...it, src: blob ? urlFor(key, blob) : null });
            }
          }
          restored.push({ ...m, items, modified: Date.now() });
        }
        if (data.pantry && data.pantry.have) setPantry({ have: data.pantry.have, custom: data.pantry.custom || [] });
        if (Array.isArray(data.customTemps)) setCustomTemps(data.customTemps);
        setMeals(restored);
        touched();
        flash("Backup loaded (" + restored.length + " meals) — press Save to keep it.");
      } catch { flash("That file doesn't look like a cookbook backup."); }
    };
    r.readAsText(file);
  };

  /* ---------- snapshots ---------- */
  const makeSnapshot = async (label) => {
    try {
      await saveAll(true);
      const code = await createBackup(mealsRef.current, label || "manual");
      await refreshBackups();
      return code;
    } catch { flash("Couldn't create a snapshot."); return null; }
  };
  const restoreSnapshot = async (b) => {
    try {
      await createBackup(mealsRef.current, "before restoring " + b.code);
      const restored = [];
      for (const m of b.meals) {
        await Sync.fetchPhotos(m);          // no-op when signed out or already held
        restored.push(await hydrateMeal(m));
      }
      setMeals(restored);
      touched();
      await refreshBackups();
      setTab("meals");
      flash("Restored backup " + b.code + " (" + restored.length + " meals).");
    } catch { flash("Couldn't restore that backup."); }
  };

  /* ---------- meal edits ---------- */
  /* `unsynced` marks changes a person made, as opposed to changes that arrived
     from the cloud — otherwise pulling something down would look like a local
     edit and start an endless sync loop. */
  const touched = () => { setDirty(true); unsynced.current = true; };

  const updateMeal = (id) => (fnOrPatch) => {
    setMeals((ms) => ms.map((m) => {
      if (m.id !== id) return m;
      const next = typeof fnOrPatch === "function" ? fnOrPatch(m) : { ...m, ...fnOrPatch };
      return { ...next, modified: Date.now() };
    }));
    touched();
  };
  const toggleFav = (id) => updateMeal(id)((m) => ({ ...m, favorite: !m.favorite }));
  const addMeal = () => { const m = newMeal(); setMeals((ms) => [...ms, m]); touched(); setTab(m.id); };

  /* Deleting takes a snapshot first, so the 4-digit code in the toast is a real
     way back rather than a consolation. */
  const reallyDelete = async (meal) => {
    setConfirmDelete(null);
    let code = null;
    try { code = await createBackup(mealsRef.current, "before deleting " + meal.name); await refreshBackups(); }
    catch { /* a failed snapshot must not block the delete the user asked for */ }
    deletions.current = { ...deletions.current, [meal.id]: Date.now() };
    setMeals((ms) => ms.filter((m) => m.id !== meal.id));
    touched();
    setTab("meals");
    flash(code ? "Deleted “" + meal.name + "”. Backup " + code + " has it if you want it back."
               : "Deleted “" + meal.name + "”.");
  };

  /* Drop a table onto a meal's page, below whatever is already there. */
  const insertTable = (mealId, table) => {
    const target = mealsRef.current.find((m) => m.id === mealId);
    if (!target) return;
    const lowest = target.items.reduce((y, it) => Math.max(y, it.y + it.h), 320);
    updateMeal(mealId)((m) => ({
      ...m,
      boardH: Math.max(m.boardH, 640),
      items: [...m.items, {
        id: uid(), kind: "table", x: 24, y: lowest + 16,
        w: Math.min(560, 120 + table.headers.length * 120),
        h: Math.min(420, 90 + table.rows.length * 34),
        parent: null, title: table.title, headers: table.headers, rows: table.rows,
      }],
    }));
    flash("Added “" + table.title + "” to " + target.name + ".");
  };

  /* The temperature goes in Notes rather than becoming step 1 — it's a fact
     about the dish, not something you do. */
  const mealFromRecipe = (p) => ({
    ...newMeal(),
    name: p.name, mealType: p.mealType, device: p.device,
    prepTime: p.prepTime, ingredients: p.ingredients, servings: p.servings || null,
    instructions: stepsToText(p.steps),
    notes: p.temp ? "Oven / air fryer: " + p.temp + " °C" : "",
  });
  const createFromRecipe = (p) => {
    const m = mealFromRecipe(p);
    setMeals((ms) => [...ms, m]);
    touched();
    setPasteOpen(false);
    setTab(m.id);
    flash("Created “" + m.name + "” — check it over.");
  };
  const fillFromRecipe = (p) => {
    const open = mealsRef.current.find((m) => m.id === tab);
    if (!open) return;
    updateMeal(open.id)((m) => ({
      ...m,
      name: p.name || m.name, mealType: p.mealType, device: p.device, prepTime: p.prepTime,
      servings: p.servings || m.servings || null,
      ingredients: [...(m.ingredients || []), ...p.ingredients],
      instructions: stepsToText([...stepsOf(m.instructions), ...p.steps]),
      notes: [m.notes, p.temp ? "Oven / air fryer: " + p.temp + " °C" : ""].filter(Boolean).join("\n"),
    }));
    setPasteOpen(false);
    flash("Filled in “" + p.name + "”.");
  };
  const finishedCooking = (id) => {
    updateMeal(id)((m) => ({ ...m, cookLog: [...(m.cookLog || []), Date.now()] }));
    setCookProgress((p) => ({ ...p, [id]: { done: {}, got: {}, at: Date.now() } }));
    setCookId(null);
    const m = mealsRef.current.find((x) => x.id === id);
    const n = ((m && m.cookLog) || []).length + 1;
    flash("Logged — that's " + n + (n === 1 ? " time" : " times") + " you've cooked this.");
  };

  const addToShopping = (id) => {
    setShopping((s) => ({ ...s, mealIds: [...new Set([...(s.mealIds || []), id])] }));
    const m = mealsRef.current.find((x) => x.id === id);
    flash("Added " + (m ? "“" + m.name + "”" : "it") + " to the shopping list.");
  };

  const addStarter = (recipe) => {
    const m = {
      ...newMeal(),
      name: recipe.name, mealType: recipe.mealType, device: recipe.device,
      prepTime: recipe.prepTime, rating: recipe.rating,
      ingredients: [...recipe.ingredients], instructions: recipe.instructions,
      fromStarter: recipe.id,   // so the original stops being suggested alongside it
    };
    setMeals((ms) => [...ms, m]);
    touched();
    setTab(m.id);
    flash("Added “" + m.name + "” to your meals.");
  };

  /* ---------- cloud sync ---------- */
  const syncNow = useCallback(async () => {
    if (!Sync.user) return;
    setSyncing(true);
    try {
      await saveAll(true);

      const remoteDel = (await Sync.getMeta("deletions")) || {};
      const mergedDel = { ...remoteDel, ...deletions.current };
      for (const id of Object.keys(deletions.current)) {
        const local = mealsRef.current.find((m) => m.id === id);
        await Sync.deleteMeal(id, local ? local.items : []);
      }

      const { data: rows, error } = await Sync.supa.from(T_MEALS).select("id,modified");
      if (error) throw error;
      const remoteById = new Map((rows || []).map((r) => [r.id, r.modified]));
      const localById = new Map(mealsRef.current.map((m) => [m.id, m]));

      const pushed = [];
      for (const m of mealsRef.current) {
        const rm = remoteById.get(m.id);
        if (rm === undefined || (m.modified || 0) > rm) pushed.push(await Sync.pushMeal(m));
      }
      if (pushed.length) setMeals((ms) => ms.map((m) => pushed.find((p) => p.id === m.id) || m));

      const wanted = (rows || []).filter((r) => {
        if (mergedDel[r.id] && mergedDel[r.id] > r.modified) return false;
        const lm = localById.get(r.id);
        return !lm || r.modified > (lm.modified || 0);
      }).map((r) => r.id);

      const pulled = [];
      if (wanted.length) {
        const { data: full, error: e2 } = await Sync.supa.from(T_MEALS).select("id,data,modified").in("id", wanted);
        if (e2) throw e2;
        for (const row of full || []) pulled.push(await hydrateMeal(await Sync.pullMeal(row)));
      }

      if (pulled.length || Object.keys(mergedDel).length) {
        setMeals((ms) => {
          const map = new Map(ms.map((m) => [m.id, m]));
          for (const p of pulled) map.set(p.id, p);
          for (const id of Object.keys(mergedDel)) {
            const m = map.get(id);
            if (m && (m.modified || 0) <= mergedDel[id]) map.delete(id);
          }
          return [...map.values()];
        });
      }

      deletions.current = mergedDel;
      await Sync.setMeta("deletions", mergedDel);

      /* Snapshots, so a 4-digit code means the same thing on every device. */
      try {
        const localBk = await idb.getAll("backups");
        const merged = mergeBackups(localBk, (await Sync.getMeta("backups")) || []);
        const keep = new Set(merged.map((b) => b.code));
        for (const b of localBk) if (!keep.has(b.code)) await idb.del("backups", b.code);
        for (const b of merged) await idb.put("backups", b);
        await Sync.setMeta("backups", merged.slice(0, SYNC_BACKUPS));
        refreshBackups();
      } catch { /* snapshots are a convenience; never fail a sync over them */ }

      const remoteSettings = await Sync.getMeta("settings");
      if (remoteSettings && remoteSettings.theme && FRAMES[remoteSettings.theme] && remoteSettings.theme !== theme) {
        setTheme(remoteSettings.theme);
        await idb.put("meta", { theme: remoteSettings.theme }, "settings");
      } else {
        await Sync.setMeta("settings", { theme });
      }
      const remotePantry = await Sync.getMeta("pantry");
      if (remotePantry && remotePantry.have && !Object.keys(pantry.have || {}).length) setPantry(remotePantry);
      else await Sync.setMeta("pantry", pantry);
      const remoteTemps = await Sync.getMeta("customTemps");
      if (Array.isArray(remoteTemps) && remoteTemps.length && !customTemps.length) setCustomTemps(remoteTemps);
      else await Sync.setMeta("customTemps", customTemps);

      setDirty(true);
      unsynced.current = false;
      lastSyncAt.current = Date.now();
      setLastSync(new Date().toLocaleTimeString());
      // Only shout about it when something actually moved; a quiet background
      // sync that found nothing shouldn't interrupt you.
      if (pushed.length || pulled.length) {
        flash("Synced ✓ (" + pushed.length + " up, " + pulled.length + " down)");
      }
    } catch (err) {
      lastSyncAt.current = Date.now();   // don't hammer a failing server
      flash("Sync failed: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setSyncing(false);
      refreshUsage();
    }
  }, [saveAll, theme, pantry, customTemps, refreshUsage, refreshBackups]);

  const syncedOnce = useRef(false);
  useEffect(() => {
    if (!ready || !user || syncedOnce.current) return;
    syncedOnce.current = true;
    syncNow();
  }, [ready, user, syncNow]);

  /* Auto-sync. Pressing a button to make your phone and your laptop agree is a
     thing people forget to do, and forgetting looks exactly like data loss. */
  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;

  // After your edits have settled and been saved locally, push them up.
  useEffect(() => {
    if (!ready || !user || dirty || syncing || !unsynced.current) return;
    const id = setTimeout(() => {
      if (unsynced.current && !syncing) syncRef.current();
    }, 3000);
    return () => clearTimeout(id);
  }, [ready, user, dirty, syncing, meals]);

  // Coming back to the tab is the moment another device's changes matter.
  useEffect(() => {
    if (!user) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAt.current < 30000) return;
      syncRef.current();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [user]);

  const cloud = {
    user, syncing, lastSync,
    onSignIn: async (email, pw) => { const u = await Sync.signIn(email, pw); setUser(u); },
    onSignUp: async (email, pw) => { await Sync.signUp(email, pw); },
    onSignOut: async () => { await Sync.signOut(); setUser(null); syncedOnce.current = false; },
    onSyncNow: syncNow,
  };
  const backupsPanel = {
    backups, busy: !ready, signedIn: !!user,
    onCreate: async (label) => {
      const c = await makeSnapshot(label || "manual");
      if (c) flash("Backup created — code " + c + (label ? " (" + label + ")" : "") + ".");
    },
    onRestore: restoreSnapshot,
    onDelete: async (code) => { await idb.del("backups", code); await refreshBackups(); flash("Backup " + code + " deleted."); },
  };

  const backgroundPanel = {
    background, setBackground, customUrl: customBgUrl,
    onUploadCustom: uploadCustomBg, onClearCustom: clearCustomBg, busy: !ready,
  };

  const cooking = meals.find((m) => m.id === cookId);
  const open = meals.find((m) => m.id === tab);
  const TABS = [
    ["meals", "Meals"], ["search", "Search"], ["pantry", "What can I cook?"],
    ["temps", "Temps & times"], ["overview", "Storage & backups"],
  ];

  return html`
    <div className="app" style=${bgStyle}>
      <${Frame} theme=${theme} />
      <header className="top">
        <div className="brand">The Cookbook Board</div>
        <nav className="tabs">
          ${TABS.map(([id, label]) => html`
            <button key=${id} className=${tab === id ? "tab-on" : ""} onClick=${() => setTab(id)}>${label}</button>`)}
          ${open && html`<button className="tab-on tab-meal">${open.name || "Meal"}</button>`}
        </nav>
        <div className="top-right">
          <label className="frame-sel">Frame
            <select value=${theme} onChange=${(e) => changeTheme(e.target.value)}>
              ${Object.entries(FRAMES).map(([k, f]) => html`<option key=${k} value=${k}>${f.label}</option>`)}
            </select>
          </label>
          <label className="frame-sel">Light
            <select value=${dark} onChange=${(e) => changeDark(e.target.value)}>
              <option value="auto">Match my device</option>
              <option value="light">Always light</option>
              <option value="dark">Always dark</option>
            </select>
          </label>
          <span className=${"savestate" + (saveError ? " savestate-error" : dirty ? " savestate-dirty" : "")}>
            ${saveError ? "⚠ not saved" : dirty ? "saving…" : "auto-saved ✓"}
          </span>
          <button className="btn btn-primary" onClick=${() => saveAll(false)}>Save</button>
        </div>
      </header>

      ${saveError && html`
        <div className="save-banner">
          <b>${saveError}</b> Your meals are still here in this window, but they aren't being written to
          disk — closing the tab would lose recent changes.
          <button className="btn" onClick=${backup}>Download a backup now</button>
          <button className="btn" onClick=${() => saveAll(false)}>Try saving again</button>
        </div>`}

      ${MISSING_FILES.length > 0 && html`
        <div className="missing-banner">
          <b>${MISSING_FILES.join(" and ")}</b> ${MISSING_FILES.length > 1 ? "didn't" : "didn't"} load.
          Your meals are fine, but
          ${!window.COOK_TEMPS ? " the temperature charts, pantry list and built-in recipes are empty" : ""}
          ${MISSING_FILES.length > 1 ? " and" : ""}
          ${!window.RecipeParser ? " pasting a recipe won't work" : ""}.
          Upload ${MISSING_FILES.length > 1 ? "those files" : "that file"} next to index.html and reload.
        </div>`}

      ${!ready
        ? html`<div className="loading">Opening the cookbook…</div>`
        : open
        ? html`
          <div className="page">
            <button className="btn btn-ghost back" onClick=${() => setTab("meals")}>← All meals</button>
            <${MealDetail} meal=${open} update=${updateMeal(open.id)} onDelete=${() => setConfirmDelete(open)}
              have=${haveSet} onPasteRecipe=${() => setPasteOpen(true)} onCook=${() => setCookId(open.id)}
              onAddToShopping=${addToShopping} inShopping=${(shopping.mealIds || []).includes(open.id)}
              offerUndo=${offerUndo} />
          </div>`
        : tab === "meals"
        ? html`
          <div className="page">
            <${MealsTab} meals=${meals} onOpen=${setTab} onFav=${toggleFav} onNew=${addMeal}
              onPasteRecipe=${() => setPasteOpen(true)} onCook=${setCookId} />
          </div>`
        : tab === "search"
        ? html`
          <div className="page">
            <${SearchTab} meals=${meals} onOpen=${setTab} onFav=${toggleFav} />
          </div>`
        : tab === "pantry"
        ? html`
          <div className="page">
            <${PantryTab} meals=${meals} pantry=${pantry} setPantry=${setPantry}
              onOpen=${setTab} onAddStarter=${addStarter}
              shopping=${shopping} setShopping=${setShopping}
              plan=${plan} setPlan=${setPlan} onCook=${setCookId} />
          </div>`
        : tab === "temps"
        ? html`
          <div className="page">
            <${TempsTab} meals=${meals} onInsert=${insertTable}
              customTemps=${customTemps} setCustomTemps=${setCustomTemps} />
          </div>`
        : html`
          <div className="page">
            <${Overview} meals=${meals} status=${status} usage=${usage} cloud=${cloud}
              backupsPanel=${backupsPanel} background=${backgroundPanel}
              onSave=${() => saveAll(false)} onBackup=${backup} onRestoreFile=${restoreFile}
              onLoad=${async () => { const n = await loadAll(); flash(n ? "Restored last save (" + n + " meals)." : "No save found yet."); }} />
          </div>`}

      ${pasteOpen && html`
        <${RecipePaste} onClose=${() => setPasteOpen(false)}
          onCreate=${createFromRecipe} onFill=${fillFromRecipe}
          openMealName=${open ? open.name : null} />`}

      ${confirmDelete && html`
        <div className="modal-back" onPointerDown=${(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="modal modal-sm">
            <div className="modal-head"><h3>Delete “${confirmDelete.name}”?</h3></div>
            <p className="sub">
              ${"This removes the meal, its "}
              ${confirmDelete.items.filter((i) => i.kind === "image").length}
              ${confirmDelete.items.filter((i) => i.kind === "image").length === 1 ? " photo" : " photos"}
              ${" and everything on its page"}${Sync.user ? ", on this device and any other you've synced" : ""}.
              A backup is taken first and you'll get its code, so this can be undone.
            </p>
            <div className="modal-btns">
              <button className="btn btn-danger" onClick=${() => reallyDelete(confirmDelete)}>Delete it</button>
              <button className="btn btn-primary" onClick=${() => setConfirmDelete(null)}>Keep it</button>
            </div>
          </div>
        </div>`}

      <${TimerBar} timers=${timers.timers} stop=${timers.stop} addMinute=${timers.addMinute} />

      ${cooking && html`
        <${CookMode} meal=${cooking} timers=${timers} onClose=${() => setCookId(null)}
          progress=${cookProgress} setProgress=${setCookProgress} onFinished=${finishedCooking} />`}

      ${undo
        ? html`
          <div className="toast toast-undo">
            ${undo.message}
            <button onClick=${takeUndo}>Undo</button>
            <button className="toast-x" aria-label="Dismiss" onClick=${() => setUndo(null)}>✕</button>
          </div>`
        : status && tab !== "overview" && html`<div className="toast">${status}</div>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Crash guard                                                        */
/*  React unmounts the whole tree when a render throws, which shows as  */
/*  a blank white page with no clue what happened. Anything that gets   */
/*  through lands here instead, with the error and a way out.          */
/* ------------------------------------------------------------------ */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("The Cookbook Board hit an error:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return html`
      <div className="crash">
        <h2>Something in the app broke</h2>
        <p>Your cookbook is safe — this is a display problem, nothing was deleted.</p>
        <pre>${String(this.state.err && this.state.err.message || this.state.err)}</pre>
        ${MISSING_FILES.length > 0 && html`
          <p className="crash-hint">
            <b>Probable cause:</b> ${MISSING_FILES.join(" and ")} ${MISSING_FILES.length > 1 ? "are" : "is"} missing
            from the site. Upload ${MISSING_FILES.length > 1 ? "those files" : "that file"} alongside
            index.html and app.js, then reload.
          </p>`}
        <button className="btn btn-primary" onClick=${() => location.reload()}>Reload the page</button>
      </div>`;
  }
}

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */
/* Tells the start-up check in index.html that this file parsed and ran. If it
   throws before here, that flag stays unset and the check reports app.js. */
window.__cookbookLoaded = true;

ReactDOM.createRoot(document.getElementById("root")).render(
  html`<${ErrorBoundary}><${CookingOrganizer} /><//>`
);
