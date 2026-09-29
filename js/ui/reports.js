/* The Reports tab: the period stepper, Worked hours, Project time and Closed projects. */
import * as Rep from "../domain/report.js";
import {MOL, WD, dShort, dec, dnum, fmt, withYear, worked} from "../core/time.js";
import {ACTIVITIES, actName} from "../domain/activities.js";
import {P, S, intervals} from "../data/store.js";
import {projectTotals} from "./clocks.js";
import {$, I, actColor, esc, kpi, now} from "./dom.js";
import {closeEntryForm, renderLog} from "./entries.js";
import {closeMenu, menu, openMenu} from "./menu.js";
import {planned, showPlan} from "./schedule.js";

export let lastReport = 0;
/* ---------- report period: Week / Month / Year / All / Custom, stepped with ‹ › ---------- */
export const per = {unit: P.get("unit"), offset: 0};
export const periodRange = () => Rep.periodRange(per.unit, per.offset, {from: $("#from").value, to: $("#to").value});
export const rangeText = r => Rep.rangeText(per.unit, r);
export const relText = () => Rep.relText(per.unit, per.offset);
export const docPeriod = r => Rep.docPeriod(per.unit, r);
export const periodLabel = Rep.periodLabel;
export const workdays = r => Rep.workdays(r);

/* ---------- report ---------- */
export const grid = r => Rep.grid(S, intervals(), r);
export const periodDays = r => Rep.periodDays(S, intervals(), r, showPlan() ? planned : null);
// The days that have time (or a plan, when planned hours are shown), for the Worked hours tab
export const workedDays = r => periodDays(r).filter(x => x.ms || x.plan).map(x => ({day: x.day, w: x.ms, plan: x.plan, what: x.what}));
export const reportTab = () => P.get("tab");

export const tag = id => `<span class="tag"><i class="dot" style="--c:${actColor(id)}"></i>${esc(actName(id))}</span>`;
export const hrs = ms => `<td class="num hrs"><b>${dec(ms)}</b><span>${fmt(ms)}</span></td>`;
// One bar per project, split by activity; its length is relative to the biggest project shown
export function bar(parts, tot, max) {
  const used = parts.filter(x => x.ms);
  return `<div class="bar" style="width:${Math.max(3, tot / max * 100).toFixed(1)}%">${used.map(x => `<i style="--c:${actColor(x.id)};width:${(x.ms / tot * 100).toFixed(2)}%" title="${esc(actName(x.id))}: ${dec(x.ms)} h"></i>`).join("")}</div>
    <div class="split">${used.map(x => `<span><i class="dot" style="--c:${actColor(x.id)}"></i>${esc(actName(x.id))} ${dec(x.ms)}</span>`).join("")}</div>`;
}
export const cellsToParts = cells => cells.map((ms, i) => ({id: ACTIVITIES[i].id, ms}));

export function renderFilter(tab, r) {
  $("#filter").hidden = tab === "closed";
  const stepping = ["week", "month", "year"].includes(per.unit);
  $("#stepper").hidden = !stepping;
  $("#custom").hidden = per.unit !== "custom";
  const rel = relText();
  $("#rangeText").innerHTML = `${esc(rangeText(r))}${rel ? `<small>${rel}</small>` : ""}`;
  $("#next").disabled = per.offset >= 0;
  document.querySelectorAll("#unit [data-unit]").forEach(b => b.setAttribute("aria-pressed", b.dataset.unit === per.unit));
}
export function renderReport() {
  lastReport = now();
  if (menu && menu.kind === "closed") closeMenu();
  const tab = reportTab(), r = periodRange();
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  const nClosed = S.projects.filter(p => p.closed).length;
  $("#closedCount").textContent = nClosed; $("#closedCount").hidden = !nClosed;
  renderFilter(tab, r);
  if (tab === "closed") { renderClosed(); return; }
  const rows = grid(r);
  if (!rows.length) { $("#summary").innerHTML = `<p class="empty">No time tracked in ${per.unit === "all" ? "any period yet" : esc(rangeText(r))}.</p>`; return; }

  if (tab === "worked") {
    const days = workedDays(r), w = days.reduce((s, x) => s + x.w, 0), wd = workdays(r), nw = days.filter(x => x.w).length;
    const plan = days.reduce((s, x) => s + x.plan, 0), pc = plan ? `<td class="num hrs plan"><b>${dec(plan)}</b></td>` : "";
    const pcell = x => plan ? `<td class="num hrs plan">${x.plan ? `<b>${dec(x.plan)}</b>` : `<span>–</span>`}</td>` : "";
    $("#summary").innerHTML = `
    <div class="kpis">
      ${kpi("Worked · billable", dec(w), "h", plan ? `of ${dec(plan)} h planned` : fmt(w))}
      ${kpi("Days worked", nw, "", wd ? `of ${wd} workday${wd === 1 ? "" : "s"}` : "")}
      ${kpi("Average per day", dec(nw ? w / nw : 0), "h")}
    </div>
    <div class="tablewrap"><table class="rt">
      <thead><tr><th class="c-day">Day</th><th>Worked on</th>${plan ? `<th class="num c-hrs">Planned</th>` : ""}<th class="num c-hrs">Hours</th></tr></thead>
      <tbody>${days.map(x => `<tr><td class="day"><b>${WD(x.day)} ${dnum(x.day)}</b><span>${withYear(MOL(x.day), x.day)}</span></td>
        <td>${x.w ? `<div class="proj">${x.what.map(p => `<strong>${esc(p.name)}</strong><div class="acts">${p.acts.map(tag).join("")}</div>`).join("")}</div>` : `<span class="muted">Did not work</span>`}</td>
        ${pcell(x)}${hrs(x.w)}</tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total worked</td>${pc}${hrs(w)}</tr></tfoot>
    </table></div>
    <p class="rnote">Your billable time. Clocks running at the same time count once.</p>`;
    return;
  }

  rows.sort((x, y) => y.tot - x.tot);
  const all = rows.reduce((s, x) => s + x.tot, 0), w = worked(r[0], intervals(), r[1]), max = rows[0].tot;
  $("#summary").innerHTML = `
  <div class="kpis">
    ${kpi("Project time", dec(all), "h", fmt(all))}
    ${kpi("Projects", rows.length)}
    ${kpi("Most time", `<span class="kname">${esc(rows[0].name)}</span>`, "", `${dec(rows[0].tot)} h`)}
  </div>
  <div class="legend">${ACTIVITIES.filter((a, i) => !a.rare || rows.some(x => x.cells[i])).map(a => `<span class="tag"><i class="dot" style="--c:${actColor(a.id)}"></i>${esc(a.name)}</span>`).join("")}</div>
  <div class="tablewrap"><table class="rt">
    <thead><tr><th class="c-proj">Project</th><th>Where the time went</th><th class="num c-hrs">Hours</th></tr></thead>
    <tbody>${rows.map(x => `<tr class="prow"><td class="pname">${esc(x.name)}</td><td>${bar(cellsToParts(x.cells), x.tot, max)}</td>${hrs(x.tot)}</tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2">Total project time · ${rows.length} project${rows.length === 1 ? "" : "s"}</td>${hrs(all)}</tr></tfoot>
  </table></div>
  ${all - w > 60000 ? `<div class="info">${I.info}<div>Project time is <b>${dec(all - w)} h more</b> than the ${dec(w)} h you worked, because some clocks ran at the same time. Each book gets its full clock time.</div></div>` : ""}
  <p class="rnote">For billing each book.</p>`;
}
// Closed projects tab: every closed project, whatever dates are picked, newest first
export const closedList = () => S.projects.filter(p => p.closed).sort((a, b) => b.closed - a.closed);
export function renderClosed() {
  const list = closedList();
  if (!list.length) { $("#summary").innerHTML = `<p class="empty">No closed projects yet. When you finish a book, click <b>⋯</b> next to its name, then <b>Close project</b>.</p>`; return; }
  const tots = list.map(projectTotals), sum = tots.reduce((s, t) => s + t.tot, 0), max = Math.max(...tots.map(t => t.tot), 1);
  $("#summary").innerHTML = `
  <div class="kpis">
    ${kpi("Closed projects", list.length)}
    ${kpi("Total time", dec(sum), "h", fmt(sum))}
    ${kpi("Average per project", dec(sum / list.length), "h")}
  </div>
  <div class="tablewrap"><table class="rt">
    <thead><tr><th class="c-proj">Project</th><th>Where the time went</th><th class="num c-hrs">Hours</th><th class="c-more"></th></tr></thead>
    <tbody>${list.map((p, i) => { const t = tots[i]; return `<tr class="prow">
      <td class="pname">${esc(p.name)}<span class="sub">Closed ${dShort(p.closed)}${t.first ? `<br>Worked ${dShort(t.first)} – ${dShort(t.last)}` : ""}</span></td>
      <td>${t.tot ? bar(t.acts, t.tot, max) : `<span class="muted">No time tracked</span>`}</td>
      ${hrs(t.tot)}
      <td class="num"><button type="button" class="btn icon more" data-menu="closed|${p.id}" aria-haspopup="menu" aria-label="More for ${esc(p.name)}" title="Copy summary or reopen">${I.more}</button></td></tr>`; }).join("")}</tbody>
  </table></div>
  <p class="rnote">Their hours still count in Worked hours and Project time.</p>`;
}

// Events for this area (called once at start-up by js/main.js)
export function initReports() {
// Report
$(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { P.set("tab", b.dataset.tab); renderReport(); } });
$("#unit").addEventListener("click", e => {
  const b = e.target.closest("[data-unit]"); if (!b) return;
  per.unit = b.dataset.unit; per.offset = 0; P.set("unit", per.unit);
  closeEntryForm(); renderReport(); renderLog();
  if (per.unit === "custom" && !$("#from").value) $("#from").focus();
});
$("#prev").addEventListener("click", () => { per.offset--; closeEntryForm(); renderReport(); renderLog(); });
$("#next").addEventListener("click", () => { if (per.offset < 0) { per.offset++; closeEntryForm(); renderReport(); renderLog(); } });
["#from", "#to"].forEach(s => $(s).addEventListener("change", () => { closeEntryForm(); renderReport(); renderLog(); }));
$("#exportBtn").addEventListener("click", e => openMenu("export", null, e.currentTarget));
$("#summary").addEventListener("click", e => { const b = e.target.closest("[data-menu]"); if (b) { const [k, id] = b.dataset.menu.split("|"); openMenu(k, id, b); } });
}
