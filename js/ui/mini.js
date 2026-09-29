/* The mini tracker: a small window that stays on top of other windows (Chrome and Edge). */
import {fmt, worked} from "../core/time.js";
import {ACTIVITIES} from "../domain/activities.js";
import {P, S, proj} from "../data/store.js";
import {tick} from "../main.js";
import {toggleBreak} from "./clocks.js";
import {$, PAUSE, PLAY, now, setHTML, toast} from "./dom.js";
import {endBreakAt, gap, keepGap, snoozeBreak, stopAtGap, takeOutAway, unlockSound} from "./safety.js";
import {applyTheme} from "./settings.js";

/* ---------- mini tracker: a small window that stays on top of other windows (Chrome and Edge) ---------- */
// It lives only while the main window is open (minimised is fine). It uses the main window's code and styles.
export const canMini = "documentPictureInPicture" in window;
export let mini = null;
export async function toggleMini() {
  if (mini) { mini.close(); return; }
  try { mini = await documentPictureInPicture.requestWindow({width: 230, height: 56}); }
  catch { toast("The mini tracker couldn't open"); return; }
  const d = mini.document;
  for (const n of document.querySelectorAll('link[rel="stylesheet"]')) { const l = d.createElement("link"); l.rel = "stylesheet"; l.href = n.href; d.head.appendChild(l); }
  d.title = "Time Tracker";
  d.body.className = "mini";
  d.body.innerHTML = `<div id="m"></div>`;
  d.addEventListener("click", miniClick);
  d.addEventListener("pointerdown", unlockSound, true);
  mini.addEventListener("pagehide", () => { mini = null; renderMiniBtn(); });
  mini.setInterval(tick, 1000);   // its own timer keeps it ticking while the main window is minimised
  applyTheme(); renderMiniBtn(); tick();
}
export function renderMiniBtn() {
  const b = $("#miniBtn");
  b.hidden = !canMini;
  b.setAttribute("aria-pressed", !!mini);
  b.querySelector("span").textContent = mini ? "Close mini tracker" : "Mini tracker";
}
export function renderMini(t, iv, b) {   // one strip: today's hours and BREAK, or the tracker's question
  if (!mini) return;
  const d = mini.document, box = d.getElementById("m"); if (!box) return;
  const btn = (k, label, cls = "") => `<button type="button" class="sbtn${cls}" data-m="${k}">${label}</button>`;
  let html;
  if (gap) {
    const q = gap.kind === "check" ? "Still working?" : gap.kind === "break" ? `On break ${fmt(t - gap.from)}?` : gap.kind === "plan" ? "Plan ended" : gap.kind === "away" ? `Away ${fmt(gap.until - gap.from)}` : "Tracker was off";
    html = `<div class="strip ask"><p>${q}</p>${gap.kind === "check" ? btn("keep", "Yes") + btn("stop", "No", " ghost")
      : gap.kind === "break" ? btn("endbrk", "End", " go") + btn("later", "Later", " ghost")
      : gap.kind === "plan" ? btn("keep", "Keep") + btn("stop", "Stop", " ghost")
      : gap.kind === "away" ? btn("keep", "Keep") + btn("take", "Take out", " ghost") : btn("keep", "Keep") + btn("stop", "Stop", " ghost")}</div>`;
  } else {
    const r = S.running[0] || S.paused[0], i = r ? ACTIVITIES.findIndex(a => a.id === r.activityId) : -1;
    html = `<div class="strip${S.breakStart ? " brk" : ""}"${i >= 0 ? ` style="--c:var(--a${i % 7})"` : ""}>
      <span class="sdot${S.running.length ? " on" : ""}"></span><div class="stime"><b data-mtot></b><small data-msub></small></div>
      ${S.breakStart ? btn("break", PLAY + "End break", " go") : `<button type="button" class="sbtn" data-m="break" ${S.running.length ? "" : "disabled"}>${PAUSE}Start break</button>`}</div>`;
  }
  setHTML(box, html);
  const tot = d.querySelector("[data-mtot]"); if (tot) tot.textContent = fmt(worked(b.day, iv));
  const sub = d.querySelector("[data-msub]");
  if (sub) sub.textContent = S.breakStart ? `on break ${fmt(t - S.breakStart)}` : S.running.length ? "today" : "today · no clock on";
  // Hovering the strip names the clocks that are running
  const names = S.running.concat(S.paused).map(r => `${(proj(r.projectId) || {}).name}: ${(ACTIVITIES.find(a => a.id === r.activityId) || {}).name}`);
  const strip = d.querySelector(".strip"); if (strip) strip.title = names.join("\n");
}
export function miniClick(e) {
  const el = e.target.closest("[data-m]"); if (!el || el.disabled) return;
  const k = el.dataset.m;
  if (k === "break") toggleBreak();
  else if (k === "keep" && gap) keepGap();
  else if (k === "take" && gap && gap.kind === "away") takeOutAway();
  else if (k === "stop" && gap) stopAtGap();
  else if (k === "endbrk" && gap && gap.kind === "break") endBreakAt(now());
  else if (k === "later" && gap && gap.kind === "break") snoozeBreak(P.get("break-snooze"));   // the last choice (5 min at first)
}

// Events for this area (called once at start-up by js/main.js)
export function initMini() {
$("#miniBtn").addEventListener("click", toggleMini);
}
