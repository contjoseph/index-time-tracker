/* Time and date helpers, and the two ways of adding up time. Pure: no page, no storage.
   Times are millisecond timestamps; dates on screen are words ("Tue 22 Sep"), machine dates only in files and forms. */

export const HOUR = 3600000, DAY = 86400000;

// 5400000 → "1:30"; with secs → "1:30:00"
export function fmt(ms, secs) {
  const t = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return secs ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${h}:${String(m).padStart(2, "0")}`;
}
export const dec = ms => (ms / HOUR).toFixed(2);   // decimal hours, "1.50"

// Midnight today, this Monday and the 1st of this month (local time)
export function bounds(t = Date.now()) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const w = new Date(d); w.setDate(w.getDate() - (w.getDay() + 6) % 7);
  const m = new Date(d.getFullYear(), d.getMonth(), 1);
  return {day: d.getTime(), week: w.getTime(), month: m.getTime()};
}
// Machine dates (2026-09-22) are only for the Excel files and form fields; the screen uses words
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
export const loc = (t, o) => new Date(t).toLocaleDateString([], o);
export const WD = t => loc(t, {weekday: "short"}), MO = t => loc(t, {month: "short"}), MOL = t => loc(t, {month: "long"});
export const dnum = t => new Date(t).getDate(), yr = t => new Date(t).getFullYear();
export const withYear = (s, t, now = Date.now()) => yr(t) === yr(now) ? s : `${s} ${yr(t)}`;
export const dShort = t => withYear(`${WD(t)} ${dnum(t)} ${MO(t)}`, t);                         // Tue 22 Sep
export const dLong = t => withYear(`${loc(t, {weekday: "long"})} ${dnum(t)} ${MOL(t)}`, t);     // Tuesday 22 September
// "3:12 PM", or "Mon 21 Sep 3:12 PM" when it isn't today
export function when(t, now = Date.now()) {
  const time = new Date(t).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
  return dayKey(t) === dayKey(now) ? time : `${dShort(t)} ${time}`;
}
// "2026-09-22", "14:05" → timestamp (NaN if either is incomplete)
export function parseDT(date, time) {
  const [y, m, d] = String(date).split("-").map(Number), [h, mi] = String(time).split(":").map(Number);
  return y && m && d && !isNaN(h) && !isNaN(mi) ? new Date(y, m - 1, d, h, mi).getTime() : NaN;
}
// "Mon 21 – Sun 27 Sep" for the week [a, b)
export function weekText(a, b) { const e = b - 1; return withYear(`${WD(a)} ${dnum(a)}${MO(a) === MO(e) ? "" : " " + MO(a)} – ${WD(e)} ${dnum(e)} ${MO(e)}`, e); }

// Every stretch of time in the data, with running clocks counted up to `now`: [{p, a, s, e}]
export function intervals(data, now = Date.now()) {
  return data.entries.map(e => ({p: e.projectId, a: e.activityId, s: e.start, e: e.end}))
    .concat(data.running.map(r => ({p: r.projectId, a: r.activityId, s: r.start, e: now})));
}
// Worked hours: time actually worked between from and to; two clocks running together count once
export function worked(from, list, to = Infinity) {
  const iv = list.map(x => [Math.max(x.s, from), Math.min(x.e, to)]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, cs = 0, ce = 0;
  for (const [s, e] of iv) {
    if (s > ce) { total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}
// Project time: every clock in full (overlaps counted per clock)
export function clockSum(from, list, to = Infinity) { let t = 0; for (const x of list) { const s = Math.max(x.s, from), e = Math.min(x.e, to); if (e > s) t += e - s; } return t; }
