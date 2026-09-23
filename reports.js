/* Report files: one Excel workbook with three sheets, and one PDF with the same three parts.
   The tracker works out the numbers and passes plain data:
   d = {periodText, generated, activities:[{id, name, color}],
        days:[{day, ms, what:[{name, acts:[activityId]}]}]    every day of the period up to today; ms 0 = did not work
        workdays, projects:[{name, cells:[ms per activity], tot}], workedMs,
        entries:[{start, end, project, activity}]} */
(function (root) {
"use strict";
const NONE = "Did not work";
const dec = ms => (ms / 3600000).toFixed(2);
const hrs = ms => +(ms / 3600000).toFixed(4);
const hmm = ms => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const loc = (t, o) => new Date(t).toLocaleDateString([], o);
const WD = t => loc(t, {weekday: "short"}), WDL = t => loc(t, {weekday: "long"}), MO = t => loc(t, {month: "short"}), MOL = t => loc(t, {month: "long"});
const dnum = t => new Date(t).getDate(), yr = t => new Date(t).getFullYear();
const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const stamp = t => `${WD(t)} ${dnum(t)} ${MO(t)} ${yr(t)}, ${new Date(t).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})}`;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Time worked by a group of entries, with overlapping clocks counted once
const workedMs = list => { const iv = list.map(e => [e.start, e.end]).sort((a, b) => a[0] - b[0]); let t = 0, cs = 0, ce = 0; for (const [s, e] of iv) { if (s > ce) { t += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e; } return t + ce - cs; };
const byDay = entries => {
  const groups = [];
  for (const e of [...entries].sort((x, y) => x.start - y.start)) {
    const k = dayKey(e.start), g = groups[groups.length - 1];
    if (g && g.k === k) g.items.push(e); else groups.push({k, day: e.start, items: [e]});
  }
  return groups;
};
const actOf = (d, id) => d.activities.find(a => a.id === id) || {name: id, color: "#5A6572"};
const sortedProjects = d => [...d.projects].sort((a, b) => b.tot - a.tot);
const WORKED_NOTE = "Billable time. Clocks running at the same time count once.";
const PROJECT_NOTE = "Hours on each book. Each project gets its full clock time.";

/* ======================= Excel (ExcelJS) ======================= */
const INK = "FF17202A", MUTED = "FF5A6572", SOFT = "FFF2F4F6", LINE = "FFDDE2E7", WHITE = "FFFFFFFF";
const argb = hex => "FF" + hex.replace("#", "").toUpperCase();
// Excel has no time zones, so it gets the local wall-clock time
const xlDate = t => { const d = new Date(t); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())); };

function sheetTitle(ws, title, sub, d, width) {
  for (let r = 1; r <= 3; r++) ws.mergeCells(r, 1, r, width);
  Object.assign(ws.getCell(1, 1), {value: title, font: {size: 20, bold: true, color: {argb: INK}}});
  Object.assign(ws.getCell(2, 1), {value: d.periodText, font: {size: 13, bold: true, color: {argb: INK}}});
  Object.assign(ws.getCell(3, 1), {value: `${sub}  Made ${stamp(d.generated)}.`, font: {size: 10, color: {argb: MUTED}}});
  ws.getRow(1).height = 30; ws.getRow(2).height = 20;
}
function kpiCells(ws, row, items) {   // label above value, one column each
  items.forEach(([label, value, fmt], i) => {
    Object.assign(ws.getCell(row, i + 1), {value: label.toUpperCase(), font: {size: 9, bold: true, color: {argb: MUTED}}});
    const v = ws.getCell(row + 1, i + 1);
    v.value = value; v.font = {size: 18, bold: true, color: {argb: INK}}; v.alignment = {horizontal: "left"};
    if (fmt) v.numFmt = fmt;
  });
  ws.getRow(row + 1).height = 26;
}
function headRow(ws, row, labels, fills = [], rightFrom = labels.length - 1) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l; c.font = {bold: true, color: {argb: WHITE}, size: 11};
    c.fill = {type: "pattern", pattern: "solid", fgColor: {argb: fills[i] || INK}};
    c.alignment = {vertical: "middle", horizontal: i >= rightFrom ? "right" : "left", wrapText: true};
  });
  ws.getRow(row).height = 22;
}
function lineUnder(ws, row, width) { for (let c = 1; c <= width; c++) ws.getCell(row, c).border = {bottom: {style: "thin", color: {argb: LINE}}}; }
function totalRow(ws, row, width, label, sumCols, first, last) {
  const r = ws.getRow(row);
  r.getCell(1).value = label;
  for (const c of sumCols) {
    const L = ws.getColumn(c).letter;
    r.getCell(c).value = {formula: `SUM(${L}${first}:${L}${last})`};
    r.getCell(c).numFmt = "0.00";
  }
  for (let c = 1; c <= width; c++) { r.getCell(c).font = {bold: true, size: 12}; r.getCell(c).border = {top: {style: "medium", color: {argb: INK}}}; }
  r.height = 22;
}
function noneRow(ws, row, width, text = NONE) {
  ws.mergeCells(row, 1, row, width);
  Object.assign(ws.getCell(row, 1), {value: text, font: {italic: true, color: {argb: MUTED}, size: 12}, alignment: {vertical: "middle"}});
  ws.getRow(row).height = 24;
}

function workedSheet(wb, d) {
  const ws = wb.addWorksheet("Worked hours", {properties: {tabColor: {argb: INK}}});
  ws.columns = [{width: 20}, {width: 70}, {width: 16}];
  sheetTitle(ws, "Worked hours", WORKED_NOTE, d, 3);
  const H = 9, first = H + 1, days = d.days.length ? d.days : [{day: null, ms: 0, what: []}], last = H + days.length;
  headRow(ws, H, ["Day", "Worked on", "Hours"]);
  days.forEach((x, i) => {
    const r = ws.getRow(first + i);
    if (x.day != null) { r.getCell(1).value = xlDate(x.day); r.getCell(1).numFmt = "ddd d mmm"; }
    r.getCell(1).font = {bold: true, color: {argb: x.ms ? INK : MUTED}};
    r.getCell(1).alignment = {vertical: "top", horizontal: "left"};
    if (x.ms) {
      r.getCell(2).value = {richText: x.what.flatMap((p, j) => [
        {text: (j ? "\n" : "") + p.name + "   ", font: {bold: true, size: 11}},
        {text: p.acts.map(id => actOf(d, id).name).join(", "), font: {size: 10, color: {argb: MUTED}}}])};
      r.getCell(3).value = hrs(x.ms); r.getCell(3).numFmt = "0.00"; r.getCell(3).font = {bold: true};
    } else {
      r.getCell(2).value = NONE; r.getCell(2).font = {italic: true, color: {argb: MUTED}};
    }
    r.getCell(2).alignment = {wrapText: true, vertical: "top"}; r.getCell(3).alignment = {vertical: "top"};
    r.height = Math.max(20, 15.5 * Math.max(1, x.what.length));
    lineUnder(ws, first + i, 3);
  });
  totalRow(ws, last + 1, 3, "Total worked", [3], first, last);
  const w = d.days.reduce((s, x) => s + x.ms, 0), n = d.days.filter(x => x.ms).length;
  kpiCells(ws, 5, [
    ["Hours worked", {formula: `C${last + 1}`, result: +(w / 3600000).toFixed(2)}, "0.00"],
    ["Days worked", {formula: `COUNT(C${first}:C${last})`, result: n}],
    ["Average per day", {formula: `IF(COUNT(C${first}:C${last}),C${last + 1}/COUNT(C${first}:C${last}),0)`, result: n ? +(w / 3600000 / n).toFixed(2) : 0}, "0.00"]]);
  ws.views = [{state: "frozen", ySplit: H, showGridLines: false}];
  ws.pageSetup = {orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${H}:${H}`};
}

function projectSheet(wb, d) {
  const ws = wb.addWorksheet("Project time", {properties: {tabColor: {argb: "FF7657A8"}}});
  const acts = d.activities, W = acts.length + 2;
  ws.columns = [{width: 30}, ...acts.map(() => ({width: 18})), {width: 12}];
  sheetTitle(ws, "Project time", PROJECT_NOTE, d, W);
  const rows = sortedProjects(d), all = rows.reduce((s, x) => s + x.tot, 0);
  const H = 9, first = H + 1, last = H + Math.max(1, rows.length), totL = ws.getColumn(W).letter;
  headRow(ws, H, ["Project", ...acts.map(a => a.name), "Total"], [INK, ...acts.map(a => argb(a.color)), INK], 1);
  // Activity columns are centred, so each book's hours line up under their heading
  const center = c => { c.alignment = {...(c.alignment || {}), horizontal: "center", vertical: "middle"}; };
  acts.forEach((_, j) => center(ws.getCell(H, j + 2)));
  if (!rows.length) noneRow(ws, first, W);
  rows.forEach((x, i) => {
    const r = ws.getRow(first + i);
    r.getCell(1).value = x.name; r.getCell(1).font = {bold: true};
    x.cells.forEach((ms, j) => { const c = r.getCell(j + 2); c.value = ms ? hrs(ms) : null; c.numFmt = "0.00"; center(c); });
    r.getCell(W).value = {formula: `SUM(B${first + i}:${ws.getColumn(W - 1).letter}${first + i})`, result: hrs(x.tot)};
    r.getCell(W).numFmt = "0.00"; r.getCell(W).font = {bold: true};
    r.getCell(1).alignment = r.getCell(W).alignment = {vertical: "middle"};
    lineUnder(ws, first + i, W);
    if (i % 2) for (let c = 1; c <= W; c++) ws.getCell(first + i, c).fill = {type: "pattern", pattern: "solid", fgColor: {argb: SOFT}};
    r.height = 20;
  });
  totalRow(ws, last + 1, W, "Total", Array.from({length: acts.length + 1}, (_, i) => i + 2), first, last);
  acts.forEach((_, j) => center(ws.getCell(last + 1, j + 2)));
  kpiCells(ws, 5, [
    ["Project time", {formula: `${totL}${last + 1}`, result: +(all / 3600000).toFixed(2)}, "0.00"],
    ["Projects", rows.length],
    ["Hours worked", +(d.workedMs / 3600000).toFixed(2), "0.00"]]);
  if (all - d.workedMs > 60000) {
    const r = last + 3; ws.mergeCells(r, 1, r, W);
    Object.assign(ws.getCell(r, 1), {value: `Project time is ${dec(all - d.workedMs)} h more than the ${dec(d.workedMs)} h worked, because some clocks ran at the same time.`,
      font: {size: 10, color: {argb: "FF8A5A12"}}, fill: {type: "pattern", pattern: "solid", fgColor: {argb: "FFFFF6E8"}}, alignment: {wrapText: true, vertical: "middle"}});
    ws.getRow(r).height = 22;
  }
  ws.views = [{state: "frozen", ySplit: H, xSplit: 1}];
  ws.pageSetup = {orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${H}:${H}`};
}

function entriesSheet(wb, d) {
  const ws = wb.addWorksheet("Time entries", {views: [{state: "frozen", ySplit: 1}], properties: {tabColor: {argb: MUTED}}});
  ws.columns = [{width: 18}, {width: 9}, {width: 9}, {width: 32}, {width: 18}, {width: 40}, {width: 16}];
  const names = ["Date", "Start", "End", "Project", "Activity", "Note", "Hours"];
  if (!d.entries.length) { headRow(ws, 1, names, [], 6); noneRow(ws, 2, 7); return; }
  const rows = [...d.entries].sort((x, y) => x.start - y.start).map(e => [xlDate(e.start), xlDate(e.start), xlDate(e.end), e.project, actOf(d, e.activity).name, e.note || "", hrs(e.end - e.start)]);
  // A real Excel table: filter buttons, banded rows, and ready for a pivot table
  ws.addTable({name: "TimeEntries", ref: "A1", headerRow: true, totalsRow: true, style: {theme: "TableStyleMedium1", showRowStripes: true},
    columns: [{name: "Date", totalsRowLabel: "Total clock time"}, {name: "Start"}, {name: "End"}, {name: "Project"}, {name: "Activity"}, {name: "Note"}, {name: "Hours", totalsRowFunction: "sum"}], rows});
  for (let r = 2; r <= rows.length + 1; r++) {
    ws.getCell(r, 1).numFmt = "ddd d mmm yyyy"; ws.getCell(r, 1).alignment = {horizontal: "left"};
    ws.getCell(r, 2).numFmt = ws.getCell(r, 3).numFmt = "hh:mm"; ws.getCell(r, 7).numFmt = "0.00";
    ws.getCell(r, 6).alignment = {wrapText: true, vertical: "top"};
  }
  ws.getCell(rows.length + 2, 7).numFmt = "0.00";
  ws.pageSetup = {orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1"};
}

function buildWorkbook(ExcelJS, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Index Time Tracker"; wb.created = new Date(d.generated);
  workedSheet(wb, d); projectSheet(wb, d); entriesSheet(wb, d);
  return wb;
}

/* ======================= PDF (jsPDF + AutoTable) ======================= */
const rgb = hex => { const n = parseInt(hex.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const C = {ink: [23, 32, 42], muted: [90, 101, 114], line: [221, 226, 231], soft: [242, 244, 246], zero: [181, 189, 198], note: [255, 246, 232], noteLine: [240, 214, 174], noteInk: [138, 90, 18]};
const PAGE = {w: 612, h: 792, m: 40};   // US Letter, in points
const BODY_W = PAGE.w - 2 * PAGE.m;

function buildPDF(jsPDF, d) {
  const doc = new jsPDF({unit: "pt", format: "letter"});
  doc.setProperties({title: `Time report · ${d.periodText}`, creator: "Index Time Tracker"});
  const acts = d.activities, rows = sortedProjects(d), all = rows.reduce((s, x) => s + x.tot, 0);
  const w = d.days.reduce((s, x) => s + x.ms, 0), nDays = d.days.filter(x => x.ms).length;
  const txt = (s, x, y, {size = 10, bold = false, color = C.ink, align = "left", italic = false} = {}) => {
    doc.setFont("helvetica", bold ? (italic ? "bolditalic" : "bold") : (italic ? "italic" : "normal"));
    doc.setFontSize(size); doc.setTextColor(...color);
    doc.text(String(s), x, y, {align, baseline: "alphabetic"});
  };
  const base = {theme: "plain", margin: {left: PAGE.m, right: PAGE.m, top: 50, bottom: 50},
    styles: {font: "helvetica", fontSize: 9.5, textColor: C.ink, cellPadding: {top: 6, right: 6, bottom: 6, left: 6}, lineWidth: 0, overflow: "linebreak"},
    headStyles: {fontSize: 7.5, fontStyle: "bold", textColor: C.muted}, footStyles: {fontStyle: "bold", fontSize: 11}};
  // Lines: a dark rule under the headings and above the totals, thin rules between rows
  const rules = data => {
    const c = data.cell, x1 = c.x, x2 = c.x + c.width;
    if (data.section === "head") { doc.setDrawColor(...C.ink); doc.setLineWidth(1.2); doc.line(x1, c.y + c.height, x2, c.y + c.height); }
    else if (data.section === "foot") { doc.setDrawColor(...C.ink); doc.setLineWidth(1.6); doc.line(x1, c.y, x2, c.y); }
    else { doc.setDrawColor(...C.line); doc.setLineWidth(0.6); doc.line(x1, c.y + c.height, x2, c.y + c.height); }
  };
  let y = PAGE.m + 6;
  const section = (title, sub) => {
    if (y > PAGE.h - 150) { doc.addPage(); y = 56; }
    txt(title, PAGE.m, y, {size: 13, bold: true});
    if (sub) txt(sub, PAGE.m, y + 14, {size: 8.5, color: C.muted});
    y += sub ? 22 : 10;
  };

  // --- title block and summary ---
  doc.setFillColor(...C.ink); doc.roundedRect(PAGE.m, y - 7, 7, 7, 1.5, 1.5, "F");
  txt("INDEX TIME TRACKER", PAGE.m + 12, y, {size: 8, bold: true, color: C.muted});
  y += 30; txt("Time report", PAGE.m, y, {size: 26, bold: true});
  y += 22; txt(d.periodText, PAGE.m, y, {size: 13, bold: true});
  y += 15; txt(`Made ${stamp(d.generated)}`, PAGE.m, y, {size: 8.5, color: C.muted});
  y += 16;
  const boxW = BODY_W / 3, boxH = 58, kp = [
    ["HOURS WORKED", dec(w), "h", hmm(w) + " · billable"],
    ["PROJECT TIME", dec(all), "h", `${rows.length} project${rows.length === 1 ? "" : "s"}`],
    ["DAYS WORKED", String(nDays), "", d.workdays ? `of ${d.workdays} workday${d.workdays === 1 ? "" : "s"}` : ""]];
  doc.setDrawColor(...C.line); doc.setLineWidth(0.8);
  doc.setFillColor(...C.soft); doc.roundedRect(PAGE.m, y, boxW, boxH, 6, 6, "F");
  doc.roundedRect(PAGE.m, y, BODY_W, boxH, 6, 6, "S");
  doc.line(PAGE.m + boxW, y, PAGE.m + boxW, y + boxH); doc.line(PAGE.m + 2 * boxW, y, PAGE.m + 2 * boxW, y + boxH);
  kp.forEach(([label, big, unit, extra], i) => {
    const x = PAGE.m + i * boxW + 12;
    txt(label, x, y + 15, {size: 7, bold: true, color: C.muted});
    txt(big, x, y + 36, {size: 20, bold: true});
    if (unit) { doc.setFont("helvetica", "bold"); doc.setFontSize(20); const bw = doc.getTextWidth(big); txt(unit, x + bw + 2, y + 36, {size: 11, bold: true, color: C.muted}); }
    if (extra) txt(extra, x, y + 49, {size: 7.5, color: C.muted});
  });
  y += boxH + 26;

  // --- 1. worked hours, every day of the period ---
  section("Worked hours", WORKED_NOTE);
  const days = d.days.length ? d.days : [{day: null, ms: 0, what: []}];
  const workedLines = x => x.what.map(p => ({name: p.name, acts: p.acts.map(id => actOf(d, id).name).join(", ")}));
  doc.autoTable({...base, startY: y,
    head: [["DAY", "WORKED ON", "HOURS"]],
    body: days.map(x => [x.day == null ? d.periodText : `${WD(x.day)} ${dnum(x.day)} ${MO(x.day)}`, x.ms ? workedLines(x).map(l => `${l.name}   ${l.acts}`).join("\n") : NONE, x.ms ? dec(x.ms) : ""]),
    foot: [["Total worked", "", dec(w)]],
    columnStyles: {0: {cellWidth: 82, fontStyle: "bold"}, 2: {cellWidth: 60, halign: "right", fontStyle: "bold"}},
    didParseCell: data => {
      if (data.column.index === 2) data.cell.styles.halign = "right";
      if (data.section === "body" && !days[data.row.index].ms) { data.cell.styles.textColor = C.muted; data.cell.styles.fontStyle = data.column.index === 1 ? "italic" : "bold"; }
    },
    // Draw "Worked on" ourselves, so project names are bold and activities grey
    willDrawCell: data => { if (data.section === "body" && data.column.index === 1 && days[data.row.index].ms) { data.cell.__lines = data.cell.text; data.cell.text = []; } },
    didDrawCell: data => {
      rules(data);
      const c = data.cell;
      if (!c.__lines) return;
      const lh = 9.5 * 1.15, x0 = c.x + 6;
      workedLines(days[data.row.index]).forEach((l, i) => {
        const yy = c.y + 6 + 9.5 * 0.8 + i * lh;
        txt(l.name, x0, yy, {size: 9.5, bold: true});
        doc.setFont("helvetica", "bold"); const nw = doc.getTextWidth(l.name + "   ");
        txt(l.acts, x0 + Math.max(nw, 150), yy, {size: 9, color: C.muted});
      });
    }});
  y = doc.lastAutoTable.finalY + 30;

  // --- 2. project time ---
  section("Project time", PROJECT_NOTE);
  const maxTot = rows.length ? rows[0].tot : 1;
  doc.autoTable({...base, startY: y,
    head: [["PROJECT", ...acts.map(a => a.name.toUpperCase()), "TOTAL"]],
    body: rows.length ? rows.map(x => [x.name, ...x.cells.map(ms => ms ? dec(ms) : "–"), dec(x.tot)]) : [[{content: NONE, colSpan: acts.length + 2, styles: {fontStyle: "italic", textColor: C.muted}}]],
    foot: rows.length ? [["Total", ...acts.map((_, i) => { const t = rows.reduce((s, x) => s + x.cells[i], 0); return t ? dec(t) : "–"; }), dec(all)]] : undefined,
    columnStyles: {0: {cellWidth: 150, fontStyle: "bold", cellPadding: {top: 6, right: 6, bottom: 14, left: 6}}},
    didParseCell: data => {
      const i = data.column.index;
      if (i > 0) data.cell.styles.halign = "right";
      if (data.section === "head" && i > 0 && i <= acts.length) data.cell.styles.textColor = rgb(acts[i - 1].color);
      if (data.section === "body" && rows.length && i > 0 && i <= acts.length && !rows[data.row.index].cells[i - 1]) data.cell.styles.textColor = C.zero;
      if (data.section === "body" && i === acts.length + 1) data.cell.styles.fontStyle = "bold";
    },
    didDrawCell: data => {
      rules(data);
      // A small bar under each project name, split by activity
      if (data.section !== "body" || data.column.index !== 0 || !rows.length) return;
      const x = rows[data.row.index], c = data.cell, full = (c.width - 12) * x.tot / maxTot;
      let bx = c.x + 6; const by = c.y + c.height - 10;
      x.cells.forEach((ms, i) => { if (!ms) return; const bw = full * ms / x.tot; doc.setFillColor(...rgb(acts[i].color)); doc.rect(bx, by, Math.max(bw - 1, 0.5), 4, "F"); bx += bw; });
    }});
  y = doc.lastAutoTable.finalY + 12;
  if (all - d.workedMs > 60000) {
    const msg = `Project time is ${dec(all - d.workedMs)} h more than the ${dec(d.workedMs)} h worked, because some clocks ran at the same time.`;
    if (y > PAGE.h - 90) { doc.addPage(); y = 56; }
    doc.setFillColor(...C.note); doc.setDrawColor(...C.noteLine); doc.setLineWidth(0.8);
    doc.roundedRect(PAGE.m, y, BODY_W, 24, 5, 5, "FD");
    txt(msg, PAGE.m + 10, y + 15.5, {size: 8.5, color: C.noteInk});
    y += 24;
  }
  y += 30;

  // --- 3. time entries, grouped by day ---
  section("Time entries", `${d.entries.length} entr${d.entries.length === 1 ? "y" : "ies"}. Day totals count overlapping clocks once.`);
  const groups = byDay(d.entries), meta = [], body = [];
  for (const g of groups) {
    meta.push({day: true});
    body.push([{content: `${WDL(g.day)} ${dnum(g.day)} ${MOL(g.day)}`, colSpan: 3}, `${dec(workedMs(g.items))} h worked`]);
    for (const e of g.items) { meta.push({act: actOf(d, e.activity), project: e.project, note: e.note}); body.push([`${hm(e.start)} – ${hm(e.end)}`, e.note ? `${e.project}\n${e.note}` : e.project, actOf(d, e.activity).name, dec(e.end - e.start)]); }
  }
  if (!body.length) { meta.push({}); body.push([{content: NONE, colSpan: 4, styles: {fontStyle: "italic", textColor: C.muted}}]); }
  doc.autoTable({...base, startY: y, styles: {...base.styles, fontSize: 8.5, cellPadding: {top: 4, right: 6, bottom: 4, left: 6}},
    head: [["TIME", "PROJECT", "ACTIVITY", "HOURS"]], body,
    columnStyles: {0: {cellWidth: 78, textColor: C.muted}, 1: {fontStyle: "bold"}, 2: {cellWidth: 130, cellPadding: {top: 4, right: 6, bottom: 4, left: 17}}, 3: {cellWidth: 70, halign: "right"}},
    didParseCell: data => {
      if (data.column.index === 3) data.cell.styles.halign = "right";
      if (data.section === "body" && meta[data.row.index].day) {
        Object.assign(data.cell.styles, {fillColor: C.soft, fontStyle: "bold", textColor: data.column.index === 3 ? C.muted : C.ink, cellPadding: {top: 4, right: 6, bottom: 4, left: 6}});
      }
    },
    // Project in bold, its note underneath in grey
    willDrawCell: data => { if (data.section === "body" && data.column.index === 1 && meta[data.row.index].note) { data.cell.__note = true; data.cell.text = []; } },
    didDrawCell: data => {
      if (!(data.section === "body" && meta[data.row.index].day)) rules(data);
      const m = data.section === "body" && meta[data.row.index];
      if (data.cell.__note) {
        const c = data.cell, x0 = c.x + 6, top = c.y + 4 + 8.5 * 0.8;
        txt(m.project, x0, top, {size: 8.5, bold: true});
        doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.splitTextToSize(m.note, c.width - 12).forEach((line, i) => txt(line, x0, top + 9.8 * (i + 1), {size: 8, color: C.muted}));
      }
      // A coloured dot before each activity, like the tracker
      if (m && m.act && data.column.index === 2) { doc.setFillColor(...rgb(m.act.color)); doc.circle(data.cell.x + 9, data.cell.y + data.cell.height / 2, 2.6, "F"); }
    }});

  // --- page footer on every page ---
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    txt(`Index Time Tracker · ${d.periodText}`, PAGE.m, PAGE.h - 24, {size: 7.5, color: C.muted});
    txt(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - 24, {size: 7.5, color: C.muted, align: "right"});
  }
  return doc;
}

/* ======================= Invoice (jsPDF + AutoTable) =======================
   inv = {number, date, currency, rate, billTo, me: {name, logo, payMethod, payDetails, phone, email},
          lines: [{date, desc, hours, total}], totalHours, total}
   Laid out like the invoice Joseph sends every week. */
const money = (cur, n) => `${cur} ${n.toFixed(2)}`;
const usDate = t => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`; };
function buildInvoice(jsPDF, inv) {
  const doc = new jsPDF({unit: "pt", format: "letter"});
  doc.setProperties({title: `Invoice ${inv.number}`, author: inv.me.name || "", creator: "Index Time Tracker"});
  const ink = [20, 20, 20], grey = [95, 95, 95], box = [240, 238, 236], L = 48, R = PAGE.w - 48, DESC_W = R - L - 72 - 56 - 78;
  const txt = (s, x, y, {size = 11, bold = false, color = ink, align = "left"} = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    doc.text(String(s ?? ""), x, y, {align});
  };
  // Title, name and logo
  txt("INVOICE", 72, 112, {size: 34, bold: true});
  let logoW = 0;
  if (inv.me.logo) {
    try {
      const p = doc.getImageProperties(inv.me.logo), size = 78, sc = Math.min(size / p.width, size / p.height);
      logoW = p.width * sc;
      doc.addImage(inv.me.logo, p.fileType, R - logoW, 34, logoW, p.height * sc);
    } catch (e) { logoW = 0; }
  }
  txt((inv.me.name || "").toUpperCase(), R - (logoW ? logoW + 14 : 0), 90, {size: 17, align: "right"});
  const pay = [inv.me.payMethod ? `Payment Method: ${inv.me.payMethod}` : "", inv.me.payDetails || ""].filter(Boolean);
  pay.forEach((line, i) => txt(line, 392, 132 + i * 18, {size: 10.5}));
  // The four fields on the left, each on an underline
  [["Date:", usDate(inv.date)], ["No. Invoice :", inv.number], ["Bill to:", inv.billTo], ["Rate per hour :", money(inv.currency, inv.rate)]].forEach(([label, value], i) => {
    const y = 168 + i * 34, lw = (doc.setFont("helvetica", "normal"), doc.setFontSize(10.5), doc.getTextWidth(label));
    txt(label, 72, y + 2, {size: 10.5});
    txt(value, 72 + lw + 10, y - 4, {size: 12.5});
    doc.setDrawColor(...ink); doc.setLineWidth(0.7); doc.line(72 + lw + 6, y + 6, 316, y + 6);
  });
  // The table: date, what was done, hours, amount
  doc.autoTable({startY: 300, margin: {left: L, right: PAGE.w - R, top: 50, bottom: 60}, theme: "grid",
    head: [["Date", "Item Description", "Hrs", "Total"]],
    body: inv.lines.map(l => [usDate(l.date), l.desc, l.hours.toFixed(2), money(inv.currency, l.total)]),
    styles: {font: "helvetica", fontSize: 11, textColor: ink, lineColor: [60, 60, 60], lineWidth: 0.7, minCellHeight: 29, valign: "middle", cellPadding: {top: 6, right: 6, bottom: 6, left: 6}},
    headStyles: {fillColor: box, fontStyle: "normal", fontSize: 10.5, halign: "center", minCellHeight: 30},
    columnStyles: {0: {cellWidth: 72}, 2: {cellWidth: 56}, 3: {cellWidth: 78}},
    didParseCell: data => {
      if (data.section !== "body" || data.column.index !== 1) return;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      if (doc.getTextWidth(String(data.cell.raw)) > DESC_W - 12) data.cell.styles.fontSize = 8.5;
    }});
  let y = doc.lastAutoTable.finalY;
  if (y + 190 > PAGE.h - 20) { doc.addPage(); y = 60; }
  txt("Total Hours:", 416, y + 26, {size: 10.5, align: "right"});
  txt(inv.totalHours.toFixed(2), 426, y + 26, {size: 12.5});
  txt("THANK YOU!", 72, y + 96, {size: 26, bold: true});
  doc.setFillColor(...box); doc.setDrawColor(...ink); doc.setLineWidth(1.2);
  doc.rect(326, y + 62, 212, 34, "FD");
  txt("Total:", 334, y + 83, {size: 10.5});
  txt(money(inv.currency, inv.total), 366, y + 84, {size: 13});
  // Contact details, and lines for a signature or notes
  const cy = y + 150;
  [inv.me.phone ? `Phone:  ${inv.me.phone}` : "", inv.me.email ? `Email:  ${inv.me.email}` : ""].filter(Boolean).forEach((line, i) => txt(line, 72, cy + i * 18, {size: 10, color: grey}));
  doc.setDrawColor(...ink); doc.setLineWidth(0.6);
  for (let i = 0; i < 3; i++) doc.line(326, cy - 12 + i * 18, 538, cy - 12 + i * 18);
  return doc;
}

root.ReportFiles = {buildWorkbook, buildPDF, buildInvoice};
if (typeof module !== "undefined") module.exports = root.ReportFiles;
})(typeof window !== "undefined" ? window : globalThis);
