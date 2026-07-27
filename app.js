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
  "oil", "butter", "sugar", "flour", "garlic", "onion"]);

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const imgKey = (mealId, itemId) => mealId + "__" + itemId;

function newMeal() {
  return {
    id: uid(), name: "New meal", mealType: "Dinner", device: "Stovetop",
    prepTime: 30, rating: 7.0, favorite: false, coverId: null, variants: [],
    instructions: "", ingredients: [], items: [], strokes: [], boardH: 640,
    created: Date.now(), modified: Date.now(),
  };
}

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
    variants: meal.variants || [], strokes: meal.strokes || [], ingredients: meal.ingredients || [],
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

/* Does the pantry cover this ingredient? Substring both ways, because
   "chicken breast" in the pantry should satisfy "chicken" in a recipe and
   vice-versa. */
function pantryHas(haveSet, ingredient) {
  const keys = matchKeys(RecipeParser.ingredientKey(ingredient) || ingredient);
  for (const k of keys) {
    if (!k) continue;
    if (haveSet.has(k)) return true;
    for (const h of haveSet) {
      if (h.length < 3 || k.length < 3) continue;
      if (k.includes(h) || h.includes(k)) return true;
    }
  }
  return false;
}

function scoreRecipe(recipe, haveSet) {
  const ing = recipe.ingredients || [];
  if (!ing.length) return null;
  const missing = [], have = [];
  for (const i of ing) {
    const key = normalize(RecipeParser.ingredientKey(i) || i);
    if (pantryHas(haveSet, i)) have.push(i);
    else if (STAPLES.has(key)) have.push(i);          // assume you have salt
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
    const { error } = await this.supa.from("meals").upsert({
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

  async deleteMeal(mealId, items) {
    for (const it of items || []) {
      if (it.kind === "image" && it.remote) {
        try { await this.supa.storage.from(BUCKET).remove([it.remote]); } catch { /* already gone */ }
      }
    }
    await this.supa.from("meals").delete().eq("id", mealId).eq("user_id", this.user.id);
  },

  async getMeta(key) {
    const { data } = await this.supa.from("meta").select("value").eq("key", key).maybeSingle();
    return data ? data.value : null;
  },
  async setMeta(key, value) {
    await this.supa.from("meta").upsert({ user_id: this.user.id, key, value });
  },
};

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
    <button className=${"chip" + (active ? " chip-on" : "") + (tone ? " chip-" + tone : "")} onClick=${onClick}>
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

function coverOf(meal) {
  const imgs = meal.items.filter((i) => i.kind === "image");
  return imgs.find((i) => i.id === meal.coverId) || imgs[0] || null;
}

function MealCard({ meal, onOpen, onFav }) {
  const cov = coverOf(meal);
  return html`
    <div className="card" onClick=${() => onOpen(meal.id)}>
      <div className="card-img">
        ${cov && cov.src
          ? html`<img src=${cov.src} alt=${meal.name} draggable=${false} />`
          : html`<div className="card-noimg">${cov ? "photo unavailable" : "no photo yet"}</div>`}
        <span className="card-rating">${meal.rating.toFixed(1)}</span>
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
      </div>
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
function PageCanvas({ meal, mode, draw, update, pageRef }) {
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
function Ingredients({ list, have, onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...list, ...parts]);
    setDraft("");
  };
  return html`
    <div className="ing-block">
      <div className="var-head">
        <span className="fg-label" style=${{ width: "auto" }}>Ingredients</span>
        <span className="hint">used by “What can I cook?” — green means it's in your pantry</span>
      </div>
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
/*  Meal detail                                                        */
/* ------------------------------------------------------------------ */
function MealDetail({ meal, update, onDelete, have, onPasteRecipe }) {
  const [mode, setMode] = useState("view");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#D8341F");
  const [size, setSize] = useState(4);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const fileRef = useRef(null);
  const pageRef = useRef(null);
  const boardRef = useRef(null);
  const cascade = useRef(0);
  const mealId = meal.id;

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
          <label>Rating
            <span className="unit-wrap">
              <input type="number" inputMode="decimal" min="1" max="10" step="0.1" value=${meal.rating}
                onChange=${(e) => update((m) => ({ ...m, rating: Math.min(10, Math.max(1, +e.target.value || 1)) }))} /> / 10
            </span>
          </label>
          <button className="btn btn-danger" onClick=${onDelete}>Delete meal</button>
        </div>

        <${Ingredients} list=${meal.ingredients || []} have=${have}
          onChange=${(ingredients) => update((m) => ({ ...m, ingredients }))} />

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
            <button className="tool" onClick=${() => update((m) => ({ ...m, strokes: [] }))}>clear drawings</button>
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

      <div ref=${boardRef} className="board" style=${{ height: meal.boardH }}>
        ${meal.items.length === 0 && meal.strokes.length === 0 && html`
          <div className="board-empty">Paste, drop or upload photos, add a notepad or a table, or switch to Draw.
            In Arrange mode you can drag any of it anywhere on this page — including over the fields above.</div>`}
      </div>
      <button className="btn btn-ghost" onClick=${() => update((m) => ({ ...m, boardH: m.boardH + 320 }))}>+ more space</button>

      <h3 className="sec-h">Instructions</h3>
      <textarea className="instructions" value=${meal.instructions} onChange=${set("instructions")}
        placeholder=${"1. …\n2. …"} />

      <${PageCanvas} meal=${meal} mode=${mode} draw=${{ tool, color, size }} update=${update} pageRef=${pageRef} />
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
    const p = RecipeParser.parseRecipe(text);
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
  const groups = window.COOK_TEMPS
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
              ${window.DONENESS.map((d) => html`
                <tr key=${d.food}><td className="tt-food">${d.food}</td><td><b>${d.temp}</b></td><td className="tt-note">${d.note}</td></tr>`)}
            </tbody>
          </table>
        </div>
        <button className="btn btn-ghost" disabled=${!target}
          onClick=${() => onInsert(target, {
            title: "Cooked-through temperatures",
            headers: ["Food", "Internal", "Note"],
            rows: window.DONENESS.map((d) => [d.food, d.temp, d.note]),
          })}>insert this table</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  What can I cook?                                                   */
/* ------------------------------------------------------------------ */
function PantryTab({ meals, pantry, setPantry, onOpen, onAddStarter }) {
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
    const pool = [...mine, ...window.STARTER_MEALS.map((r) => ({ ...r, mine: false }))];
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
      </div>

      ${tab === "pantry" ? html`
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
          ${window.PANTRY_GROUPS.map((g) => html`
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
function BackupsPanel({ backups, onCreate, onRestore, onDelete, busy }) {
  const [code, setCode] = useState("");
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
      <div className="cloud-head">Backups in this browser</div>
      <p className="sub" style=${{ margin: "0 0 8px" }}>
        Snapshots kept alongside your cookbook — each one gets a 4-digit code. They cost almost nothing
        because they share photos with your meals, but they live in the same browser, so a
        <b> downloaded backup file</b> is still the one that survives anything.
      </p>
      <div className="store-btns" style=${{ marginLeft: 0, marginBottom: 10 }}>
        <button className="btn btn-primary" disabled=${busy} onClick=${onCreate}>Create a backup now</button>
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
/*  Overview tab                                                       */
/* ------------------------------------------------------------------ */
function Overview(props) {
  const { meals, status, onSave, onLoad, onBackup, onRestoreFile, onOpen, onFav, usage } = props;
  const [sel, setSel] = useState({ types: [], devices: [], ratings: [], times: [], fav: false });
  const restoreRef = useRef(null);
  const imgCount = meals.reduce((n, m) => n + m.items.filter((i) => i.kind === "image").length, 0);

  const toggle = (group, id) =>
    setSel((s) => ({ ...s, [group]: s[group].includes(id) ? s[group].filter((x) => x !== id) : [...s[group], id] }));

  const anyFilter = sel.types.length || sel.devices.length || sel.ratings.length || sel.times.length || sel.fav;
  const results = meals.filter((m) => {
    if (sel.types.length && !sel.types.includes(m.mealType)) return false;
    if (sel.devices.length && !sel.devices.includes(m.device)) return false;
    if (sel.ratings.length && !sel.ratings.some((id) => RATING_BANDS.find((b) => b.id === id).test(m.rating))) return false;
    if (sel.times.length && !sel.times.some((id) => TIME_BANDS.find((b) => b.id === id).test(m.prepTime))) return false;
    if (sel.fav && !m.favorite) return false;
    return true;
  });

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

      <h3 className="sec-h">Search by category</h3>
      <p className="sub">Click categories to combine them — e.g. Dinner + Air fryer + 9.0 + shows only meals matching all three.</p>
      <div className="filter-groups">
        <div className="fgroup"><span className="fg-label">Meal type</span>
          ${MEAL_TYPES.map((t) => html`<${Chip} key=${t} active=${sel.types.includes(t)} onClick=${() => toggle("types", t)}>${t}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Device</span>
          ${DEVICES.map((t) => html`<${Chip} key=${t} active=${sel.devices.includes(t)} onClick=${() => toggle("devices", t)}>${t}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Rating</span>
          ${RATING_BANDS.map((b) => html`<${Chip} key=${b.id} active=${sel.ratings.includes(b.id)} onClick=${() => toggle("ratings", b.id)}>${b.label}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Prep time</span>
          ${TIME_BANDS.map((b) => html`<${Chip} key=${b.id} active=${sel.times.includes(b.id)} onClick=${() => toggle("times", b.id)}>${b.label}<//>`)}
        </div>
        <div className="fgroup"><span className="fg-label">Favorites</span>
          <${Chip} active=${sel.fav} tone="fav" onClick=${() => setSel((s) => ({ ...s, fav: !s.fav }))}>★ Favorites only<//>
        </div>
      </div>

      ${anyFilter ? html`
        <${Frag}>
          <h3 className="sec-h">${results.length} match${results.length === 1 ? "" : "es"}</h3>
          <div className="grid">
            ${results.map((m) => html`<${MealCard} key=${m.id} meal=${m} onOpen=${onOpen} onFav=${onFav} />`)}
          </div>
          ${results.length === 0 && html`<p className="sub">Nothing matches this combination — remove a category to widen the search.</p>`}
        <//>`
        : html`<p className="sub">Pick a category above to start searching.</p>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Meals list tab                                                     */
/* ------------------------------------------------------------------ */
function MealsTab({ meals, onOpen, onFav, onNew, onPasteRecipe }) {
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
              <${MealCard} key=${m.id} meal=${m} onOpen=${onOpen} onFav=${onFav} />`)}
          </div>
        </div>`)}
      ${list.length === 0 && html`<p className="sub">No meals here yet — create one, or loosen the filters above.</p>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
function CookingOrganizer() {
  const [meals, setMeals] = useState([]);
  const [tab, setTab] = useState("overview"); // overview | meals | pantry | temps | <meal id>
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
      const live = new Set();
      for (const m of list) for (const it of m.items) if (it.kind === "image") live.add(imgKey(m.id, it.id));
      for (const b of await idb.getAll("backups")) for (const k of b.imageKeys || []) live.add(k);
      for (const k of await idb.keys("images")) {
        if (live.has(k) || pendingImages.has(k)) continue;
        await idb.del("images", k); dropUrl(k);
      }

      savedIds.current = list.map((m) => m.id);
      setDirty(false);
      refreshUsage();
      if (!quiet) flash("Saved ✓ (" + list.length + " meals)");
    } catch {
      if (!quiet) flash("Couldn't save to this browser's storage — use Download backup to keep a copy.");
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
            strokes: raw.strokes || [], variants: raw.variants || [], ingredients: raw.ingredients || [],
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
        setDirty(true);
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
      for (const m of b.meals) restored.push(await hydrateMeal(m));
      setMeals(restored);
      setDirty(true);
      await refreshBackups();
      setTab("meals");
      flash("Restored backup " + b.code + " (" + restored.length + " meals).");
    } catch { flash("Couldn't restore that backup."); }
  };

  /* ---------- meal edits ---------- */
  const updateMeal = (id) => (fnOrPatch) => {
    setMeals((ms) => ms.map((m) => {
      if (m.id !== id) return m;
      const next = typeof fnOrPatch === "function" ? fnOrPatch(m) : { ...m, ...fnOrPatch };
      return { ...next, modified: Date.now() };
    }));
    setDirty(true);
  };
  const toggleFav = (id) => updateMeal(id)((m) => ({ ...m, favorite: !m.favorite }));
  const addMeal = () => { const m = newMeal(); setMeals((ms) => [...ms, m]); setDirty(true); setTab(m.id); };
  const deleteMeal = (id) => {
    deletions.current = { ...deletions.current, [id]: Date.now() };
    setMeals((ms) => ms.filter((m) => m.id !== id));
    setDirty(true);
    setTab("meals");
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

  const mealFromRecipe = (p) => ({
    ...newMeal(),
    name: p.name, mealType: p.mealType, device: p.device,
    prepTime: p.prepTime, ingredients: p.ingredients,
    instructions: (p.temp ? "Oven / air fryer: " + p.temp + " °C\n\n" : "") + p.instructions,
  });
  const createFromRecipe = (p) => {
    const m = mealFromRecipe(p);
    setMeals((ms) => [...ms, m]);
    setDirty(true);
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
      ingredients: [...(m.ingredients || []), ...p.ingredients],
      instructions: (m.instructions ? m.instructions + "\n\n" : "") +
        (p.temp ? "Oven / air fryer: " + p.temp + " °C\n\n" : "") + p.instructions,
    }));
    setPasteOpen(false);
    flash("Filled in “" + p.name + "”.");
  };
  const addStarter = (recipe) => {
    const m = {
      ...newMeal(),
      name: recipe.name, mealType: recipe.mealType, device: recipe.device,
      prepTime: recipe.prepTime, rating: recipe.rating,
      ingredients: [...recipe.ingredients], instructions: recipe.instructions,
    };
    setMeals((ms) => [...ms, m]);
    setDirty(true);
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

      const { data: rows, error } = await Sync.supa.from("meals").select("id,modified");
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
        const { data: full, error: e2 } = await Sync.supa.from("meals").select("id,data,modified").in("id", wanted);
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
      setLastSync(new Date().toLocaleTimeString());
      flash("Synced ✓ (" + pushed.length + " up, " + pulled.length + " down)");
    } catch (err) {
      flash("Sync failed: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setSyncing(false);
      refreshUsage();
    }
  }, [saveAll, theme, pantry, customTemps, refreshUsage]);

  const syncedOnce = useRef(false);
  useEffect(() => {
    if (!ready || !user || syncedOnce.current) return;
    syncedOnce.current = true;
    syncNow();
  }, [ready, user, syncNow]);

  const cloud = {
    user, syncing, lastSync,
    onSignIn: async (email, pw) => { const u = await Sync.signIn(email, pw); setUser(u); },
    onSignUp: async (email, pw) => { await Sync.signUp(email, pw); },
    onSignOut: async () => { await Sync.signOut(); setUser(null); syncedOnce.current = false; },
    onSyncNow: syncNow,
  };
  const backupsPanel = {
    backups, busy: !ready,
    onCreate: async () => { const c = await makeSnapshot("manual"); if (c) flash("Backup created — code " + c + "."); },
    onRestore: restoreSnapshot,
    onDelete: async (code) => { await idb.del("backups", code); await refreshBackups(); flash("Backup " + code + " deleted."); },
  };

  const open = meals.find((m) => m.id === tab);
  const TABS = [["overview", "Overview & search"], ["meals", "Meals"], ["pantry", "What can I cook?"], ["temps", "Temps & times"]];

  return html`
    <div className="app">
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
          <span className=${"savestate" + (dirty ? " savestate-dirty" : "")}>${dirty ? "saving…" : "auto-saved ✓"}</span>
          <button className="btn btn-primary" onClick=${() => saveAll(false)}>Save</button>
        </div>
      </header>

      ${!ready
        ? html`<div className="loading">Opening the cookbook…</div>`
        : open
        ? html`
          <div className="page">
            <button className="btn btn-ghost back" onClick=${() => setTab("meals")}>← All meals</button>
            <${MealDetail} meal=${open} update=${updateMeal(open.id)} onDelete=${() => deleteMeal(open.id)}
              have=${haveSet} onPasteRecipe=${() => setPasteOpen(true)} />
          </div>`
        : tab === "meals"
        ? html`
          <div className="page">
            <${MealsTab} meals=${meals} onOpen=${setTab} onFav=${toggleFav} onNew=${addMeal}
              onPasteRecipe=${() => setPasteOpen(true)} />
          </div>`
        : tab === "pantry"
        ? html`
          <div className="page">
            <${PantryTab} meals=${meals} pantry=${pantry} setPantry=${setPantry}
              onOpen=${setTab} onAddStarter=${addStarter} />
          </div>`
        : tab === "temps"
        ? html`
          <div className="page">
            <${TempsTab} meals=${meals} onInsert=${insertTable}
              customTemps=${customTemps} setCustomTemps=${setCustomTemps} />
          </div>`
        : html`
          <div className="page">
            <${Overview} meals=${meals} status=${status} usage=${usage} cloud=${cloud} backupsPanel=${backupsPanel}
              onSave=${() => saveAll(false)} onBackup=${backup}
              onRestoreFile=${restoreFile} onOpen=${setTab} onFav=${toggleFav}
              onLoad=${async () => { const n = await loadAll(); flash(n ? "Restored last save (" + n + " meals)." : "No save found yet."); }} />
          </div>`}

      ${pasteOpen && html`
        <${RecipePaste} onClose=${() => setPasteOpen(false)}
          onCreate=${createFromRecipe} onFill=${fillFromRecipe}
          openMealName=${open ? open.name : null} />`}

      ${status && tab !== "overview" && html`<div className="toast">${status}</div>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */
ReactDOM.createRoot(document.getElementById("root")).render(html`<${CookingOrganizer} />`);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline start-up just won't work */ });
  });
}
