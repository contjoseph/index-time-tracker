// Lets the tracker open offline and be installed as an app.
const CACHE = "itt-v11";
const FILES = ["./", "index.html", "style.css", "app.js", "reports.js", "manifest.webmanifest", "icon.svg",
  "lib/exceljs.min.js", "lib/jspdf.umd.min.js", "lib/jspdf.plugin.autotable.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
// Network first, so updates you push to GitHub show up; cache when offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
