/* The weekly invoice: numbering, dates, descriptions and totals (reports.js buildInvoice draws it). Pure.
   Date = the Monday the week starts. Number = the following Monday as YYMMDD (week of 7 Sep 2026 → 260914). */
import {HOUR, DAY} from "../core/time.js";
import {actName} from "./activities.js";

const pad2 = n => String(n).padStart(2, "0");
export function invoiceNumber(monday) { const d = new Date(monday); d.setDate(d.getDate() + 7); return `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
export const usDate = t => { const d = new Date(t); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(2)}`; };
export const round2 = n => Math.round(n * 100) / 100;
export const invProfile = data => ({currency: "$", ...(data.invoice || {})});
export const invReady = p => !!(p.name && p.billTo && +p.rate > 0);

// One line of description for a day: "Katzung Pharmacology: Flipping ch. 50-51, Detailing (MR). Stroke: Editing"
export function describeDay(data, s, e, now = Date.now()) {
  const projs = new Map(), projName = id => (data.projects.find(p => p.id === id) || {}).name || "";
  const list = data.entries.concat(data.running.map(r => ({...r, end: now}))).filter(x => x.end > s && x.start < e).sort((x, y) => x.start - y.start);
  for (const x of list) {
    const name = projName(x.projectId);
    if (!projs.has(name)) projs.set(name, new Map());
    const acts = projs.get(name);
    if (!acts.has(x.activityId)) acts.set(x.activityId, []);
    const n = (x.note || "").trim();
    if (n && !acts.get(x.activityId).includes(n)) acts.get(x.activityId).push(n);
  }
  return [...projs].map(([name, acts]) => `${name}: ${[...acts].map(([id, notes]) => actName(id) + (notes.length ? " " + notes.join("; ") : "")).join(", ")}`).join(". ");
}
// The invoice for the week starting r[0], from its days (report.js periodDays). Each day is rounded to 2 decimals,
// and the totals add up those rounded lines, so the maths on the page is exact.
export function invoiceData(data, r, days, now = Date.now()) {
  const p = invProfile(data), rate = round2(+p.rate || 0);
  const lines = days.filter(x => x.ms).map(x => {
    const hours = round2(x.ms / HOUR);
    return {date: x.day, desc: describeDay(data, x.day, x.day + DAY, now), hours, total: round2(hours * rate)};
  });
  return {number: invoiceNumber(r[0]), date: r[0], currency: p.currency || "$", rate, billTo: p.billTo || "",
    me: {name: p.name || "", logo: p.logo || "", payMethod: p.payMethod || "", payDetails: p.payDetails || "", phone: p.phone || "", email: p.email || ""},
    lines, totalHours: round2(lines.reduce((s, l) => s + l.hours, 0)), total: round2(lines.reduce((s, l) => s + l.total, 0))};
}
