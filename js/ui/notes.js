/* A short note when a clock stops ("ch. 52-54"), used on the invoice. */
import {fmt} from "../core/time.js";
import {actName} from "../domain/activities.js";
import {S, proj, save} from "../data/store.js";
import {$, esc} from "./dom.js";
import {renderLog} from "./entries.js";

/* ---------- a short note when a clock stops ("ch. 52-54"), used on the invoice ---------- */
export let noteFor = null;
export function askNote(e) {
  if (noteFor && noteFor !== e.id) commitNote();
  noteFor = e.id;
  const p = proj(e.projectId) || {};
  $("#noteWhat").textContent = `${p.name || ""} · ${actName(e.activityId)} · ${fmt(e.end - e.start)}`;
  // Suggest notes used before on this project, newest first
  const seen = [...new Set(S.entries.filter(x => x.projectId === e.projectId && x.note).sort((x, y) => y.end - x.end).map(x => x.note))].slice(0, 8);
  $("#noteList").innerHTML = seen.map(n => `<option value="${esc(n)}"></option>`).join("");
  $("#noteInput").value = e.note || "";
  $("#noteBar").hidden = false; document.body.classList.add("has-note");
  $("#noteInput").focus();
}
export function hideNote() { noteFor = null; $("#noteBar").hidden = true; document.body.classList.remove("has-note"); }
export function commitNote() {
  const x = S.entries.find(y => y.id === noteFor), v = $("#noteInput").value.trim();
  if (x && v !== (x.note || "")) { if (v) x.note = v; else delete x.note; save(); renderLog(); }
  hideNote();
}

// Events for this area (called once at start-up by js/main.js)
export function initNotes() {
// Note bar
$("#noteBar").addEventListener("submit", e => { e.preventDefault(); commitNote(); });
$("#noteSkip").addEventListener("click", hideNote);
}
