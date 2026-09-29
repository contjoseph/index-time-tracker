/* The weekly schedule: when you plan to work, to tell Kevin. Pure: every function takes the schedule it works on.
   A schedule is {"2026-09-28": ["0-540", …]}: per week (key = its Monday in YOUR time), half-hour slots "day-minute"
   (day 0 = Monday, 540 = 9:00). It is stored in your time; showing it in Kevin's time (Eastern), and the copied text,
   work by turning slots into timestamps and back, so daylight saving is handled by the browser. */
import {dayKey, WD, dnum, MO, HOUR, DAY} from "../core/time.js";
import {zparts, zoneTs, zoneAbbr, aheadOfHere} from "../core/zones.js";

export const SLOT = 30, SLOTMS = SLOT * 60000;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], DAY1 = ["M", "T", "W", "Th", "F", "Sa", "Su"];
export const ET = "America/New_York";   // Kevin, in Pennsylvania: EDT in summer, EST in winter
export const tzOf = zone => zone === "et" ? ET : null;   // null = your time

export const schDay = (mon, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d.getTime(); };
export const weekSlots = (schedule, mon) => (schedule || {})[dayKey(mon)] || [];
export const slotStart = (mon, k) => { const [d, m] = k.split("-").map(Number); return new Date(schDay(mon, d)).setHours(0, m); };
// Day d, minute m of the week that starts on `mon`'s date, in zone tz (null = your time) → timestamp
export function vts(mon, d, m, tz) { const x = new Date(schDay(mon, d)); return tz ? zoneTs(x.getFullYear(), x.getMonth() + 1, x.getDate(), m, tz) : x.setHours(0, m); }

// A week's slots as seen in a zone. Your Sunday night can be Kevin's Monday, so nearby weeks are read too.
export function viewSet(schedule, tz, mon) {
  if (!tz) return new Set(weekSlots(schedule, mon));
  const m0 = new Date(mon), base = Date.UTC(m0.getFullYear(), m0.getMonth(), m0.getDate()), out = new Set();
  for (const w of [-7, 0, 7]) {
    const wm = schDay(mon, w);
    for (const k of weekSlots(schedule, wm)) {
      const p = zparts(slotStart(wm, k), tz), di = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - base) / DAY);
      if (di >= 0 && di < 7) out.add(`${di}-${p.min}`);
    }
  }
  return out;
}
// Add or remove slots given in a zone's view; returns the new schedule (the one given isn't changed).
// Each slot becomes a timestamp, then your week and your "day-minute".
export function applyKeys(schedule, tz, mon, keys, add) {
  const s = {...(schedule || {})}, sets = {};
  for (const k of keys) {
    const [d, m] = k.split("-").map(Number), x = new Date(vts(mon, d, m, tz));
    const lm = new Date(x.getFullYear(), x.getMonth(), x.getDate() - (x.getDay() + 6) % 7), w = dayKey(lm.getTime());
    const set = sets[w] || (sets[w] = new Set(s[w] || []));
    const lk = `${(x.getDay() + 6) % 7}-${x.getHours() * 60 + x.getMinutes()}`;
    add ? set.add(lk) : set.delete(lk);
  }
  for (const [w, set] of Object.entries(sets)) { if (set.size) s[w] = [...set]; else delete s[w]; }
  return s;
}
// Kevin's time is offered on the grid only when it differs from yours by whole half hours (so the grid still lines up)
export function etGap(mon) {
  const pts = [0, 3, 7].map(i => aheadOfHere(schDay(mon, i) + 12 * HOUR, ET));
  return {mid: pts[1], aligned: pts.every(x => x % SLOTMS === 0) && pts.some(x => x !== 0)};
}
export const aheadText = ms => ms ? `${+(Math.abs(ms) / HOUR).toFixed(2)} h ${ms > 0 ? "ahead of" : "behind"} you` : "on the same time as you";

// Planned time between two moments, over every week
export function planned(schedule, from, to) {
  let ms = 0;
  for (const [w, slots] of Object.entries(schedule || {})) {
    const [y, mo, d] = w.split("-").map(Number), mon = new Date(y, mo - 1, d).getTime();
    if (mon >= to || schDay(mon, 7) <= from) continue;
    for (const k of slots) { const s = slotStart(mon, k); ms += Math.max(0, Math.min(s + SLOTMS, to) - Math.max(s, from)); }
  }
  return ms;
}
export const slotTime = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`; };  // 540 → "9 AM"
export const schH = ms => `${+(ms / HOUR).toFixed(1)} h`;
// One day's slots joined into [start, end] minutes
export function schBlocks(set, d) {
  const mins = [...set].filter(k => k.startsWith(d + "-")).map(k => +k.split("-")[1]).sort((a, b) => a - b), out = [];
  for (const m of mins) { const l = out[out.length - 1]; if (l && l[1] === m) l[1] = m + SLOT; else out.push([m, m + SLOT]); }
  return out;
}
// Short times: "9am-1pm", "2-5pm" (am/pm written once when both ends share it)
export const ampm = m => Math.floor(m / 60) % 24 < 12 ? "am" : "pm";
export const shortTime = (m, mer = true) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${mer ? ampm(m) : ""}`; };
export const shortRange = ([a, b]) => `${shortTime(a, ampm(a) !== ampm(b))}-${shortTime(b)}`;
// The copied text for a week's slots. Full: "Monday<TAB>9 AM to 1 PM, 2 PM to 5 PM" for all 7 days (pastes into two
// columns). Short: "M:9am-1pm, 2-5pm", planned days only.
export function schText(set, f) {
  if (f === "short") return DAYS.map((_, d) => { const b = schBlocks(set, d); return b.length ? `${DAY1[d]}:${b.map(shortRange).join(", ")}` : ""; }).filter(Boolean).join("\n");
  return DAYS.map((name, d) => `${name}\t${schBlocks(set, d).map(([a, b]) => `${slotTime(a)} to ${slotTime(b)}`).join(", ")}`).join("\n");
}
// "Eastern time (EDT)", or "Eastern time (EDT, EST from Sun 1 Nov)" in the week the clocks change
export function zoneLine(mon) {
  const ab = DAYS.map((_, d) => zoneAbbr(vts(mon, d, 720, ET), ET)), i = ab.findIndex(x => x !== ab[0]);
  if (i < 0) return `Eastern time (${ab[0]})`;
  const day = schDay(mon, i);
  return `Eastern time (${ab[0]}, ${ab[i]} from ${WD(day)} ${dnum(day)} ${MO(day)})`;
}
// What Copy schedule copies for the week of `mon`: always Kevin's time, with the zone line on top
export const copyText = (schedule, mon, f) => `${zoneLine(mon)}\n${schText(viewSet(schedule, ET, mon), f)}`;
// Time the clocks ran between a and b, as merged [start, end] stretches (overlaps once), for the "worked" line on the grid
export function workedStretches(iv, a, b) {
  const list = iv.map(x => [Math.max(x.s, a), Math.min(x.e, b)]).filter(x => x[1] > x[0]).sort((x, y) => x[0] - y[0]), out = [];
  for (const [s, e] of list) { const l = out[out.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]); }
  return out;
}
// The end of a planned block today that should prompt "Your planned time is over": it ended in the last 15 minutes,
// a clock that started before it is still running, and it hasn't been asked about. Returns its timestamp, or 0.
export function planEndDue(schedule, running, t, told, week) {
  if (!running.length) return 0;
  const d = (new Date(t).getDay() + 6) % 7, started = Math.min(...running.map(r => r.start));
  const ends = schBlocks(new Set(weekSlots(schedule, week)), d).map(([, e]) => new Date(schDay(week, d)).setHours(0, e));
  const e = ends.filter(x => x <= t && t - x < 15 * 60000 && x > started).pop();
  return e && e !== told ? e : 0;
}
