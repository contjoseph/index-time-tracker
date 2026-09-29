/* The Settings tab: "Keep your time safe", the Extras switches' events, and Appearance. */
import {dShort, when} from "../core/time.js";
import {P} from "../data/store.js";
import {canFile, fileAction, fileH, fileOK, fileSaved} from "./autosave.js";
import {$, I, esc, now, toast} from "./dom.js";
import {backup, restore} from "./export.js";
import {setOpt} from "./extras.js";
import {mini} from "./mini.js";
import {AWAY, NAG, awayOn, canAway, canPop, checkEvery, soundOn, stopAway, testAlert, turnOnPopups, turnOnReminders} from "./safety.js";

/* ---------- "Keep your time safe" card ---------- */
// A checklist while anything is left to set up; one calm line once everything is on.
export let safeOpen = false;
export function renderSafe() {
  const el = $("#safe"); if (!el) return;
  if (el.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;   // don't close an open dropdown
  const every = checkEvery(), backedUp = P.get("backup-at");
  const file = !canFile ? "na" : !fileH ? "off" : !fileOK ? "paused" : "on";
  const away = !canAway ? "na" : awayOn ? "on" : "off";
  const check = every ? "on" : "off";
  const pops = !canPop ? "na" : Notification.permission === "granted" ? "on" : "off";
  const steps = [file, away, check, pops].filter(s => s !== "na"), done = steps.filter(s => s === "on").length, allOn = done === steps.length;
  const lastBackup = backedUp ? dShort(backedUp) : "never";
  $("#safeDot").hidden = allOn;

  if (allOn && !safeOpen) {
    const parts = [file === "on" ? `Auto-saving to ${esc(fileH.name)}` : `Save a backup now and then (last: ${lastBackup})`];
    if (away === "on") parts.push("away detection on");
    parts.push(`“Still working?” after ${every / 3600000} h`);
    if (pops === "on") parts.push(soundOn() ? "pop-ups and sound on" : "pop-ups on, sound off");
    el.className = "card safe compact";
    el.innerHTML = `<div class="shield">${I.shield}</div>
      <p><b>Your time is protected.</b> <span class="muted">${parts.join(" · ")}</span></p>
      <button type="button" class="btn ghost" data-s="open">${I.gear}Settings</button>`;
    return;
  }
  // Only the first thing still to do gets the dark button, so there's one clear next step
  let firstTodo = true;
  const main = () => { const m = firstTodo; firstTodo = false; return m ? "btn primary" : "btn"; };
  const pill = s => ({on: `<span class="pill on">On</span>`, off: `<span class="pill off">Off</span>`, paused: `<span class="pill off">Paused</span>`, na: `<span class="pill na">Chrome / Edge</span>`})[s] || "<span></span>";
  const item = (state, icon, title, desc, actions) => `<div class="item${state === "on" ? " on" : ""}">
      <div class="ico">${icon}</div><div class="txt"><b>${title}</b><small>${desc}</small></div>${pill(state)}<div class="act">${actions}</div></div>`;

  const fileItem = item(file, I.file, "Auto-save file",
    file === "on" ? `Saving to <b>${esc(fileH.name)}</b>${fileSaved ? ` · last saved ${when(fileSaved)}` : ""}.`
    : file === "paused" ? `Your browser wants your OK again before it updates <b>${esc(fileH.name)}</b>.`
    : file === "na" ? "Needs Chrome or Edge. In this browser, save a backup now and then."
    : "Keeps a copy of your time in a file, even if the browser's data is cleared.",
    file === "on" ? `<button type="button" class="btn ghost" data-s="file-stop">Disconnect</button>`
    : file === "paused" ? `<button type="button" class="${main()}" data-s="file-allow">Allow saving</button>`
    : file === "off" ? `<button type="button" class="${main()}" data-s="file-new">Create file</button><button type="button" class="btn ghost" data-s="file-open">Open existing</button>` : "");
  const awayItem = item(away, I.user, "Away detection",
    away === "na" ? "Needs Chrome or Edge." : `Asks about the time when you've been away from the computer for ${AWAY / 60000} minutes.`,
    away === "on" ? `<button type="button" class="btn ghost" data-s="away-off">Turn off</button>`
    : away === "off" ? `<button type="button" class="${main()}" data-s="away-on">Turn on</button>` : "");
  const checkItem = item(check, I.bell, "“Still working?” check", "Asks if a clock has run a long time without a break.",
    `<select id="checkEvery" aria-label="Ask Still working? after">${[1, 2, 3, 4].map(h => `<option value="${h * 3600000}"${h * 3600000 === every ? " selected" : ""}>After ${h} hour${h > 1 ? "s" : ""}</option>`).join("")}<option value="0"${every ? "" : " selected"}>Never</option></select>`);
  const popItem = item(pops, I.sound, "Pop-ups and sound",
    pops === "na" ? "This browser can't show pop-ups. Keep the tracker where you can see it."
    : pops === "on" ? `A chime${soundOn() ? "" : " (off now)"} and a pop-up that stays until you answer, repeated every ${NAG / 60000} minutes.`
    : Notification.permission === "denied" ? "Your browser is blocking them. Click the lock icon by the address bar and allow notifications."
    : "So you don't miss “Still working?” and away questions, even with the tracker behind other windows.",
    pops === "on" ? `<button type="button" class="btn ghost" data-s="pop-test">Test</button><button type="button" class="btn ghost" data-s="sound">${soundOn() ? "Sound off" : "Sound on"}</button>`
    : pops === "off" ? `<button type="button" class="${main()}" data-s="pop-on">Turn on</button>` : "");
  const backupItem = item("", I.box, "Backup", `A copy you can move to another computer. Last saved: ${lastBackup}.`,
    `<button type="button" class="btn" data-s="backup">Save backup</button><label class="btn ghost" for="restoreFile">Restore</label>`);

  el.className = "card safe";
  el.innerHTML = `<div class="safe-top">
      <div><h2>Keep your time safe</h2><p>${allOn ? "Everything is on." : "A few one-time steps. Your time never leaves this computer."}</p></div>
      <div class="meter"><div class="track"><i style="width:${steps.length ? done / steps.length * 100 : 100}%"></i></div>${done} of ${steps.length} set up</div>
      ${allOn ? `<button type="button" class="btn ghost" data-s="close">Done</button>` : ""}
    </div>${fileItem}${awayItem}${checkItem}${popItem}${backupItem}`;
}
export function safeAction(a) {
  if (a === "open") { safeOpen = true; renderSafe(); }
  else if (a === "close") { safeOpen = false; renderSafe(); }
  else if (a.startsWith("file-")) fileAction(a.slice(5));
  else if (a === "away-on") turnOnReminders();
  else if (a === "away-off") stopAway();
  else if (a === "pop-on") turnOnPopups();
  else if (a === "pop-test") testAlert();
  else if (a === "sound") { P.set("sound", !soundOn()); renderSafe(); if (soundOn()) testAlert(); else toast("Sound is off"); }
  else if (a === "backup") backup();
}
// Appearance: "" follows the computer; "light" or "dark" sets html[data-theme] (a script in index.html's <head> sets it before the page draws)
export function applyTheme() {
  const v = P.get("theme");
  for (const d of [document, mini && mini.document]) if (d) { if (v) d.documentElement.dataset.theme = v; else delete d.documentElement.dataset.theme; }
  document.querySelectorAll("#theme [data-theme]").forEach(b => b.setAttribute("aria-pressed", b.dataset.theme === v));
}
$("#theme").addEventListener("click", e => { const b = e.target.closest("[data-theme]"); if (b) { P.set("theme", b.dataset.theme); applyTheme(); } });

// Events for this area (called once at start-up by js/main.js)
export function initSettings() {
// Keep your time safe
$("#extras").addEventListener("change", e => { if (e.target.dataset.opt) setOpt(e.target.dataset.opt, e.target.checked); });
$("#safe").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) safeAction(b.dataset.s); });
$("#safe").addEventListener("change", e => {
  if (e.target.id !== "checkEvery") return;
  P.set("check-every", e.target.value); P.set("checked", now());
  e.target.blur(); renderSafe();
});
$("#restoreFile").addEventListener("change", e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; });
}
