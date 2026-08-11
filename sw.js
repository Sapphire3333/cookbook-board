/* The Cookbook Board — service worker.
   Makes the app itself open with no connection. Your meals were always offline
   (they live in IndexedDB); this caches the page, the app code and the CDN
   libraries so the app can start at all when you're offline.

   Deliberately never touches Supabase traffic — API and Storage requests always
   go to the network, so you can't be served a stale cookbook. */
/* The build stamp arrives in this worker's own address (sw.js?v=…), put there
   by index.html from version.js. Naming the cache after it means every build
   gets a fresh cache and the old one is deleted on activate — stale files
   can't outlive the build they belonged to. */
const CACHE = "cookbook-" + (new URL(self.location.href).searchParams.get("v") || "v3");
const SHELL = ["./", "./index.html", "./app.js", "./data.js", "./recipe-parser.js",
  "./version.js", "./config.js", "./manifest.json", "./icon.svg",
  "./vendor/react.production.min.js", "./vendor/react-dom.production.min.js",
  "./vendor/htm.umd.js", "./vendor/supabase.js"];

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

  if (url.origin !== self.location.origin) return;

  // The libraries in /vendor never change unless the app is redeployed, so they
  // are served straight from cache. This is what makes a cold start work with no
  // connection at all — and why a flaky moment can no longer stop the app
  // loading, which is exactly what a code network used to do to it.
  if (url.pathname.indexOf("/vendor/") !== -1) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Our own files: network-first so updates land as soon as you're online,
  // falling back to the cached copy (and then the app shell) when you're not.
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
