/* The ⋯ menus (a book on the board, a closed project, Export report, the installed app's window size) and what their items do. */
import {invoiceNumber} from "../domain/invoice.js";
import {P, commit, hasExtra, proj, shortName} from "../data/store.js";
import {closeProject, deleteProject, fitBoard, reopenProject, setWinSize, showSummary, startRename} from "./clocks.js";
import {$, CONFIRM_FOR, I, esc, toast} from "./dom.js";
import {exportReport} from "./export.js";
import {opt} from "./extras.js";
import {openInvoice} from "./invoice.js";
import {canMini, toggleMini} from "./mini.js";
import {docPeriod, per, periodRange} from "./reports.js";

/* ---------- ⋯ menus (projects on the clock board, and closed projects) ---------- */
export let menu = null, menuTimer;
export function openMenu(kind, id, anchor) {
  if (menu && menu.anchor === anchor) { closeMenu(); return; }
  menu = {kind, id, anchor, confirm: null};
  drawMenu();
  const first = $("#menu button"); if (first) first.focus();
}
export function closeMenu() {
  if (!menu) return;
  clearTimeout(menuTimer); menu = null; $("#menu").hidden = true;
}
export function drawMenu() {
  const el = $("#menu");
  const items = menu.kind === "project"
    ? [["rename", I.pen, "Rename"], embedItem(proj(menu.id)), ["close", I.done, menu.confirm === "close" ? "Click again to close" : "Close project"], ["delete", I.trash, menu.confirm === "delete" ? "Click again to delete" : "Delete project", "danger"]]
    : menu.kind === "winsize"
    ? [...WIN_SIZES.map(([m, label]) => ["win-" + m, P.get("win-size") === m ? I.tick : I.blank, label]), ...(canMini ? [["mini", I.win, "Mini tracker"]] : [])]
    : menu.kind === "export"
    ? [["xlsx", I.sheet, "Excel workbook"], ["pdf", I.pdf, "PDF"], ...(opt("invoices") ? [["invoice", I.receipt, per.unit === "week" ? `Invoice ${invoiceNumber(periodRange()[0])}` : "Invoice (pick Week first)"]] : [])]
    : [["copy", I.copy, "Copy summary"], ["reopen", I.undo, "Reopen project"]];
  el.innerHTML = (menu.kind === "export" ? `<h3>Report for ${esc(docPeriod(periodRange()))}</h3>` : "")
    + items.map(([act, icon, label, tone]) => `<button type="button" role="menuitem" data-act="${act}" class="${tone || ""}${menu.confirm === act ? " sure" : ""}">${icon}${label}</button>`).join("")
    + (menu.kind === "project" ? `<p>Closing copies a summary for Basecamp and keeps all the time.</p>`
      : menu.kind === "winsize" ? `<p>How big the app's window is. The mini tracker is a small strip that stays on top.</p>`
      : menu.kind === "export" ? `<p>Excel and PDF: one file with worked hours, project time and time entries.${opt("invoices") ? " The invoice uses your worked hours and notes." : ""}</p>` : "");
  el.hidden = false;
  const r = menu.anchor.getBoundingClientRect(), w = el.offsetWidth;
  el.style.top = `${r.bottom + window.scrollY + 6}px`;
  // Buttons on the right half of the page get a menu that lines up with their right edge
  const x = r.left + r.width / 2 > document.documentElement.clientWidth / 2 ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(x + window.scrollX, document.documentElement.clientWidth - w - 8))}px`;
}
export const WIN_SIZES = [["fit", "Fit my projects"], ["fill", "Fill the screen"], ["mine", "Keep my size"]];
// Add, or remove while it has no time (so no time is ever lost)
export const embedItem = p => p && hasExtra(p, "embed") ? ["embed-off", I.trash, "Remove Embedding clock"] : ["embed-on", I.plus, "Add Embedding clock"];
export function toggleEmbed(id) {
  const p = proj(id); if (!p) return;
  if (!hasExtra(p, "embed")) { p.extras = [...(p.extras || []), "embed"]; commit(); toast(`Embed clock added to ${shortName(p)}`); return; }
  p.extras = (p.extras || []).filter(x => x !== "embed");
  if (hasExtra(p, "embed")) { p.extras.push("embed"); toast("This book has Embedding time, so its clock stays. Delete those time entries first if you really want it gone."); return; }
  if (!p.extras.length) delete p.extras;
  commit(); toast("Embed clock removed");
}
export function menuAction(act) {
  const id = menu.id;
  if ((act === "close" || act === "delete") && menu.confirm !== act) {
    menu.confirm = act; drawMenu();
    const b = $(`#menu [data-act="${act}"]`); if (b) b.focus();
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => { if (menu) { menu.confirm = null; drawMenu(); } }, CONFIRM_FOR);
    return;
  }
  closeMenu();
  if (act === "rename") startRename(id);
  else if (act === "embed-on" || act === "embed-off") toggleEmbed(id);
  else if (act === "close") closeProject(id);
  else if (act === "delete") deleteProject(id);
  else if (act === "copy") showSummary(proj(id), false);
  else if (act === "reopen") reopenProject(id);
  else if (act.startsWith("win-")) setWinSize(act.slice(4));
  else if (act === "mini") toggleMini();
  else if (act === "xlsx" || act === "pdf") exportReport(act);
  else if (act === "invoice") { if (per.unit === "week") openInvoice(); else toast("Invoices are weekly. Click Week above, then pick the week."); }
}

// Events for this area (called once at start-up by js/main.js)
export function initMenu() {
// ⋯ menu
$("#menu").addEventListener("click", e => {
  e.stopPropagation();   // the menu redraws itself, so the "clicked outside" check below must not see this click
  const b = e.target.closest("[data-act]"); if (b && menu) menuAction(b.dataset.act);
});
document.addEventListener("click", e => { if (menu && !e.target.closest("#menu") && !e.target.closest("[data-menu]")) closeMenu(); });
window.addEventListener("resize", () => { closeMenu(); fitBoard(); });
}
