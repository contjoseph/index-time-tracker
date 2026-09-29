/* The weekly invoice dialog: details form, preview and Save PDF. */
import * as Inv from "../domain/invoice.js";
import * as ReportFiles from "../lib/reports.js";
import {invReady, round2, usDate} from "../domain/invoice.js";
import {S, save} from "../data/store.js";
import {$, esc, now, toast} from "./dom.js";
import {LIBS, loadScript, saveBlob} from "./export.js";
import {docPeriod, periodDays, periodRange} from "./reports.js";

/* ---------- weekly invoice ---------- */
// Date = the Monday the week starts. Number = the following Monday as YYMMDD (week of 7 Sep 2026 → 260914).
export const invProfile = () => Inv.invProfile(S);
export const invoiceData = () => { const r = periodRange(); return Inv.invoiceData(S, r, periodDays(r), now()); };
export let invEditing = false, invLogo = null;
export function openInvoice() { invEditing = !invReady(invProfile()); renderInvoice(); const d = $("#invDlg"); if (!d.open) d.showModal(); }
export function renderInvoice() {
  const p = invProfile(), el = $("#invBody");
  if (invEditing) {
    invLogo = p.logo || "";
    $("#invTitle").textContent = "Your invoice details";
    const f = (name, label, value, extra = "") => `<label>${label}<input name="${name}" value="${esc(value || "")}" ${extra}></label>`;
    el.innerHTML = `<form id="invForm" class="invform">
      <p class="muted">Typed once and remembered. They're saved with your time, so backups and the auto-save file keep them too.</p>
      <div class="two">${f("name", "Your name", p.name, 'required placeholder="Jose Contreras"')}${f("billTo", "Bill to", p.billTo, 'required placeholder="Kevin Broccoli"')}</div>
      <div class="two">${f("rate", "Rate per hour", p.rate, 'required inputmode="decimal" placeholder="18.00"')}${f("currency", "Currency sign", p.currency, 'placeholder="$" maxlength="4"')}</div>
      <div class="two">${f("payMethod", "Payment method", p.payMethod, 'placeholder="Revolut"')}${f("payDetails", "Payment details", p.payDetails, 'placeholder="Revolut Tag: contjoseph"')}</div>
      <div class="two">${f("phone", "Phone", p.phone, 'placeholder="+52 312 123 1603"')}${f("email", "Email", p.email, 'type="email" placeholder="you@example.com"')}</div>
      <div class="logo"><span class="lab2">Logo</span><img id="invLogoImg" alt="" ${p.logo ? `src="${p.logo}"` : "hidden"}>
        <label class="btn">Choose image<input type="file" id="invLogoFile" accept="image/*" hidden></label>
        <button type="button" class="btn ghost" id="invLogoRemove" ${p.logo ? "" : "hidden"}>Remove</button></div>
      <div class="dlgbtns">${invReady(p) ? '<button type="button" class="btn ghost" id="invCancel">Cancel</button>' : ""}<button class="btn primary" type="submit">Save details</button></div>
    </form>`;
    return;
  }
  const d = invoiceData();
  $("#invTitle").textContent = `Invoice ${d.number}`;
  el.innerHTML = `<div class="invmeta">
      <div><span>Date</span><b>${usDate(d.date)}</b></div><div><span>Bill to</span><b>${esc(d.billTo)}</b></div>
      <div><span>Rate</span><b>${esc(d.currency)} ${d.rate.toFixed(2)}/h</b></div><div><span>Week</span><b>${esc(docPeriod(periodRange()))}</b></div></div>
    ${d.lines.length ? `<div class="tablewrap"><table class="invlines"><thead><tr><th>Date</th><th>Item description</th><th class="num">Hrs</th><th class="num">Total</th></tr></thead>
      <tbody>${d.lines.map(l => `<tr><td>${usDate(l.date)}</td><td>${esc(l.desc)}</td><td class="num">${l.hours.toFixed(2)}</td><td class="num">${esc(d.currency)} ${l.total.toFixed(2)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${d.totalHours.toFixed(2)}</td><td class="num">${esc(d.currency)} ${d.total.toFixed(2)}</td></tr></tfoot></table></div>
      <p class="muted small">Descriptions come from your projects, activities and notes. To change one, edit the note on that time entry.</p>`
      : `<p class="empty">No time tracked this week, so there's nothing to invoice.</p>`}
    <div class="dlgbtns"><button type="button" class="btn ghost" id="invEdit">Edit my details</button>
      <button type="button" class="btn primary" id="invSave" ${d.lines.length ? "" : "disabled"}>Save PDF</button></div>`;
}
// Logos are shrunk to at most 300 px, so they stay small in the tracker's storage
export function readLogo(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const k = Math.min(1, 300 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/png"));
    }; img.onerror = rej; img.src = rd.result; };
    rd.onerror = rej; rd.readAsDataURL(file);
  });
}
export async function saveInvoicePDF() {
  try {
    for (const src of LIBS.pdf) await loadScript(src);
    const d = invoiceData();
    saveBlob(`invoice ${d.number}.pdf`, ReportFiles.buildInvoice(window.jspdf.jsPDF, d).output("blob"));
    toast(`Saved invoice ${d.number}.pdf to your downloads`);
  } catch (e) { console.error(e); toast("Couldn't make the invoice. Try again; if it keeps failing, reload the tracker."); }
}

// Events for this area (called once at start-up by js/main.js)
export function initInvoice() {
// Invoice window
$("#invX").addEventListener("click", () => $("#invDlg").close());
$("#invBody").addEventListener("click", e => {
  const id = e.target.closest("button") && e.target.closest("button").id;
  if (id === "invEdit") { invEditing = true; renderInvoice(); }
  else if (id === "invCancel") { invEditing = false; renderInvoice(); }
  else if (id === "invSave") saveInvoicePDF();
  else if (id === "invLogoRemove") { invLogo = ""; $("#invLogoImg").hidden = true; e.target.hidden = true; }
});
$("#invBody").addEventListener("change", async e => {
  if (e.target.id !== "invLogoFile" || !e.target.files[0]) return;
  try { invLogo = await readLogo(e.target.files[0]); const img = $("#invLogoImg"); img.src = invLogo; img.hidden = false; $("#invLogoRemove").hidden = false; }
  catch { toast("That image couldn't be read. Try a PNG or JPG."); }
});
$("#invBody").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, v = n => f.elements[n].value.trim(), rate = parseFloat(v("rate").replace(",", "."));
  if (!(rate > 0)) { toast("Type your rate per hour, like 18.00"); return; }
  S.invoice = {name: v("name"), billTo: v("billTo"), rate: round2(rate), currency: v("currency") || "$",
    payMethod: v("payMethod"), payDetails: v("payDetails"), phone: v("phone"), email: v("email"), logo: invLogo || ""};
  save(); invEditing = false; renderInvoice(); toast("Invoice details saved");
});
}
