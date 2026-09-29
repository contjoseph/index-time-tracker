/* The tracker's data in this browser: S, load/save, replacing and merging, the per-browser settings (P), and a few
   data queries. The shape, version and checks are in schema.js (docs/DATA.md); the settings table is in prefs.js.
   Read S anywhere and change its contents, then call save(). Only this module replaces S itself (replaceData).
   No page code: problems, saves and changes go through hooks that js/main.js connects
   (onProblem → toast, onSave → auto-save file, onChange → render). */
import {create as createPrefs} from "./prefs.js";
import * as T from "../core/time.js";
import {blank, validate} from "./schema.js";

export const KEY = "index-time-tracker:v1";
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const LS = (() => { try { return window.localStorage; } catch { return {getItem: () => null, setItem() {}, removeItem() {}}; } })();   // blocked storage: work, just don't keep
export const P = createPrefs(LS, KEY);

const hooks = {problem: () => {}, saved: () => {}, changed: () => {}};
export const onProblem = fn => { hooks.problem = fn; };   // a message for the person (a toast)
export const onSave = fn => { hooks.saved = fn; };         // after every save (writes the auto-save file)
export const onChange = fn => { hooks.changed = fn; };     // after commit() (redraws the page)

export let S = blank();
export function load() {
  let raw = null;
  try { raw = LS.getItem(KEY); } catch {}
  if (raw == null) { S = blank(); return; }
  try {
    const r = validate(JSON.parse(raw));
    S = r.data;
    if (r.problems.length) setTimeout(() => hooks.problem("Some saved data couldn't be read and was left out: " + r.problems.join("; ")), 0);
  } catch {
    // Never overwrite data we can't read: keep a copy beside it, then start fresh
    try { LS.setItem(`${KEY}:unreadable-${Date.now()}`, raw); } catch {}
    S = blank();
    setTimeout(() => hooks.problem("The saved data couldn't be read. A copy was kept; restore a backup or open your auto-save file."), 0);
  }
}
export function save() {
  try { LS.setItem(KEY, JSON.stringify(S)); }
  catch { hooks.problem("Couldn't save — your browser storage may be full or blocked."); }
  hooks.saved();
}
// After changing the data: save it, then redraw everything (use save() alone when only one part needs redrawing)
export function commit() { save(); hooks.changed(); }
// Restore backup: replace everything with data already checked by validate
export function replaceData(d) { S = d; }

// Data queries
export const proj = id => S.projects.find(p => p.id === id);
export const shortName = p => p.short || p.name;        // the Clocks tab uses the short name; everything else the full one
export const hasExtra = (p, id) => (p.extras || []).includes(id) || S.entries.some(e => e.projectId === p.id && e.activityId === id)
  || S.running.concat(S.paused).some(r => r.projectId === p.id && r.activityId === id);
// Every stretch of time, with running clocks counted up to this second
export const intervals = () => T.intervals(S, Date.now());

// Combine another copy of the data (already checked with validate) into this one without losing anything from either
export function mergeIn(d) {
  const idMap = {};
  for (const p of d.projects) {
    const match = S.projects.find(x => x.id === p.id) || S.projects.find(x => x.name.toLowerCase() === String(p.name).toLowerCase());
    if (match) { idMap[p.id] = match.id; if (!match.short && p.short) match.short = p.short; if (p.extras) match.extras = [...new Set([...(match.extras || []), ...p.extras])]; }
    else S.projects.push(p);
  }
  const fix = x => ({...x, projectId: idMap[x.projectId] || x.projectId});
  const have = new Set(S.entries.map(e => e.id));
  S.entries.push(...d.entries.filter(e => !have.has(e.id)).map(fix));
  if (!S.invoice && d.invoice) S.invoice = d.invoice;
  for (const [k, v] of Object.entries(d.options || {})) if (!(k in S.options)) S.options[k] = v;
  for (const [w, slots] of Object.entries(d.schedule || {})) if (!(S.schedule || {})[w]) S.schedule = {...S.schedule, [w]: slots};
  if (!S.running.length && !S.breakStart) {
    S.running = (d.running || []).map(fix); S.paused = (d.paused || []).map(fix); S.breakStart = d.breakStart || null;
  }
}
