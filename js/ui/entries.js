/* Time entries: the list for the report's period, adding, editing and deleting. */
import {dLong, dayKey, dec, fmt, hm, parseDT, worked} from "../core/time.js";
import {ACTIVITIES, actName} from "../domain/activities.js";
import {S, commit, hasExtra, proj, uid} from "../data/store.js";
import {openProjects} from "./clocks.js";
import {$, CONFIRM_FOR, I, actColor, esc, now, toast} from "./dom.js";
import {periodRange, rangeText} from "./reports.js";

/* ---------- time entries ---------- */
export let entryEdit = null, entryDel = null;   // the entry whose form is open; the entry waiting for its second Delete click
export function closeEntryForm() { if (!entryEdit) return false; entryEdit = null; return true; }   // true if one was open
export const actsFor = p => ACTIVITIES.filter(a => !a.rare || (p && hasExtra(p, a.id)));
export const opts = (list, sel) => list.map(x => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.name)}</option>`).join("");
export const fields = e => `
  <label>Project<select name="p">${opts(S.projects.filter(p => !p.closed || p.id === e.projectId), e.projectId)}</select></label>
  <label>Activity<select name="a">${opts(actsFor(proj(e.projectId)), e.activityId)}</select></label>
  <label>Date<input type="date" name="d" value="${dayKey(e.start)}" required></label>
  <label>Start<input type="time" name="s" value="${hm(e.start)}" required></label>
  <label>End<input type="time" name="e" value="${hm(e.end)}" required></label>
  <label class="wide">Note<input name="note" value="${esc(e.note || "")}" placeholder="What did you do? e.g. ch. 52-54" maxlength="200" autocomplete="off"></label>`;
export const entryRow = e => `<div class="erow" data-row="${e.id}">
  <span class="time">${hm(e.start)} – ${hm(e.end)}${dayKey(e.end) !== dayKey(e.start) ? ` <small>+1 day</small>` : ""}</span>
  <span class="p"><i class="dot" style="--c:${actColor(e.activityId)}"></i><span class="pt">${esc((proj(e.projectId) || {}).name)}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span></span>
  <span class="a">${esc(actName(e.activityId))}</span>
  <b class="h">${dec(e.end - e.start)}</b>
  <button type="button" class="btn icon edit" data-eedit="${e.id}" aria-label="Edit this entry" title="Edit">${I.pen}</button></div>`;
export function renderLog() {
  if (entryEdit) return;   // don't wipe a half-finished edit
  const r = periodRange(), [a, b] = r;
  const list = S.entries.filter(e => e.end > a && e.start < b).sort((x, y) => y.start - x.start);
  $("#logCount").textContent = `${list.length} · ${rangeText(r)}`;
  if (!list.length) { $("#log").innerHTML = `<p class="empty">No time entries in this period.</p>`; return; }
  const groups = [];
  for (const e of list) {
    const k = dayKey(e.start), g = groups[groups.length - 1];
    if (g && g.k === k) g.items.push(e); else groups.push({k, day: e.start, items: [e]});
  }
  $("#log").innerHTML = groups.map(g => `<div class="dayhead">${dLong(g.day)}<span>${dec(worked(0, g.items.map(e => ({s: e.start, e: e.end}))))} h</span></div>${g.items.map(entryRow).join("")}`).join("");
}
export function editEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  entryEdit = null; renderLog(); entryEdit = id; entryDel = null;
  const row = document.querySelector(`[data-row="${id}"]`);
  if (!row) return;
  row.outerHTML = `<form class="eform" data-entry="${id}">${fields(e)}
    <div class="fbtns"><button type="button" class="btn ghost danger" data-edel="${id}">Delete</button>
    <button type="button" class="btn ghost" data-ecancel="1">Cancel</button>
    <button class="btn primary" type="submit">Save</button></div></form>`;
  const first = document.querySelector(`[data-entry="${id}"] select`); if (first) first.focus();
}
// Read date/start/end from a form; an end earlier than the start means it ran past midnight
export function readTimes(f) {
  const s = parseDT(f.elements.d.value, f.elements.s.value);
  let e = parseDT(f.elements.d.value, f.elements.e.value);
  if (isNaN(s) || isNaN(e)) { toast("Fill in the date, start and end"); return null; }
  if (e <= s) e = new Date(e).setDate(new Date(e).getDate() + 1);
  if (e > now() + 60000) { toast("That end time hasn't happened yet"); return null; }
  return [s, e];
}
export function fillSelects() {
  const f = $("#addTime"), p = f.elements.p.value, a = f.elements.a.value;
  f.elements.p.innerHTML = opts(openProjects(), p);
  f.elements.a.innerHTML = opts(actsFor(proj(f.elements.p.value)), a);
  $("#addToggle").disabled = !openProjects().length;
  $("#addToggle").title = openProjects().length ? "" : "Create a project first";
  if (!f.elements.d.value) f.elements.d.value = dayKey(now());
}
export function showAdd(on) {
  $("#addTime").hidden = !on; $("#addToggle").hidden = on;
  if (on) { $("#addTime").elements.d.value = dayKey(now()); $("#addTime").elements.p.focus(); }
}

// Events for this area (called once at start-up by js/main.js)
export function initEntries() {
// Time entries
$("#addToggle").addEventListener("click", () => showAdd(true));
$("#addCancel").addEventListener("click", () => showAdd(false));
$("#log").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.eedit) editEntry(d.eedit);
  else if (d.ecancel) { entryEdit = null; renderLog(); }
  else if (d.edel) {
    if (entryDel !== d.edel) {
      const id = entryDel = d.edel; b.textContent = "Click again to delete"; b.classList.add("sure");
      setTimeout(() => { if (entryDel === id) { entryDel = null; if (b.isConnected) { b.textContent = "Delete"; b.classList.remove("sure"); } } }, CONFIRM_FOR);
      return;
    }
    S.entries = S.entries.filter(x => x.id !== d.edel); entryEdit = entryDel = null;
    commit(); toast("Time entry deleted");
  }
});
$("#log").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, x = S.entries.find(y => y.id === f.dataset.entry), t = readTimes(f);
  if (!x || !t) return;
  Object.assign(x, {projectId: f.elements.p.value, activityId: f.elements.a.value, start: t[0], end: t[1]});
  const note = f.elements.note.value.trim(); if (note) x.note = note; else delete x.note;
  entryEdit = null; commit(); toast("Time entry updated");
});
// Picking another book in a time-entry form updates its activity list (Embedding only for books that have it)
document.addEventListener("change", e => {
  const f = e.target.closest("#addTime, .eform");
  if (!f || e.target.name !== "p") return;
  const a = f.elements.a.value;
  f.elements.a.innerHTML = opts(actsFor(proj(e.target.value)), a);
});
$("#addTime").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, t = readTimes(f);
  if (!t || !proj(f.elements.p.value)) return;
  const note = f.elements.note.value.trim();
  S.entries.push({id: uid(), projectId: f.elements.p.value, activityId: f.elements.a.value, start: t[0], end: t[1], ...(note ? {note} : {})});
  f.elements.s.value = f.elements.e.value = f.elements.note.value = "";
  showAdd(false);
  commit(); toast(`Added ${fmt(t[1] - t[0])} to ${proj(f.elements.p.value).name}`);
});
}
