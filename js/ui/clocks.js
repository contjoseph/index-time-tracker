/* The Clocks tab: clocks and break, projects (add, rename, Embedding, close, reopen, delete), the board,
   the clock faces, the dashboard, and fitting the view and the installed app's window. */
import {clockSum, dec, fmt, loc, worked} from "../core/time.js";
import {ACTIVITIES, MAIN} from "../domain/activities.js";
import {schDay, schH} from "../domain/schedule.js";
import {P, S, commit, hasExtra, intervals, proj, save, shortName, uid} from "../data/store.js";
import {render} from "../main.js";
import {$, I, PAUSE, PLAY, copyText, esc, now, setHTML, toast} from "./dom.js";
import {opt} from "./extras.js";
import {openMenu} from "./menu.js";
import {askNote} from "./notes.js";
import {planned} from "./schedule.js";

export let editing = null;   // the project whose rename form is open
export function stopRename() { if (!editing) return false; editing = null; return true; }   // true if one was open

/* ---------- actions ---------- */
export const same = (x, p, a) => x.projectId === p && x.activityId === a;
export function record(r, end) {
  if (end - r.start < 5000) return null;     // ignore accidental double-clicks
  const e = {id: uid(), projectId: r.projectId, activityId: r.activityId, start: r.start, end};
  S.entries.push(e);
  return e;
}
export function toggleClock(p, a) {
  if (S.breakStart) return;
  const r = S.running.find(x => same(x, p, a));
  let stopped = null;
  if (r) { stopped = record(r, now()); S.running = S.running.filter(x => x !== r); }
  else S.running.push({projectId: p, activityId: a, start: now()});
  commit();
  if (stopped && opt("notes")) askNote(stopped);
}
// Start or end a break. Ending can restart the clocks from an earlier moment `at` ("End at 10:02, when I came back").
export function toggleBreak(at) {
  const t = now();
  if (S.breakStart) {
    const from = typeof at === "number" ? Math.min(Math.max(at, S.breakStart), t) : t;
    S.running = S.paused.filter(x => proj(x.projectId)).map(x => ({projectId: x.projectId, activityId: x.activityId, start: from}));
    toast(`Back to work — break lasted ${fmt(from - S.breakStart)}`);
    S.paused = []; S.breakStart = null;
  } else {
    if (!S.running.length) return;
    S.running.forEach(r => record(r, t));
    S.paused = S.running.map(r => ({projectId: r.projectId, activityId: r.activityId}));
    S.running = []; S.breakStart = t;
  }
  clearBreakAsk();
  commit();
}
// The "Still on break?" schedule belongs to one break only
function clearBreakAsk() { P.set("break-ask", null); P.set("break-snooze", null); }
export function stopAll() {   // from the taskbar's right-click menu
  const t = now(), n = S.running.length + S.paused.length;
  if (!n) { toast("No clocks are running"); return; }
  const stopped = S.running.map(r => record(r, t)).filter(Boolean);
  S.running = []; S.paused = []; S.breakStart = null; clearBreakAsk();
  commit(); toast(`Stopped ${n} clock${n === 1 ? "" : "s"}`);
  if (stopped.length === 1 && opt("notes")) askNote(stopped[0]);
}
export function addProject(name, short = "") {
  name = name.trim(); short = short.trim();
  if (!name) { toast("Type a project name first"); return false; }
  const clash = S.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (clash) { toast(clash.closed ? "A closed project has that name. Reopen it from the Closed projects tab." : "That project already exists"); return false; }
  S.projects.push({id: uid(), name, created: now(), ...(short && short !== name ? {short} : {})});
  commit(); return true;
}
export function startRename(id) {
  editing = id; render();
  const i = document.querySelector(`[data-rename="${id}"] input`); if (i) { i.focus(); i.select(); }
}
/* ---------- closing a finished project ---------- */
// A closed project leaves the clock board but keeps all its time; it moves to the Closed projects tab.
export const openProjects = () => S.projects.filter(p => !p.closed);
export function projectTotals(p) {
  const mine = S.entries.filter(e => e.projectId === p.id);
  const acts = ACTIVITIES.map(a => ({id: a.id, name: a.name, ms: mine.filter(e => e.activityId === a.id).reduce((s, e) => s + e.end - e.start, 0)}));
  const starts = mine.map(e => e.start), ends = mine.map(e => e.end);
  return {acts, tot: acts.reduce((s, a) => s + a.ms, 0), first: starts.length ? Math.min(...starts) : 0, last: ends.length ? Math.max(...ends) : 0};
}
// The text copied for Basecamp: total, then only the activities that have time
export function closeSummary(p) {
  const {acts, tot} = projectTotals(p);
  return `${p.name} — closed ${loc(p.closed, {weekday: "short", day: "numeric", month: "short", year: "numeric"})}\n\nTotal time: ${fmt(tot)} (${dec(tot)} h)\n`
    + acts.filter(a => a.ms).map(a => `  ${a.name}: ${fmt(a.ms)} (${dec(a.ms)} h)`).join("\n");
}
export async function showSummary(p, justClosed) {
  const text = closeSummary(p), ok = await copyText(text);
  $("#closedTitle").textContent = justClosed ? `${p.name} is closed` : p.name;
  $("#closedText").textContent = text;
  $("#closedMsg").innerHTML = ok ? `✓ Copied to your clipboard. <b>Remember to post your time on Basecamp.</b>`
    : `Couldn't copy automatically. Click <b>Copy again</b>, then post your time on Basecamp.`;
  const dlg = $("#closedDlg");
  if (!dlg.open) dlg.showModal();
}
export function closeProject(id) {
  const p = proj(id), t = now(); if (!p) return;
  S.running.filter(r => r.projectId === id).forEach(r => record(r, t));
  S.running = S.running.filter(r => r.projectId !== id);
  S.paused = S.paused.filter(r => r.projectId !== id);
  if (S.breakStart && !S.paused.length) S.breakStart = null;
  p.closed = t; editing = null;
  commit(); showSummary(p, true);
}
export function reopenProject(id) {
  const p = proj(id); if (!p) return;
  delete p.closed; commit(); toast(`${p.name} is back on the clock board`);
}
export function deleteProject(id) {
  const p = proj(id);
  S.projects = S.projects.filter(p => p.id !== id);
  S.entries = S.entries.filter(e => e.projectId !== id);
  S.running = S.running.filter(r => r.projectId !== id);
  S.paused = S.paused.filter(r => r.projectId !== id);
  if (S.breakStart && !S.paused.length) S.breakStart = null;
  editing = null; commit();
  if (p) toast(`${p.name} deleted`);
}
/* ---------- clock face ---------- */
export const TICKS = Array.from({length: 12}, (_, i) => {
  const a = i * Math.PI / 6, r1 = i % 3 ? 30 : 27;
  return `<line class="tick" x1="${(40 + r1 * Math.sin(a)).toFixed(2)}" y1="${(40 - r1 * Math.cos(a)).toFixed(2)}" x2="${(40 + 33 * Math.sin(a)).toFixed(2)}" y2="${(40 - 33 * Math.cos(a)).toFixed(2)}"/>`;
}).join("");
// The hand is a minute hand: one full turn per hour, starting at 12. It isn't wrapped at 360°, so it can glide
// forward smoothly (a CSS transition) without spinning backwards at the top of the hour.
export const angle = ms => ms / 10000;
// Each full hour colors in one twelfth of the face. After 12 hours the face keeps a light fill, and the next hours
// color in again on top. Changes once an hour, so it costs next to nothing.
export const HOUR = 3600000;
export function wedges(ms) {
  const h = Math.floor(ms / HOUR), cur = h % 12;
  let out = h >= 12 ? `<circle class="lap" cx="40" cy="40" r="34"/>` : "";
  if (cur) {
    const a = cur * Math.PI / 6, x = (40 + 34 * Math.sin(a)).toFixed(2), y = (40 - 34 * Math.cos(a)).toFixed(2);
    out += `<path class="w" d="M40 40 L40 6 A34 34 0 ${cur > 6 ? 1 : 0} 1 ${x} ${y} Z"/>`;
  }
  return out;
}
export const face = (ms, key) => `<div class="face"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="rim" cx="40" cy="40" r="36"/><g class="hrs" data-hrs="${key}" data-h="${Math.floor(ms / HOUR)}">${wedges(ms)}</g>${TICKS}<line class="hand" data-hand="${key}" x1="40" y1="40" x2="40" y2="14" style="transform:rotate(${angle(ms)}deg)"/><circle class="hub" cx="40" cy="40" r="3.5"/></svg></div>`;
// The small face on the Embed chip, and its 60-second fill (a CSS animation, started at the right second)
export const chipFace = (ms, key) => `<svg class="xf" viewBox="0 0 80 80" aria-hidden="true"><circle class="rim" cx="40" cy="40" r="34"/><line class="hand" data-hand="${key}" x1="40" y1="40" x2="40" y2="16" style="transform:rotate(${angle(ms)}deg)"/><circle class="hub" cx="40" cy="40" r="6"/></svg>`;

/* ---------- fitting the Clocks view to your projects ---------- */
// The board shows up to 5 projects, then scrolls (the heading row stays put). It's never taller than the screen.
// The installed app's window then fits itself around the page, but only when it opens and when the number of
// projects changes, so it doesn't jump about while you work or fight you when you size it yourself.
export const FIT_ROWS = 5;
export let fitCount = -1;
export const clocksShown = () => !$('[data-pane="clocks"]').hidden;
export function fitBoard() {
  const bd = $("#board");
  bd.style.maxHeight = "";
  if (!clocksShown() || innerWidth <= 760) return;   // narrow windows and phones scroll the page instead
  const head = bd.querySelector(".row.head"), rows = [...bd.querySelectorAll(".row:not(.head)")];
  if (!rows.length) return;
  const want = (head ? head.offsetHeight : 0) + rows.slice(0, FIT_ROWS).reduce((s, r) => s + r.offsetHeight, 0) + 2;
  const rest = $(".wrap").offsetHeight - bd.offsetHeight;                   // everything on the page but the board
  const room = screen.availHeight - (outerHeight - innerHeight) - rest;    // what fits on this screen
  const max = Math.max(160, Math.min(want, room));
  if (max < bd.scrollHeight) bd.style.maxHeight = max + "px";
}
export let fitUntil = 0, frameH = 0, resizedAt = 0;
export function fitWindow() {   // fits now, and again if the page settles to a new height within 3 s (the font arriving, say)
  fitUntil = now() + 3000;
  requestAnimationFrame(fitNow);
}
if ("ResizeObserver" in window) new ResizeObserver(() => { if (now() < fitUntil) fitNow(); }).observe($(".wrap"));
export function fitNow() {
  if (!matchMedia("(display-mode: standalone)").matches || !clocksShown()) return;     // only the installed app
  if (outerWidth >= screen.availWidth - 8 && outerHeight >= screen.availHeight - 8) return;   // maximised: leave it
  fitBoard();
  // The title bar's height, measured only when no resize of ours is under way (sizes lag for a moment after one)
  if (!frameH || now() - resizedAt > 600) frameH = outerHeight - innerHeight;
  const h = frameH + $(".wrap").offsetHeight;
  if (Math.abs(h - outerHeight) > 1) { resizedAt = now(); try { resizeTo(outerWidth, h); } catch {} }
}

export function renderBoard() {
  const iv = intervals();
  let h = `<div class="row head" style="--n:${MAIN.length}"><div class="hp">Project<button type="button" class="btn ghost addp" data-add="1" title="Create a new project">+ New</button></div>${MAIN.map((a, i) => `<div class="ah" style="--c:var(--a${i % 7})">${esc(a.name)}</div>`).join("")}<div>Project total</div></div>`;
  if (!openProjects().length) h += `<div class="empty">${S.projects.length ? "All your projects are closed. Click <b>+ New</b> to create one." : "Click <b>+ New</b> to create your first project, then click any clock to start tracking."}</div>`;
  for (const p of openProjects()) {
    const mine = iv.filter(x => x.p === p.id);
    const anyOn = S.running.some(r => r.projectId === p.id);
    const name = editing === p.id
      ? `<form class="edit" data-rename="${p.id}"><label>Full name<input name="n" value="${esc(p.name)}" placeholder="Full name"></label>
          <label>Short name <span>(optional, for this tab)</span><input name="s" value="${esc(p.short || "")}" maxlength="18" placeholder="e.g. SleepOUP"></label>
          <button class="btn small primary" type="submit">Save</button>
          <button type="button" class="btn small ghost" data-cancel="1">Cancel</button></form>`
      : `<div class="pnrow"><button type="button" class="name" data-edit="${p.id}" title="${esc(p.name)}${p.short ? "" : " (click to rename)"}">${esc(shortName(p))}</button>
         <button type="button" class="btn icon more" data-menu="project|${p.id}" aria-haspopup="menu" aria-label="More for ${esc(p.name)}" title="Rename, close or delete">${I.more}</button></div>`;
    const clocks = MAIN.map((a, i) => {
      const ms = clockSum(0, mine.filter(x => x.a === a.id));
      const on = S.running.some(x => same(x, p.id, a.id)), pz = S.paused.some(x => same(x, p.id, a.id));
      return `<button type="button" class="clk${on ? " on" : ""}${pz ? " paused" : ""}" style="--c:var(--a${i % 7})" data-clock="${p.id}|${a.id}" ${S.breakStart ? "disabled" : ""} aria-pressed="${on}" aria-label="${on ? "Stop" : "Start"} ${esc(a.name)} on ${esc(p.name)}">
        ${face(ms, p.id + "|" + a.id)}<span class="lab">${esc(a.short)}</span><span class="t" data-t="${p.id}|${a.id}">${fmt(ms, on)}</span></button>`;
    }).join("");
    // Rare clocks (Embedding) sit under the name, only on books that have them
    const chips = editing === p.id ? "" : ACTIVITIES.filter(a => a.rare && hasExtra(p, a.id)).map(a => {
      const i = ACTIVITIES.indexOf(a), ms = clockSum(0, mine.filter(x => x.a === a.id)), key = p.id + "|" + a.id;
      const on = S.running.some(x => same(x, p.id, a.id)), pz = S.paused.some(x => same(x, p.id, a.id));
      return `<button type="button" class="xchip${on ? " on" : ""}${pz ? " paused" : ""}" style="--c:var(--a${i % 7})" data-clock="${key}" ${S.breakStart ? "disabled" : ""} aria-pressed="${on}" aria-label="${on ? "Stop" : "Start"} ${esc(a.name)} on ${esc(p.name)}">
        ${on ? `<span class="xfill" style="animation-delay:-${((ms / 1000) % 60).toFixed(1)}s"></span>` : ""}${chipFace(ms, key)}<span class="xn">${esc(a.short)}</span><span class="xt" data-t="${key}" data-hm="1">${fmt(ms)}</span></button>`;
    }).join("");
    const tot = clockSum(0, mine);
    h += `<div class="row" style="--n:${MAIN.length}"><div class="pn">${name}${chips}</div>${clocks}
      <div class="tot">${face(tot, "tot|" + p.id)}<span class="lab">Total</span><span class="t" data-t="tot|${p.id}">${fmt(tot, anyOn)}</span></div></div>`;
  }
  $("#board").innerHTML = h;
  fitBoard();
  if (openProjects().length !== fitCount) { fitCount = openProjects().length; fitWindow(); }
}
// The dashboard, the break button, the running clock faces and the Clocks tab's hours
export function tickClocks(t, iv, b) {
  const stat = (id, from, to) => {   // with a Schedule, today and this week also say what was planned
    const w = worked(from, iv), c = clockSum(from, iv), p = to && opt("schedule") ? planned(from, to) : 0;
    $("#" + id).textContent = fmt(w);
    $("#" + id + "S").textContent = `${dec(w)} h${p ? ` of ${schH(p)} planned` : ""}${c - w > 60000 ? ` · all clocks ${fmt(c)}` : ""}`;
  };
  stat("dDay", b.day, b.day + 86400000); stat("dWeek", b.week, schDay(b.week, 7)); stat("dMonth", b.month);

  const bb = $("#breakBtn");
  if (S.breakStart) {
    bb.className = "break on"; bb.disabled = false;
    setHTML(bb, `<span class="bl">${PLAY}END BREAK</span><small>On break ${fmt(t - S.breakStart, true)} · ${S.paused.length} clock${S.paused.length === 1 ? "" : "s"} waiting</small>`);
  } else {
    bb.className = "break"; bb.disabled = !S.running.length;
    setHTML(bb, `<span class="bl">${PAUSE}START BREAK</span><small>${S.running.length ? `Pause ${S.running.length} running clock${S.running.length === 1 ? "" : "s"}` : "Start a clock first"}</small>`);
  }
  const projOn = new Set();
  for (const r of S.running) {
    const key = r.projectId + "|" + r.activityId;
    const ms = clockSum(0, iv.filter(x => x.p === r.projectId && x.a === r.activityId));
    const el = document.querySelector(`[data-t="${key}"]`); if (el) el.textContent = fmt(ms, !el.dataset.hm);
    const hd = document.querySelector(`[data-hand="${key}"]`); if (hd) hd.style.transform = `rotate(${angle(ms)}deg)`;
    hours(key, ms);
    projOn.add(r.projectId);
  }
  for (const pid of projOn) {
    const ms = clockSum(0, iv.filter(x => x.p === pid));
    const el = document.querySelector(`[data-t="tot|${pid}"]`); if (el) el.textContent = fmt(ms, true);
    const hd = document.querySelector(`[data-hand="tot|${pid}"]`); if (hd) hd.style.transform = `rotate(${angle(ms)}deg)`;
    hours("tot|" + pid, ms);
  }
  const nr = $("#navRun");
  nr.hidden = !S.running.length && !S.breakStart;
  nr.className = S.breakStart ? "run brk" : "run";
  nr.textContent = S.breakStart ? "On break" : fmt(worked(b.day, iv));
}
export function hours(key, ms) {   // redraw a face's hour wedges only when another full hour has passed
  const g = document.querySelector(`[data-hrs="${key}"]`), h = Math.floor(ms / HOUR);
  if (g && +g.dataset.h !== h) { g.dataset.h = h; g.innerHTML = wedges(ms); }
}

// Events for this area (called once at start-up by js/main.js)
export function initClocks() {
$("#board").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.clock) { const [p, a] = d.clock.split("|"); toggleClock(p, a); }
  else if (d.menu) { const [k, id] = d.menu.split("|"); openMenu(k, id, b); }
  else if (d.edit) startRename(d.edit);
  else if (d.cancel) { editing = null; render(); }
  else if (d.add) showAddProject(true);
});
$("#board").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, p = proj(f.dataset.rename), n = f.elements.n.value.trim(), sh = f.elements.s.value.trim();
  if (p && n) { p.name = n; if (sh && sh !== n) p.short = sh; else delete p.short; save(); }
  editing = null; render();
});
function showAddProject(on) {
  $("#addForm").hidden = !on;
  if (on) $("#newName").focus(); else $("#newName").value = $("#newShort").value = "";
  fitBoard();
}
$("#addClose").addEventListener("click", () => showAddProject(false));
$("#addForm").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); showAddProject(false); } });
$("#addForm").addEventListener("submit", e => {
  e.preventDefault();
  if (addProject($("#newName").value, $("#newShort").value)) showAddProject(false); else $("#newName").focus();
});
$("#breakBtn").addEventListener("click", () => toggleBreak());
// Summary pop-up
$("#closedCopy").addEventListener("click", async () => {
  const ok = await copyText($("#closedText").textContent);
  $("#closedMsg").innerHTML = ok ? `✓ Copied again. <b>Remember to post your time on Basecamp.</b>` : `Couldn't copy. Select the text above and press Ctrl+C.`;
});
$("#closedDone").addEventListener("click", () => $("#closedDlg").close());
}
