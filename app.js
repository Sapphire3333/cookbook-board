/* ============================================================
   The Cookbook Board
   ------------------------------------------------------------
   Same app as the original artifact, with three changes:

   1. Storage. window.storage is gone. Meals live in IndexedDB
      (database "cookbook"), one record per meal — the same
      per-meal keying idea as before, so an index of meal ids plus
      one record each. Photos do NOT live inside the meal record:
      each photo is a Blob in its own store, keyed
      "<mealId>__<itemId>". Blobs are disk-backed and roughly a
      third smaller than the base64 data URLs the artifact kept in
      memory, which is what lets this hold hundreds of photos.
      In memory a photo is an object URL; it only ever becomes a
      data URL when you export a backup.

   2. Backups. Byte-identical format to the artifact —
      { app, exported, meals } with photos inlined as data URLs —
      so old backup files restore here and new ones would restore
      there.

   3. Optional Supabase sync (see config.js / schema.sql), so the
      same cookbook opens on your phone and your computer.
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;
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

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const imgKey = (mealId, itemId) => mealId + "__" + itemId;

function newMeal() {
  return {
    id: uid(), name: "New meal", mealType: "Dinner", device: "Stovetop",
    prepTime: 30, rating: 7.0, favorite: false, coverId: null, variants: [],
    instructions: "", items: [], strokes: [], boardH: 640,
    created: Date.now(), modified: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/*  IndexedDB                                                          */
/*  meals  — one record per meal, photos stripped out                  */
/*  images — one Blob per photo, key "<mealId>__<itemId>"              */
/*  meta   — settings, the meal-id index, the deleted-meal tombstones  */
/* ------------------------------------------------------------------ */
const DB_NAME = "cookbook";
const DB_VER = 1;
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
/* Downscale to 1200px on the long edge and re-encode as JPEG, exactly as the
   artifact did — only the result is a Blob rather than a data URL. */
async function processImageFile(file) {
  const MAX = 1200;
  let src = null, img = null;
  try {
    src = URL.createObjectURL(file);
    img = await loadImgEl(src);
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
/* Photo bytes never go into the meal record — only the geometry does. */
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
  return { ...meal, items, variants: meal.variants || [], strokes: meal.strokes || [] };
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

  /* Upload any photo of this meal that isn't in the bucket yet, then write the
     row. Returns the meal with fresh "remote" paths so we don't re-upload. */
  async pushMeal(meal) {
    const items = [];
    for (const it of meal.items) {
      if (it.kind !== "image" || it.remote) { items.push(it); continue; }
      const key = imgKey(meal.id, it.id);
      const blob = await idb.get("images", key);
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

  /* Bring a remote meal down, fetching any photo we don't already hold. */
  async pullMeal(row) {
    const meal = row.data;
    meal.id = row.id;
    meal.modified = row.modified;
    for (const it of meal.items || []) {
      if (it.kind !== "image" || !it.remote) continue;
      const key = imgKey(meal.id, it.id);
      const have = await idb.get("images", key);
      if (have) continue;
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
/*  Meal board (images + notepads + drawing)                           */
/* ------------------------------------------------------------------ */
function MealBoard({ meal, mode, draw, update, onDropImage, sizeRef }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const drawRef = useRef(null);
  const [ephem, setEphem] = useState(null); // {id, padId, dx, dy, dw, dh}
  const [live, setLive] = useState(null);   // stroke in progress

  const pt = (e) => {
    const r = boardRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  /* Let the detail view know how wide the board actually is, so a photo added
     on a phone lands somewhere you can reach rather than off the right edge. */
  useEffect(() => {
    if (!sizeRef) return;
    const measure = () => {
      if (boardRef.current) sizeRef.current = boardRef.current.getBoundingClientRect().width;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [sizeRef]);

  /* ----- drawing -----
     Pointer capture keeps the whole stroke coming to the board even when your
     finger slides off it, and touch-action:none on the board stops the page
     scrolling underneath while you draw. */
  const drawDown = (e) => {
    if (mode !== "draw" || !e.isPrimary) return;
    e.preventDefault();
    try { boardRef.current.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
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

  /* ----- arrange: move / resize -----
     One pointer only, captured on the element you grabbed, so a second finger
     (pinch-zooming the page) never hijacks the drag. */
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
      update((m) => {
        let items = m.items.map((it) => {
          if (it.id === d.id) return { ...it, x: it.x + dx, y: it.y + dy };
          if (d.isPad && it.parent === d.id) return { ...it, x: it.x + dx, y: it.y + dy };
          return it;
        });
        const strokes = d.isPad ? m.strokes.map((s) => (s.parent === d.id ? translateStroke(s, dx, dy) : s)) : m.strokes;
        // re-parent a moved image / re-check pad membership
        if (!d.isPad) {
          const moved = items.find((it) => it.id === d.id);
          if (moved && moved.kind === "image") {
            const cx = moved.x + moved.w / 2, cy = moved.y + moved.h / 2;
            const pad = [...items].reverse().find((it) => it.kind === "note" && inside(cx, cy, it));
            items = items.map((it) => (it.id === d.id ? { ...it, parent: pad ? pad.id : null } : it));
          }
        }
        return { ...m, items, strokes };
      });
    } else {
      const dw = e.clientX - d.sx, dh = e.clientY - d.sy;
      update((m) => ({
        ...m,
        items: m.items.map((it) => (it.id === d.id ? { ...it, w: Math.max(60, d.w + dw), h: Math.max(50, d.h + dh) } : it)),
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

  const dragHandlers = { onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragCancel };

  return html`
    <div ref=${boardRef} className=${"board board-" + mode} style=${{ height: meal.boardH }}
      onPointerDown=${drawDown} onPointerMove=${drawMove} onPointerUp=${drawUp} onPointerCancel=${drawCancel}
      onDragOver=${(e) => { e.preventDefault(); }}
      onDrop=${(e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        onDropImage([...e.dataTransfer.files]);
      }}>

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
                  onClick=${() => update((m) => ({
                    ...m,
                    items: m.items.filter((x) => x.id !== it.id).map((x) => (x.parent === it.id ? { ...x, parent: null } : x)),
                    strokes: m.strokes.map((s) => (s.parent === it.id ? { ...s, parent: null } : s)),
                  }))}>✕</button>`}
            </div>
            <textarea className="note-text" value=${it.text || ""} placeholder="jot something…"
              readOnly=${mode === "draw"}
              onChange=${(e) => update((m) => ({ ...m, items: m.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) }))}
              onPointerDown=${(e) => { if (mode !== "draw") e.stopPropagation(); }} />
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
                  onClick=${() => update((m) => ({
                    ...m,
                    items: m.items.filter((x) => x.id !== it.id),
                    coverId: m.coverId === it.id ? null : m.coverId,
                  }))}>✕</button>
                <div className="handle" onPointerDown=${(e) => startResize(e, it)} ...${dragHandlers}></div>
              <//>`}
          </div>`;
      })}

      <svg className="strokes" style=${{ pointerEvents: "none" }}>
        ${meal.strokes.map((s, i) => renderStroke(s, s.id || i))}
        ${live && renderStroke(live, "live")}
      </svg>

      ${meal.items.length === 0 && meal.strokes.length === 0 && html`
        <div className="board-empty">Paste, drop or upload photos, add a notepad, or switch to Draw. Everything lands on this board.</div>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Meal detail                                                        */
/* ------------------------------------------------------------------ */
function MealDetail({ meal, update, onDelete }) {
  const [mode, setMode] = useState("view");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#D8341F");
  const [size, setSize] = useState(4);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const fileRef = useRef(null);
  const cascade = useRef(0);
  const boardW = useRef(900);
  const mealId = meal.id;

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
        const bw = boardW.current || 900;
        const scale = Math.min(1, Math.min(260, bw - 32) / Math.max(w, h));
        const iw = Math.round(w * scale), ih = Math.round(h * scale);
        const n = (cascade.current = (cascade.current + 1) % 8);
        update((m) => ({
          ...m,
          items: [...m.items, {
            id: itemId, kind: "image", src: urlFor(key, blob),
            x: Math.max(8, Math.min(24 + n * 34, bw - iw - 8)), y: 24 + n * 30,
            w: iw, h: ih, parent: null,
          }],
        }));
      } catch { /* skip unreadable file */ }
      // Released on a timer, not straight away: the state update above still has
      // to be rendered before mealsRef — which the sweep reads — knows about it.
      finally { if (key) { const k = key; setTimeout(() => pendingImages.delete(k), 5000); } }
      setBusy((b) => b - 1);
    }
  }, [update, mealId]);

  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addImages]);

  const addNote = () =>
    update((m) => {
      const w = Math.min(240, Math.max(140, (boardW.current || 900) - 48));
      return { ...m, items: [...m.items, { id: uid(), kind: "note", x: 24, y: 40, w, h: 200, text: "", parent: null }] };
    });

  const set = (k) => (e) => update((m) => ({ ...m, [k]: e.target.value }));

  return html`
    <div className="detail">
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
        ${busy > 0
          ? html`<span className="hint">adding ${busy} photo${busy > 1 ? "s" : ""}…</span>`
          : html`<span className="hint">…or paste / drop an image on this page</span>`}

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
          <span className="hint">drag anything · corner handle resizes · drop images onto a notepad and they stick to it</span>`}
      </div>

      <${MealBoard} meal=${meal} mode=${mode} draw=${{ tool, color, size }} update=${update}
        onDropImage=${addImages} sizeRef=${boardW} />
      <button className="btn btn-ghost" onClick=${() => update((m) => ({ ...m, boardH: m.boardH + 320 }))}>+ more board space</button>

      <h3 className="sec-h">Instructions</h3>
      <textarea className="instructions" value=${meal.instructions} onChange=${set("instructions")}
        placeholder=${"1. …\n2. …"} />
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
/*  Overview tab (storage + search)                                    */
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
function MealsTab({ meals, onOpen, onFav, onNew }) {
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
  const [tab, setTab] = useState("overview"); // 'overview' | 'meals' | meal id
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState("none");
  const [usage, setUsage] = useState("—");
  const [user, setUser] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const savedIds = useRef([]);
  const deletions = useRef({});   // { mealId: deletedAt }
  const autoTimer = useRef(null);
  const mealsRef = useRef(meals);
  mealsRef.current = meals;

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus((s) => (s === msg ? "" : s)), 4000); };

  /* ---------- how much space the cookbook takes ---------- */
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
      await loadAll();
      // Ask the browser not to evict the cookbook when disk gets tight.
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* unsupported */ }
    })().finally(() => setReady(true));
  }, [loadAll]);

  /* ---------- restore a Supabase session on start ---------- */
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

  /* ---------- save ---------- */
  const saveAll = useCallback(async (quiet) => {
    const list = mealsRef.current;
    try {
      for (const m of list) await idb.put("meals", stripMeal(m));
      const gone = savedIds.current.filter((id) => !list.some((m) => m.id === id));
      for (const id of gone) { try { await idb.del("meals", id); } catch { /* already gone */ } }
      await idb.put("meta", { ids: list.map((m) => m.id), at: Date.now() }, "index");
      await idb.put("meta", deletions.current, "deletions");

      // Sweep photos that no meal references any more.
      const live = new Set();
      for (const m of list) for (const it of m.items) if (it.kind === "image") live.add(imgKey(m.id, it.id));
      const keys = await idb.keys("images");
      for (const k of keys) {
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
  }, [refreshUsage]);

  // Autosave: any change is written to storage after a short pause.
  useEffect(() => {
    if (!ready || !dirty) return;
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { saveAll(true); }, 1500);
    return () => clearTimeout(autoTimer.current);
  }, [ready, dirty, meals, saveAll]);

  /* ---------- backup ---------- */
  /* Format is identical to the artifact's: photos are inlined as data URLs,
     so a file from either version restores into either version. */
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
    const blob = new Blob([JSON.stringify({ app: "cooking-organizer", exported: Date.now(), meals: out }, null, 1)], { type: "application/json" });
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
          const m = { ...raw, id: raw.id || uid(), items: raw.items || [], strokes: raw.strokes || [], variants: raw.variants || [] };
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
        setMeals(restored);
        setDirty(true);
        flash("Backup loaded (" + restored.length + " meals) — press Save to keep it.");
      } catch { flash("That file doesn't look like a cookbook backup."); }
    };
    r.readAsText(file);
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

  /* ---------- cloud sync ---------- */
  const syncNow = useCallback(async () => {
    if (!Sync.user) return;
    setSyncing(true);
    try {
      await saveAll(true);

      // 1. push our tombstones, and merge in anyone else's
      const remoteDel = (await Sync.getMeta("deletions")) || {};
      const mergedDel = { ...remoteDel, ...deletions.current };
      for (const id of Object.keys(deletions.current)) {
        const local = mealsRef.current.find((m) => m.id === id);
        await Sync.deleteMeal(id, local ? local.items : []);
      }

      // 2. what does the cloud have?
      const { data: rows, error } = await Sync.supa.from("meals").select("id,modified");
      if (error) throw error;
      const remoteById = new Map((rows || []).map((r) => [r.id, r.modified]));
      const localById = new Map(mealsRef.current.map((m) => [m.id, m]));

      // 3. push everything newer here (or missing there)
      const pushed = [];
      for (const m of mealsRef.current) {
        const rm = remoteById.get(m.id);
        if (rm === undefined || (m.modified || 0) > rm) pushed.push(await Sync.pushMeal(m));
      }
      if (pushed.length) {
        setMeals((ms) => ms.map((m) => pushed.find((p) => p.id === m.id) || m));
      }

      // 4. pull everything newer there (or missing here), skipping deleted meals
      const wanted = (rows || []).filter((r) => {
        if (mergedDel[r.id] && mergedDel[r.id] > r.modified) return false;
        const lm = localById.get(r.id);
        return !lm || r.modified > (lm.modified || 0);
      }).map((r) => r.id);

      let pulled = [];
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

      // 5. settings + tombstones back up
      deletions.current = mergedDel;
      await Sync.setMeta("deletions", mergedDel);
      const remoteSettings = await Sync.getMeta("settings");
      if (remoteSettings && remoteSettings.theme && FRAMES[remoteSettings.theme] && remoteSettings.theme !== theme) {
        setTheme(remoteSettings.theme);
        await idb.put("meta", { theme: remoteSettings.theme }, "settings");
      } else {
        await Sync.setMeta("settings", { theme });
      }

      setDirty(true);            // persist whatever came down
      setLastSync(new Date().toLocaleTimeString());
      flash("Synced ✓ (" + pushed.length + " up, " + pulled.length + " down)");
    } catch (err) {
      flash("Sync failed: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setSyncing(false);
      refreshUsage();
    }
  }, [saveAll, theme, refreshUsage]);

  // A first sync as soon as we know who you are.
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

  const open = meals.find((m) => m.id === tab);

  return html`
    <div className="app">
      <${Frame} theme=${theme} />
      <header className="top">
        <div className="brand">The Cookbook Board</div>
        <nav className="tabs">
          <button className=${tab === "overview" ? "tab-on" : ""} onClick=${() => setTab("overview")}>Overview & search</button>
          <button className=${tab === "meals" ? "tab-on" : ""} onClick=${() => setTab("meals")}>Meals</button>
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
            <${MealDetail} meal=${open} update=${updateMeal(open.id)} onDelete=${() => deleteMeal(open.id)} />
          </div>`
        : tab === "meals"
        ? html`
          <div className="page">
            <${MealsTab} meals=${meals} onOpen=${setTab} onFav=${toggleFav} onNew=${addMeal} />
          </div>`
        : html`
          <div className="page">
            <${Overview} meals=${meals} status=${status} usage=${usage} cloud=${cloud}
              onSave=${() => saveAll(false)} onBackup=${backup}
              onRestoreFile=${restoreFile} onOpen=${setTab} onFav=${toggleFav}
              onLoad=${async () => { const n = await loadAll(); flash(n ? "Restored last save (" + n + " meals)." : "No save found yet."); }} />
          </div>`}

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
