/* Reports: the period chosen, and every number the Reports tab, the Excel/PDF files and the invoice use.
   Pure: each function takes the data (and the intervals from core/time.js intervals()) it works on. */
import {DAY, bounds, dayKey, parseDT, WD, MO, MOL, dnum, yr, dShort, weekText, worked, clockSum} from "../core/time.js";
import {ACTIVITIES, PRINT_COLORS} from "./activities.js";

export const UNITS = ["week", "month", "year", "all", "custom"];
const projName = (data, id) => (data.projects.find(p => p.id === id) || {}).name || "";

// [start, end) of the period: `unit` stepped back `offset` times (0 = this one). Custom uses the two form dates.
export function periodRange(unit, offset, custom = {}, now = Date.now()) {
  const d = new Date(now), Y = d.getFullYear(), M = d.getMonth(), o = offset;
  const at = (y, m, dd) => new Date(y, m, dd).getTime();
  switch (unit) {
    case "month": return [at(Y, M + o, 1), at(Y, M + o + 1, 1)];
    case "year":  return [at(Y + o, 0, 1), at(Y + o + 1, 0, 1)];
    case "all":   return [0, Infinity];
    case "custom": {
      const f = parseDT(custom.from, "00:00"), t = parseDT(custom.to, "00:00");
      return [isNaN(f) ? 0 : f, isNaN(t) ? Infinity : new Date(t).setDate(new Date(t).getDate() + 1)];
    }
    default: { const mon = d.getDate() - (d.getDay() + 6) % 7 + 7 * o; return [at(Y, M, mon), at(Y, M, mon + 7)]; }
  }
}
// On screen: "Mon 21 – Sun 27 Sep", "September 2026", "2026"
export function rangeText(unit, [a, b]) {
  if (unit === "all" || (a === 0 && b === Infinity)) return "All time";
  if (unit === "month") return `${MOL(a)} ${yr(a)}`;
  if (unit === "year") return String(yr(a));
  if (unit === "custom") return `${a ? dShort(a) : "The start"} – ${b === Infinity ? "today" : dShort(b - 1)}`;
  return weekText(a, b);
}
export function relText(unit, offset) {
  const names = {week: ["This week", "Last week"], month: ["This month", "Last month"], year: ["This year", "Last year"]}[unit];
  return names ? names[-offset] || "" : "";
}
// In files: always with the year ("Mon 14 – Sun 20 Sep 2026")
export function docPeriod(unit, [a, b], now = Date.now()) {
  if (unit === "all" || (a === 0 && b === Infinity)) return "All time";
  if (unit === "month") return `${MOL(a)} ${yr(a)}`;
  if (unit === "year") return String(yr(a));
  const e = b === Infinity ? now : b - 1, full = t => `${WD(t)} ${dnum(t)} ${MO(t)} ${yr(t)}`;
  if (!a) return `Up to ${full(e)}`;
  if (yr(a) !== yr(e)) return `${full(a)} – ${full(e)}`;
  return `${WD(a)} ${dnum(a)}${MO(a) === MO(e) ? "" : " " + MO(a)} – ${WD(e)} ${dnum(e)} ${MO(e)} ${yr(e)}`;
}
// For the file names: "2026-09-21 to 2026-09-27"
export function periodLabel([a, b]) {
  if (a === 0 && b === Infinity) return "All time";
  const last = b === Infinity ? "today" : dayKey(new Date(b).setDate(new Date(b).getDate() - 1));
  return `${a === 0 ? "the start" : dayKey(a)} to ${last}`;
}
// Mon–Fri days in the period, up to today
export function workdays([a, b], now = Date.now()) {
  if (!a) return 0;
  const end = Math.min(b, bounds(now).day + DAY), d = new Date(a); let n = 0;
  while (d.getTime() < end) { const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}
// Project time per project and activity inside the period (time is split at the period's edges): [{name, cells, tot}]
export function grid(data, iv, [a, b]) {
  const rows = [];
  for (const p of data.projects) {
    const cells = ACTIVITIES.map(ac => clockSum(a, iv.filter(x => x.p === p.id && x.a === ac.id), b));
    const tot = cells.reduce((s, c) => s + c, 0);
    if (tot) rows.push({name: p.name, cells, tot});
  }
  return rows;
}
// What was worked on between s and e: each project and its activities, in the order they were started
export function dayWhat(data, iv, s, e) {
  const what = new Map();
  for (const x of iv.filter(x => x.e > s && x.s < e).sort((x, y) => x.s - y.s)) {
    const name = projName(data, x.p);
    if (!what.has(name)) what.set(name, []);
    if (!what.get(name).includes(x.a)) what.get(name).push(x.a);
  }
  return [...what].map(([name, acts]) => ({name, acts}));
}
// Every day of the period up to today, with worked hours (clocks running together count once) and, if `plan` is given
// (a function (from, to) → planned ms), the planned time. Days with no time stay in the list (ms 0) unless the
// period is too long to list every day.
export function periodDays(data, iv, [a, b], plan = null, now = Date.now()) {
  const days = [], end = Math.min(b, bounds(now).day + DAY);
  let start = a;
  if (!start) { if (!iv.length) return days; start = Math.min(...iv.map(x => x.s)); }
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const everyDay = (end - d.getTime()) / DAY <= 62;
  while (d.getTime() < end) {
    const s = Math.max(d.getTime(), a); d.setDate(d.getDate() + 1);
    const e = Math.min(d.getTime(), b), ms = worked(s, iv, e), p = plan ? plan(s, e) : 0;
    if (ms || p || everyDay) days.push({day: s, ms, plan: p, what: ms ? dayWhat(data, iv, s, e) : []});
  }
  return days;
}
// Everything the report files need (see reports.js for the shape), worked out once for the period
export function reportData(data, iv, unit, r, plan = null, now = Date.now()) {
  const [a, b] = r, rows = grid(data, iv, r);
  // Rare activities (Embedding) get a column only if this period has time for them
  const keep = ACTIVITIES.map((x, i) => !x.rare || rows.some(p => p.cells[i])), days = periodDays(data, iv, r, plan, now);
  return {
    periodText: docPeriod(unit, r, now), generated: now, workdays: workdays(r, now),
    activities: ACTIVITIES.map((x, i) => ({id: x.id, name: x.name, color: PRINT_COLORS[i % 7]})).filter((_, i) => keep[i]),
    days, planned: days.some(x => x.plan),
    projects: rows.map(p => ({...p, cells: p.cells.filter((_, i) => keep[i])})),
    workedMs: worked(a, iv, b),
    entries: data.entries.concat(data.running.map(x => ({...x, end: now}))).filter(e => e.end > a && e.start < b)
      .map(e => ({start: e.start, end: e.end, project: projName(data, e.projectId), activity: e.activityId, note: e.note || ""}))
  };
}
