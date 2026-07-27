/* The Cookbook Board — service worker.
   Makes the app itself open with no connection. Your meals were always offline
   (they live in IndexedDB); this caches the page, the app code and the CDN
   libraries so the app can start at all when you're offline.

   Deliberately never touches Supabase traffic — API and Storage requests always
   go to the network, so you can't be served a stale cookbook. */
const CACHE = "cookbook-v2";
const SHELL = ["./", "./index.html", "./app.js", "./data.js", "./recipe-parser.js",
  "./config.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never cache Supabase — login, meals and photos must always be live.
  if (url.hostname.endsWith("supabase.co")) return;

  // React / htm / supabase-js from the CDN. Version tags float, so cached-forever
  // would pin one build for good — serve the cached copy for speed and offline
  // start-up, but refresh it in the background so updates do land eventually.
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Our own files: network-first so updates land as soon as you're online,
  // falling back to the cached copy (and then the app shell) when you're not.
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
