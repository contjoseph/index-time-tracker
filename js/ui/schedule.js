/* The Schedule tab: the week grid (drag, keyboard), My time / Eastern, planned vs worked, the copy,
   and the plan-end check. */
import * as Sch from "../domain/schedule.js";
import {MO, WD, bounds, dayKey, dec, dnum, weekText, when, worked} from "../core/time.js";
import {zparts} from "../core/zones.js";
import {DAYS, ET, SLOT, SLOTMS, aheadText, etGap, schBlocks, schDay, schH, shortRange, slotTime, tzOf, vts} from "../domain/schedule.js";
import {P, S, intervals, save} from "../data/store.js";
import {$, CONFIRM_FOR, copyText, esc, kpi, now, setHTML, toast} from "./dom.js";
import {opt, setOpt} from "./extras.js";
import {notify, setGap, urgent} from "./safety.js";

/* ---------- weekly schedule: when you plan to work, to tell Kevin (informative, not binding) ---------- */
// Half-hour slots keyed "day-minute" (day 0 = Monday, 540 = 9:00), stored per week in S.schedule, so the
// auto-save file and backups keep them too. The plan never starts or stops a clock; it's only compared with them.
// Slots are stored in YOUR time. The grid can show them in Kevin's time (Eastern), and Copy schedule always
// sends Eastern: both work by turning slots into timestamps and back, so daylight saving is handled by the browser.
export const SCH_OPTS = {
  planRemind: {title: "Remind me when my planned time ends", desc: "If a clock is still running when a planned block ends, the tracker asks, like “Still working?”."},
  planReports: {title: "Show planned hours in reports", desc: "Adds a Planned column to Worked hours, on screen and in the Excel and PDF files."}
};
export const schOpt = k => (S.options || {})[k] !== false;   // on unless switched off
export const showPlan = () => opt("schedule") && schOpt("planReports");
export const sch = {offset: 0, drag: null, confirm: null, focus: null, zone: "local"};   // zone: what the grid shows; opens on "local"
export const schHours = () => P.get("sched-hours");
export const schMonday = () => schDay(bounds().week, 7 * sch.offset);   // the week shown, as your Monday (its date names the week in any zone)
// The schedule logic is in domain/schedule.js; these wrappers pass it this tracker's schedule
export const weekSlots = mon => Sch.weekSlots(S.schedule, mon);
export const viewSet = (tz, mon) => Sch.viewSet(S.schedule, tz, mon);
export const applyKeys = (tz, mon, keys, add) => { S.schedule = Sch.applyKeys(S.schedule, tz, mon, keys, add); save(); };
export const planned = (from, to) => Sch.planned(S.schedule, from, to);
export const schFmt = () => P.get("sched-copy");
export const kevinSet = () => viewSet(ET, schMonday());
export const copyOut = (f = schFmt()) => Sch.copyText(S.schedule, schMonday(), f);   // always Kevin's time, with the zone line
export const workedStretches = (a, b) => Sch.workedStretches(intervals(), a, b);
export function renderSchedule() {
  const mon = schMonday(), gapInfo = etGap(mon);
  if (!gapInfo.aligned) sch.zone = "local";
  const tz = tzOf(sch.zone), set = viewSet(tz, mon), {from, to} = schHours(), t = now();
  const a = vts(mon, 0, 0, tz), end = vts(mon, 7, 0, tz);
  const tp = tz ? zparts(t, tz) : null, today = tz ? `${tp.y}-${String(tp.mo).padStart(2, "0")}-${String(tp.d).padStart(2, "0")}` : dayKey(t);
  const rel = ["This week", "Last week"][-sch.offset] || (sch.offset === 1 ? "Next week" : "");
  $("#schRange").innerHTML = `${esc(weekText(mon, schDay(mon, 7)))}${rel ? `<small>${rel}</small>` : ""}`;
  $("#schToday").disabled = sch.offset === 0;
  $("#schZoneBox").hidden = !gapInfo.aligned;
  document.querySelectorAll("#schZone [data-zone]").forEach(b => b.setAttribute("aria-pressed", b.dataset.zone === sch.zone));
  $("#schZoneHint").textContent = `Kevin is ${aheadText(gapInfo.mid)}`;
  const o = (h, sel, label) => `<option value="${h}"${h === sel ? " selected" : ""}>${label || slotTime(h * 60)}</option>`;
  const hf = $("#schFrom"), ht = $("#schTo");
  if (document.activeElement !== hf) { setHTML(hf, Array.from({length: 24}, (_, h) => o(h, from)).join("")); hf.value = from; }
  if (document.activeElement !== ht) { setHTML(ht, Array.from({length: 24}, (_, h) => o(h + 1, to, h === 23 ? "Midnight" : "")).join("")); ht.value = to; }

  // Planned vs worked. Mid-week, "so far" counts only the planned slots that have already started.
  const plan = planned(a, end), soFar = planned(a, Math.min(t, end)), w = worked(a, intervals(), end);
  const days = DAYS.filter((_, d) => schBlocks(set, d).length).length;
  const future = a > t, midweek = soFar > 0 && soFar < plan, diff = w - (midweek ? soFar : plan);
  $("#schKpis").innerHTML = `<div class="kpis">
    ${kpi("Planned", dec(plan), "h", `${days} day${days === 1 ? "" : "s"}`)}
    ${kpi("Worked", future ? "–" : dec(w), future ? "" : "h", future ? "week not started" : "tracked by your clocks")}
    ${future ? kpi("Difference", "–") : kpi(midweek ? "Ahead or behind so far" : "Difference", (diff >= 0 ? "+" : "−") + dec(Math.abs(diff)), "h",
      midweek ? `of ${dec(soFar)} h planned so far` : "worked minus planned")}
  </div>`;

  // The grid: a corner, 7 day headings, then one row per half hour. Each block shows its times in its first
  // visible slot. A slot where a clock ran gets a thin line (--ws/--we trim it to the part that was worked).
  // Time that has passed gets a faint veil: whole slots before now, and the current slot down to the minute (--pf).
  const did = future ? [] : workedStretches(a, Math.min(end, t)), focus = sch.focus || `0-${from * 60}`;
  const labels = {};
  DAYS.forEach((_, d) => schBlocks(set, d).forEach(([s, e]) => { const at = Math.max(s, from * 60); if (at < e && at < to * 60) labels[`${d}-${at}`] = shortRange([s, e]); }));
  let h = `<div class="sh"></div>` + DAYS.map((n, d) => {
    const day = schDay(mon, d), mins = schBlocks(set, d).reduce((s, [x, y]) => s + y - x, 0);
    return `<div class="sh${dayKey(day) === today ? " today" : ""}${vts(mon, d + 1, 0, tz) <= t ? " past" : ""}" role="columnheader"><b>${WD(day)}</b><span>${dnum(day)} ${MO(day)}</span><em>${mins ? schH(mins * 60000) : ""}</em></div>`;
  }).join("");
  for (let m = from * 60; m < to * 60; m += SLOT) {
    const half = m % 60 ? " half" : "";
    h += `<div class="hr${half}">${half ? "" : slotTime(m)}</div>` + DAYS.map((n, d) => {
      const k = `${d}-${m}`, on = set.has(k), s = vts(mon, d, m, tz), e = s + SLOTMS;
      const hit = did.filter(x => x[1] > s && x[0] < e);
      const st = [];
      if (hit.length) st.push(`--ws:${((Math.max(hit[0][0], s) - s) / SLOTMS).toFixed(3)};--we:${((e - Math.min(hit[hit.length - 1][1], e)) / SLOTMS).toFixed(3)}`);
      if (s < t && t < e) st.push(`--pf:${((t - s) / SLOTMS).toFixed(3)}`);
      const cls = `${half}${on ? " on" : ""}${dayKey(schDay(mon, d)) === today ? " today" : ""}${e <= t ? " past" : s < t ? " now" : ""}${hit.length ? " w" : ""}`;
      return `<div class="sc${cls}"${st.length ? ` style="${st.join(";")}"` : ""} data-k="${k}" role="gridcell" tabindex="${k === focus ? 0 : -1}" aria-selected="${on}" aria-label="${n} ${slotTime(m)}${on ? ", planned" : ""}${hit.length ? ", worked" : ""}">${labels[k] ? `<span class="blab">${labels[k]}</span>` : ""}</div>`;
    }).join("");
  }
  setHTML($("#schGrid"), h);
  if (!$("#schGrid [tabindex='0']")) { const c = $("#schGrid .sc"); if (c) c.tabIndex = 0; }

  // What gets copied: always Kevin's time
  const fm = schFmt(), ks = kevinSet(), lines = copyOut(fm).split("\n");
  document.querySelectorAll("#schFormat [data-fmt]").forEach(b => b.setAttribute("aria-pressed", b.dataset.fmt === fm));
  setHTML($("#schText"), !ks.size ? `<p class="muted">Nothing planned this week.</p>`
    : `<p class="zl">${esc(lines[0])}</p>` + lines.slice(1).map(l => { const [x, y] = l.split("\t"); return fm === "short" ? `<p>${esc(x)}</p>` : `<p class="two"><b>${esc(x)}</b><span>${y ? esc(y) : `<i class="muted">–</i>`}</span></p>`; }).join(""));
  const shift = gapInfo.mid && sch.zone === "local" ? ` Kevin is ${aheadText(gapInfo.mid)}, so these times differ from your grid.` : "";
  $("#schFormatNote").textContent = (fm === "short" ? "One line per planned day, for a quick message. Days with nothing planned are left out."
    : "One line per day, with a tab between the day and the times, so it pastes into two spreadsheet columns.") + shift;
  $("#schCopy").disabled = !ks.size;

  const cb = $("#schClear"), rb = $("#schRepeat"), last = viewSet(tz, schDay(mon, -7)).size;
  cb.disabled = !set.size; cb.textContent = sch.confirm === "clear" ? "Click again to clear" : "Clear week"; cb.classList.toggle("sure", sch.confirm === "clear");
  rb.disabled = !last; rb.title = last ? "Plan this week the same as last week" : "Nothing was planned last week";
  rb.textContent = sch.confirm === "repeat" ? "Click again to replace this week" : "Same as last week"; rb.classList.toggle("sure", sch.confirm === "repeat");

  setHTML($("#schOpts"), Object.entries(SCH_OPTS).map(([k, x]) => `<label class="item switchrow"><div class="txt"><b>${x.title}</b><small>${x.desc}</small></div>
    <input type="checkbox" role="switch" class="switch" data-opt="${k}" ${schOpt(k) ? "checked" : ""}></label>`).join(""));
}
export const schView = () => viewSet(tzOf(sch.zone), schMonday());
export const schEdit = (keys, add) => applyKeys(tzOf(sch.zone), schMonday(), keys, add);
export function schGo(offset) { sch.offset = offset; sch.confirm = null; renderSchedule(); }
export function schAsk(kind) {   // the first click of Clear or Same as last week, when it would replace a plan
  sch.confirm = kind; renderSchedule();
  const o = sch.offset;
  setTimeout(() => { if (sch.confirm === kind && sch.offset === o) { sch.confirm = null; renderSchedule(); } }, CONFIRM_FOR);
}
// Dragging marks a rectangle from the first slot to the current one; starting on a filled slot erases instead
export const schRect = ({d0, m0, d1, m1}) => {
  const keys = [];
  for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d++) for (let m = Math.min(m0, m1); m <= Math.max(m0, m1); m += SLOT) keys.push(`${d}-${m}`);
  return keys;
};
export function schPreview() {
  const g = $("#schGrid"), tip = $("#schTip");
  g.querySelectorAll(".add,.del").forEach(c => c.classList.remove("add", "del"));
  const dr = sch.drag;
  if (!dr) { tip.hidden = true; return; }
  for (const k of schRect(dr)) { const c = g.querySelector(`[data-k="${k}"]`); if (c) c.classList.add(dr.add ? "add" : "del"); }
  // The live label by the pointer: "Thu 2:30-4pm", "Mon–Wed 9-11am", "Erase Tue 9-10am"
  const mon = schMonday(), da = Math.min(dr.d0, dr.d1), db = Math.max(dr.d0, dr.d1);
  const days = da === db ? WD(schDay(mon, da)) : `${WD(schDay(mon, da))}–${WD(schDay(mon, db))}`;
  tip.textContent = `${dr.add ? "" : "Erase "}${days} ${shortRange([Math.min(dr.m0, dr.m1), Math.max(dr.m0, dr.m1) + SLOT])}`;
  tip.hidden = false; schTipMove();
}
export function schTipMove() {   // keep the label just above and right of the pointer, inside the window
  const dr = sch.drag, tip = $("#schTip"); if (!dr || tip.hidden) return;
  tip.style.left = Math.min(dr.x + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.max(8, dr.y - 34) + "px";
}
export function schEnd(commit) {
  const dr = sch.drag; if (!dr) return;
  sch.drag = null;
  if (commit) { schEdit(schRect(dr), dr.add); sch.confirm = null; }
  schPreview(); renderSchedule();
}
export function schToggle(k) { schEdit([k], !schView().has(k)); sch.focus = k; renderSchedule(); $(`#schGrid [data-k="${k}"]`).focus(); }
// Reminder: a planned block has just ended (in the last 15 minutes) and a clock that started before it is still running
export function checkPlanEnd(t) {
  if (urgent() || !opt("schedule") || !schOpt("planRemind")) return;
  const e = Sch.planEndDue(S.schedule, S.running, t, P.get("plan-told"), bounds().week);
  if (!e) return;
  P.set("plan-told", e);
  setGap({kind: "plan", from: e, at: t});
  notify("Your planned time is over", `You planned to stop at ${when(e)}, and a clock is still running. Open the tracker to answer.`);
}

// Events for this area (called once at start-up by js/main.js)
export function initSchedule() {
// Weekly schedule
$("#schPrev").addEventListener("click", () => schGo(sch.offset - 1));
$("#schNext").addEventListener("click", () => schGo(sch.offset + 1));
$("#schToday").addEventListener("click", () => schGo(0));
["#schFrom", "#schTo"].forEach(s => $(s).addEventListener("change", e => {
  let f = +$("#schFrom").value, t = +$("#schTo").value;
  if (t <= f) { if (e.target.id === "schFrom") t = Math.min(24, f + 1); else f = Math.max(0, t - 1); }
  P.set("sched-hours", {from: f, to: t}); sch.focus = null; e.target.blur(); renderSchedule();
}));
$("#schCopy").addEventListener("click", async () => {
  const ok = await copyText(copyOut());   // always Kevin's time
  toast(ok ? "Schedule copied in Kevin's time (Eastern). Paste it where he will see it." : "Couldn't copy. Select the text under What gets copied and press Ctrl+C.");
});
$("#schFormat").addEventListener("click", e => { const b = e.target.closest("[data-fmt]"); if (b) { P.set("sched-copy", b.dataset.fmt); renderSchedule(); } });
$("#schClear").addEventListener("click", () => {
  if (sch.confirm !== "clear") { schAsk("clear"); return; }
  sch.confirm = null; schEdit([...schView()], false); renderSchedule(); toast("Week cleared");
});
$("#schRepeat").addEventListener("click", () => {
  const last = viewSet(tzOf(sch.zone), schDay(schMonday(), -7));
  if (!last.size) return;
  if (schView().size && sch.confirm !== "repeat") { schAsk("repeat"); return; }
  sch.confirm = null; schEdit([...schView()], false); schEdit([...last], true); renderSchedule(); toast("Planned the same as last week");
});
$("#schZone").addEventListener("click", e => { const b = e.target.closest("[data-zone]"); if (b) { sch.zone = b.dataset.zone; sch.confirm = null; renderSchedule(); } });
$("#schOpts").addEventListener("change", e => { if (e.target.dataset.opt) setOpt(e.target.dataset.opt, e.target.checked); });
const schGrid = $("#schGrid");
schGrid.addEventListener("pointerdown", e => {
  const c = e.target.closest(".sc"); if (!c || e.button > 0) return;
  e.preventDefault();
  const [d, m] = c.dataset.k.split("-").map(Number);
  sch.drag = {d0: d, m0: m, d1: d, m1: m, add: !schView().has(c.dataset.k), x: e.clientX, y: e.clientY};
  sch.focus = c.dataset.k;
  schGrid.setPointerCapture(e.pointerId); schPreview();
});
schGrid.addEventListener("pointermove", e => {
  if (!sch.drag) return;
  sch.drag.x = e.clientX; sch.drag.y = e.clientY;
  const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest("#schGrid .sc");
  const [d, m] = c ? c.dataset.k.split("-").map(Number) : [sch.drag.d1, sch.drag.m1];
  if (d !== sch.drag.d1 || m !== sch.drag.m1) { sch.drag.d1 = d; sch.drag.m1 = m; schPreview(); }
  else schTipMove();
});
schGrid.addEventListener("pointerup", () => schEnd(true));
schGrid.addEventListener("pointercancel", () => schEnd(false));
// Keyboard: arrows move, Space or Enter fills or empties a slot
schGrid.addEventListener("keydown", e => {
  const c = e.target.closest(".sc"); if (!c) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); schToggle(c.dataset.k); return; }
  const mv = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -SLOT], ArrowDown: [0, SLOT]}[e.key]; if (!mv) return;
  e.preventDefault();
  const [d, m] = c.dataset.k.split("-").map(Number), n = schGrid.querySelector(`[data-k="${d + mv[0]}-${m + mv[1]}"]`);
  if (n) { c.tabIndex = -1; n.tabIndex = 0; sch.focus = n.dataset.k; n.focus(); }
});
}
