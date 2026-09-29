/* Extras: invoices, notes and the weekly schedule are off unless someone turns them on. */
import {S, commit} from "../data/store.js";
import {setView} from "../main.js";
import {$, toast} from "./dom.js";
import {hideNote} from "./notes.js";
import {SCH_OPTS} from "./schedule.js";

/* ---------- extras: invoices and notes are off unless someone turns them on ---------- */
// Anyone who has already saved invoice details keeps both on without having to find the switches.
export const EXTRAS = {
  invoices: {title: "Invoices", desc: "Adds Invoice to the Export report menu: a weekly invoice made from your worked hours."},
  notes: {title: "Ask what I did when a clock stops", desc: "A short note, like \"ch. 52-54\". Notes appear in time entries, reports and invoices."},
  schedule: {title: "Weekly schedule", desc: "Adds a Schedule tab: mark when you plan to work each week, then copy it for Kevin."}
};
export const opt = k => { const o = S.options || {}; return k in o ? !!o[k] : !!S.invoice; };
export function setOpt(k, on) {
  S.options = {...(S.options || {}), [k]: on};
  if (!on && k === "notes") hideNote();
  commit(); toast(`${(EXTRAS[k] || SCH_OPTS[k]).title}: ${on ? "on" : "off"}`);
}
export function renderExtras() {
  $("#extras").innerHTML = `<div class="safe-top"><div><h2>Extras</h2><p>Optional tools. Turn on only what you use.</p></div></div>
    ${Object.entries(EXTRAS).map(([k, x]) => `<label class="item switchrow"><div class="txt"><b>${x.title}</b><small>${x.desc}</small></div>
      <input type="checkbox" role="switch" class="switch" data-opt="${k}" ${opt(k) ? "checked" : ""}></label>`).join("")}`;
  const tab = $('.views [data-view="schedule"]');
  tab.hidden = !opt("schedule");
  if (tab.hidden && !$('[data-pane="schedule"]').hidden) setView("settings");
}