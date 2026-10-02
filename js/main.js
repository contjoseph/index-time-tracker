/* Index Time Tracker — all data is kept on this computer (browser storage, plus an optional auto-save file).
   Start-up and wiring: connects the store's hooks, starts every area, redraws (render), ticks every second (tick),
   switches tabs (setView), the taskbar badge and shortcuts, and the keys that work everywhere.
   Layers (CLAUDE.md §4): core/ and domain/ are pure logic; data/ is the data; ui/ is one module per area. */
import {bounds} from "./core/time.js";
import {KEY, S, intervals, load, onChange, onProblem, onSave} from "./data/store.js";
import {queueFile, reconnectFile} from "./ui/autosave.js";
import {fitBoard, initClocks, renderBoard, stopAll, stopRename, tickClocks, toggleBreak} from "./ui/clocks.js";
import {$, now, toast} from "./ui/dom.js";
import {closeEntryForm, fillSelects, initEntries, renderLog, showAdd} from "./ui/entries.js";
import {renderExtras} from "./ui/extras.js";
import {initInvoice} from "./ui/invoice.js";
import {closeMenu, initMenu, menu} from "./ui/menu.js";
import {initMini, renderMini, renderMiniBtn} from "./ui/mini.js";
import {hideNote, initNotes} from "./ui/notes.js";
import {initReports, lastReport, renderReport} from "./ui/reports.js";
import {heartbeat, initSafety, renderGap, resumeAway, tickSafety, tickTitle, urgent} from "./ui/safety.js";
import {checkPlanEnd, initSchedule, renderSchedule, sch, schEnd} from "./ui/schedule.js";
import {applyTheme, initSettings, renderSafe} from "./ui/settings.js";

// Redraw everything from the data (after any change); tick() then keeps the running parts current every second
export function render() {
  closeMenu();
  renderBoard();
  fillSelects(); renderReport(); renderLog(); renderSafe(); renderExtras(); renderSchedule();
  tick();
}
let schAt = 0;
export function tick() {
  const t = now(), iv = intervals(), b = bounds();
  tickSafety(t); checkPlanEnd(t); renderGap(t);
  tickClocks(t, iv, b);
  if (S.running.length && t - lastReport > 60000) renderReport();   // keep the report's totals current while clocks run
  if (t - schAt >= 60000 && !sch.drag) { schAt = t; if (!$('[data-pane="schedule"]').hidden) renderSchedule(); }   // the "time passed" veil moves on
  tickTitle(t, iv, b);
  renderMini(t, iv, b);
  badge(urgent() ? (Math.floor(t / 1000) % 2 ? S.running.length : 0) : S.breakStart ? "dot" : S.running.length);
}
// The installed app's taskbar icon: the number of running clocks, a dot on break, blinking while a question waits
let lastBadge = null;
function badge(b) {
  if (b === lastBadge || !navigator.setAppBadge) return;
  lastBadge = b;
  (b === "dot" ? navigator.setAppBadge() : b ? navigator.setAppBadge(b) : navigator.clearAppBadge()).catch(() => {});
}
// Views: Clocks, Reports, Schedule, Settings. The tracker always opens on Clocks.
export function setView(v) {
  document.querySelectorAll(".views [data-view]").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  document.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== v; });
  closeMenu(); window.scrollTo(0, 0);
  if (v === "clocks") fitBoard();
  if (v === "schedule") { sch.zone = "local"; renderSchedule(); }   // always opens in your time; today's column may have moved on
}
// Right-click menu on the taskbar icon (manifest "shortcuts") opens ?do=break or ?do=stop
function runShortcut(url) {
  const a = new URL(url).searchParams.get("do");
  if (a === "break") { if (S.breakStart || S.running.length) toggleBreak(); else toast("Start a clock first"); }
  else if (a === "stop") stopAll();
}

/* ---------- start ---------- */
onProblem(toast); onSave(queueFile); onChange(render);
initClocks(); initNotes(); initSafety(); initReports(); initEntries(); initMenu(); initInvoice(); initMini(); initSchedule(); initSettings();
$(".views").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
// Escape closes whatever is open, the most recent first
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#noteBar").hidden) { hideNote(); return; }
  if (sch.drag) { schEnd(false); return; }
  if (menu) { const a = menu.anchor; closeMenu(); if (a && a.isConnected) a.focus(); return; }
  if (stopRename()) render();
  if (closeEntryForm()) renderLog();
  if (!$("#addTime").hidden) showAdd(false);
});
// Keep several open tabs in step
window.addEventListener("storage", e => { if (e.key === KEY && e.newValue != null) { load(); render(); } });

load(); heartbeat(); applyTheme(); render(); renderMiniBtn(); reconnectFile(); resumeAway();
setInterval(tick, 1000);
if ("launchQueue" in window) launchQueue.setConsumer(p => { if (p.targetURL) runShortcut(p.targetURL); });
else runShortcut(location.href);
if (location.search) history.replaceState(null, "", location.pathname);
// Ask the browser not to clear this site's storage when the disk gets full
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
