// Lets the tracker open offline and be installed as an app.
const CACHE = "itt-v27";
const FILES = ["./", "index.html", "style.css", "manifest.webmanifest", "icon.svg",
  "js/main.js", "js/core/time.js", "js/core/zones.js", "js/data/prefs.js", "js/data/schema.js",
  "js/data/store.js", "js/domain/activities.js", "js/domain/board.js", "js/domain/breaks.js", "js/domain/invoice.js", "js/domain/report.js", "js/domain/schedule.js",
  "js/lib/reports.js", "js/ui/autosave.js", "js/ui/clocks.js", "js/ui/dom.js", "js/ui/entries.js",
  "js/ui/export.js", "js/ui/extras.js", "js/ui/invoice.js", "js/ui/menu.js", "js/ui/mini.js",
  "js/ui/notes.js", "js/ui/reports.js", "js/ui/safety.js", "js/ui/schedule.js", "js/ui/settings.js",
  "lib/exceljs.min.js", "lib/jspdf.umd.min.js", "lib/jspdf.plugin.autotable.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
// Network first, so updates you push to GitHub show up; cache when offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: e.request.mode === "navigate"})));   // taskbar shortcuts open ./?do=…
});
