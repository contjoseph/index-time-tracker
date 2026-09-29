/* Export (Excel, PDF), backup and restore. */
import * as Rep from "../domain/report.js";
import * as ReportFiles from "../lib/reports.js";
import {dayKey} from "../core/time.js";
import {validate} from "../data/schema.js";
import {P, S, commit, intervals, replaceData} from "../data/store.js";
import {stopRename} from "./clocks.js";
import {now, toast} from "./dom.js";
import {closeEntryForm} from "./entries.js";
import {per, periodLabel, periodRange} from "./reports.js";
import {planned, showPlan} from "./schedule.js";
import {renderSafe} from "./settings.js";

/* ---------- export / backup ---------- */
export function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const download = (filename, text, type) => saveBlob(filename, new Blob([text], {type}));
// Everything the report files need, worked out once for the chosen period
export const reportData = () => Rep.reportData(S, intervals(), per.unit, periodRange(), showPlan() ? planned : null, now());
// The Excel and PDF helpers are only loaded the first time you export (they are stored with the app, so this works offline)
export const LIBS = {xlsx: ["lib/exceljs.min.js"], pdf: ["lib/jspdf.umd.min.js", "lib/jspdf.plugin.autotable.min.js"]};
export const scripts = {};
export function loadScript(src) {
  return scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = src;
    el.onload = res; el.onerror = () => { delete scripts[src]; el.remove(); rej(new Error("Couldn't load " + src)); };
    document.head.appendChild(el);
  }));
}
export let exporting = false;
export async function exportReport(kind) {
  if (exporting) return;
  exporting = true; toast(kind === "xlsx" ? "Making the Excel workbook…" : "Making the PDF…");
  try {
    for (const src of LIBS[kind]) await loadScript(src);   // one after the other: the table add-on needs jsPDF first
    const d = reportData(), name = `time-report-${periodLabel(periodRange()).replace(/ /g, "_")}.${kind}`;
    const blob = kind === "xlsx"
      ? new Blob([await ReportFiles.buildWorkbook(window.ExcelJS, d).xlsx.writeBuffer()], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
      : ReportFiles.buildPDF(window.jspdf.jsPDF, d).output("blob");
    saveBlob(name, blob);
    toast(`Saved ${name} to your downloads`);
  } catch (e) {
    console.error(e);
    toast("Couldn't make the report. Try again; if it keeps failing, reload the tracker.");
  } finally { exporting = false; }
}
export function backup() {
  download(`index-time-backup-${dayKey(now())}.json`, JSON.stringify(S, null, 2), "application/json");
  P.set("backup-at", now()); renderSafe(); toast("Backup saved to your downloads");
}
export function restore(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const r = validate(JSON.parse(rd.result));
      replaceData(r.data); stopRename(); closeEntryForm(); commit();
      toast(`Restored ${S.projects.length} project${S.projects.length === 1 ? "" : "s"}` + (r.problems.length ? `. Part of the file was damaged: ${r.problems.join("; ")}` : ""));
    } catch { toast("That file isn't a tracker backup"); }
  };
  rd.readAsText(file);
}