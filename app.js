/* Index Time Tracker — all data is kept on this computer (browser storage, plus an optional auto-save file). */
(() => {
"use strict";
const KEY = "index-time-tracker:v1";
const SEEN = KEY + ":seen";            // last moment the tracker was open and awake
const GAP = 10 * 60000;                // a longer silence than this with clocks running gets a question
const ACTIVITIES = [
  {id: "flip", name: "Flipping", short: "Flip"},
  {id: "mr",   name: "Detailing (MR)", short: "MR"},
  {id: "cal",  name: "Calibration", short: "Cal"},
  {id: "fa",   name: "Final Assembly", short: "FA"},
  {id: "edit", name: "Editing", short: "Edit"}
];

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const now = () => Date.now();

/* ---------- state ---------- */
// projects: [{id, name, created, closed?}]
// entries:  [{id, projectId, activityId, start, end}]   finished stretches of time
// running:  [{projectId, activityId, start}]            clocks ticking right now
// paused:   [{projectId, activityId}]                    clocks waiting for END BREAK
// breakStart: timestamp or null
let S = blank();
function blank() { return {version: 1, projects: [], entries: [], running: [], paused: [], breakStart: null}; }
const valid = d => d && Array.isArray(d.projects) && Array.isArray(d.entries);
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    S = valid(d) ? {...blank(), ...d} : blank();
  } catch { S = blank(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast("Couldn't save — your browser storage may be full or blocked."); }
  queueFile();
}
// Keep several open tabs in step
window.addEventListener("storage", e => { if (e.key === KEY) { load(); render(); } });

let editing = null, entryEdit = null, entryDel = null, gap = null;

/* ---------- time and date helpers ---------- */
function fmt(ms, secs) {
  const t = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return secs ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${h}:${String(m).padStart(2, "0")}`;
}
const dec = ms => (ms / 3600000).toFixed(2);
function bounds() {
  const d = new Date(); d.setHours(0, 0, 0, 0);                        // midnight local time
  const w = new Date(d); w.setDate(w.getDate() - (w.getDay() + 6) % 7); // Monday
  const m = new Date(d.getFullYear(), d.getMonth(), 1);                 // 1st of month
  return {day: d.getTime(), week: w.getTime(), month: m.getTime()};
}
// Machine dates (2026-09-22) are only for the Excel files and form fields; the screen uses words
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const loc = (t, o) => new Date(t).toLocaleDateString([], o);
const WD = t => loc(t, {weekday: "short"}), MO = t => loc(t, {month: "short"}), MOL = t => loc(t, {month: "long"});
const dnum = t => new Date(t).getDate(), yr = t => new Date(t).getFullYear();
const withYear = (s, t) => yr(t) === yr(now()) ? s : `${s} ${yr(t)}`;
const dShort = t => withYear(`${WD(t)} ${dnum(t)} ${MO(t)}`, t);                         // Tue 22 Sep
const dLong = t => withYear(`${loc(t, {weekday: "long"})} ${dnum(t)} ${MOL(t)}`, t);     // Tuesday 22 September
function when(t) {  // "3:12 PM", or "Mon 21 Sep 3:12 PM" when it isn't today
  const time = new Date(t).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
  return dayKey(t) === dayKey(now()) ? time : `${dShort(t)} ${time}`;
}
function parseDT(date, time) {  // "2026-09-22", "14:05" → timestamp
  const [y, m, d] = String(date).split("-").map(Number), [h, mi] = String(time).split(":").map(Number);
  return y && m && d && !isNaN(h) && !isNaN(mi) ? new Date(y, m - 1, d, h, mi).getTime() : NaN;
}
const proj = id => S.projects.find(p => p.id === id);
const actName = id => (ACTIVITIES.find(a => a.id === id) || {}).name || id;
const actColor = id => `var(--a${Math.max(0, ACTIVITIES.findIndex(a => a.id === id)) % 7})`;

// Every stretch of time, with running clocks counted up to this second
function intervals() {
  const t = now();
  return S.entries.map(e => ({p: e.projectId, a: e.activityId, s: e.start, e: e.end}))
    .concat(S.running.map(r => ({p: r.projectId, a: r.activityId, s: r.start, e: t})));
}
// Time actually worked: two clocks running together count once
function worked(from, list, to = Infinity) {
  const iv = list.map(x => [Math.max(x.s, from), Math.min(x.e, to)]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, cs = 0, ce = 0;
  for (const [s, e] of iv) {
    if (s > ce) { total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}
// Sum of all clocks (overlaps counted per clock)
function clockSum(from, list, to = Infinity) { let t = 0; for (const x of list) { const s = Math.max(x.s, from), e = Math.min(x.e, to); if (e > s) t += e - s; } return t; }

/* ---------- icons ---------- */
const svg = (d, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  left: svg('<path d="M15 18l-6-6 6-6"/>'), right: svg('<path d="M9 18l6-6-6-6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', "ic fill"),
  pen: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  done: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13l2 2 4-4"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  box: svg('<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  sheet: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>'),
  pdf: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/>')
};

/* ---------- actions ---------- */
const same = (x, p, a) => x.projectId === p && x.activityId === a;
function record(r, end) {
  if (end - r.start < 5000) return null;     // ignore accidental double-clicks
  const e = {id: uid(), projectId: r.projectId, activityId: r.activityId, start: r.start, end};
  S.entries.push(e);
  return e;
}
function toggleClock(p, a) {
  if (S.breakStart) return;
  const r = S.running.find(x => same(x, p, a));
  let stopped = null;
  if (r) { stopped = record(r, now()); S.running = S.running.filter(x => x !== r); }
  else S.running.push({projectId: p, activityId: a, start: now()});
  save(); render();
  if (stopped && opt("notes")) askNote(stopped);
}

/* ---------- extras: invoices and notes are off unless someone turns them on ---------- */
// Anyone who has already saved invoice details keeps both on without having to find the switches.
const EXTRAS = {
  invoices: {title: "Invoices", desc: "Adds Invoice to the Export report menu: a weekly invoice made from your worked hours."},
  notes: {title: "Ask what I did when a clock stops", desc: "A short note, like \"ch. 52-54\". Notes appear in time entries, reports and invoices."}
};
const opt = k => { const o = S.options || {}; return k in o ? !!o[k] : !!S.invoice; };
function setOpt(k, on) {
  S.options = {...(S.options || {}), [k]: on};
  if (!on && k === "notes") hideNote();
  save(); renderExtras(); toast(`${EXTRAS[k].title}: ${on ? "on" : "off"}`);
}
function renderExtras() {
  $("#extras").innerHTML = `<div class="safe-top"><div><h2>Extras</h2><p>Optional tools. Turn on only what you use.</p></div></div>
    ${Object.entries(EXTRAS).map(([k, x]) => `<label class="item switchrow"><div class="txt"><b>${x.title}</b><small>${x.desc}</small></div>
      <input type="checkbox" role="switch" class="switch" data-opt="${k}" ${opt(k) ? "checked" : ""}></label>`).join("")}`;
}

/* ---------- a short note when a clock stops ("ch. 52-54"), used on the invoice ---------- */
let noteFor = null;
function askNote(e) {
  if (noteFor && noteFor !== e.id) commitNote();
  noteFor = e.id;
  const p = proj(e.projectId) || {};
  $("#noteWhat").textContent = `${p.name || ""} · ${actName(e.activityId)} · ${fmt(e.end - e.start)}`;
  // Suggest notes used before on this project, newest first
  const seen = [...new Set(S.entries.filter(x => x.projectId === e.projectId && x.note).sort((x, y) => y.end - x.end).map(x => x.note))].slice(0, 8);
  $("#noteList").innerHTML = seen.map(n => `<option value="${esc(n)}"></option>`).join("");
  $("#noteInput").value = e.note || "";
  $("#noteBar").hidden = false; document.body.classList.add("has-note");
  $("#noteInput").focus();
}
function hideNote() { noteFor = null; $("#noteBar").hidden = true; document.body.classList.remove("has-note"); }
function commitNote() {
  const x = S.entries.find(y => y.id === noteFor), v = $("#noteInput").value.trim();
  if (x && v !== (x.note || "")) { if (v) x.note = v; else delete x.note; save(); renderLog(); }
  hideNote();
}
function toggleBreak() {
  const t = now();
  if (S.breakStart) {
    S.running = S.paused.filter(x => proj(x.projectId)).map(x => ({projectId: x.projectId, activityId: x.activityId, start: t}));
    toast(`Back to work — break lasted ${fmt(t - S.breakStart)}`);
    S.paused = []; S.breakStart = null;
  } else {
    if (!S.running.length) return;
    S.running.forEach(r => record(r, t));
    S.paused = S.running.map(r => ({projectId: r.projectId, activityId: r.activityId}));
    S.running = []; S.breakStart = t;
  }
  save(); render();
}
function stopAll() {   // from the taskbar's right-click menu
  const t = now(), n = S.running.length + S.paused.length;
  if (!n) { toast("No clocks are running"); return; }
  const stopped = S.running.map(r => record(r, t)).filter(Boolean);
  S.running = []; S.paused = []; S.breakStart = null;
  save(); render(); toast(`Stopped ${n} clock${n === 1 ? "" : "s"}`);
  if (stopped.length === 1 && opt("notes")) askNote(stopped[0]);
}
function addProject(name) {
  name = name.trim();
  if (!name) { toast("Type a project name first"); return false; }
  const clash = S.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (clash) { toast(clash.closed ? "A closed project has that name. Reopen it from the Closed projects tab." : "That project already exists"); return false; }
  S.projects.push({id: uid(), name, created: now()});
  save(); render(); return true;
}
function startRename(id) {
  editing = id; render();
  const i = document.querySelector(`[data-rename="${id}"] input`); if (i) { i.focus(); i.select(); }
}

/* ---------- closing a finished project ---------- */
// A closed project leaves the clock board but keeps all its time; it moves to the Closed projects tab.
const openProjects = () => S.projects.filter(p => !p.closed);
function projectTotals(p) {
  const mine = S.entries.filter(e => e.projectId === p.id);
  const acts = ACTIVITIES.map(a => ({id: a.id, name: a.name, ms: mine.filter(e => e.activityId === a.id).reduce((s, e) => s + e.end - e.start, 0)}));
  const starts = mine.map(e => e.start), ends = mine.map(e => e.end);
  return {acts, tot: acts.reduce((s, a) => s + a.ms, 0), first: starts.length ? Math.min(...starts) : 0, last: ends.length ? Math.max(...ends) : 0};
}
// The text copied for Basecamp: total, then only the activities that have time
function closeSummary(p) {
  const {acts, tot} = projectTotals(p);
  return `${p.name} — closed ${loc(p.closed, {weekday: "short", day: "numeric", month: "short", year: "numeric"})}\n\nTotal time: ${fmt(tot)} (${dec(tot)} h)\n`
    + acts.filter(a => a.ms).map(a => `  ${a.name}: ${fmt(a.ms)} (${dec(a.ms)} h)`).join("\n");
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement("textarea");   // older way, for when the clipboard API is blocked
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  ta.remove(); return ok;
}
async function showSummary(p, justClosed) {
  const text = closeSummary(p), ok = await copyText(text);
  $("#closedTitle").textContent = justClosed ? `${p.name} is closed` : p.name;
  $("#closedText").textContent = text;
  $("#closedMsg").innerHTML = ok ? `✓ Copied to your clipboard. <b>Remember to post your time on Basecamp.</b>`
    : `Couldn't copy automatically. Click <b>Copy again</b>, then post your time on Basecamp.`;
  const dlg = $("#closedDlg");
  if (!dlg.open) dlg.showModal();
}
function closeProject(id) {
  const p = proj(id), t = now(); if (!p) return;
  S.running.filter(r => r.projectId === id).forEach(r => record(r, t));
  S.running = S.running.filter(r => r.projectId !== id);
  S.paused = S.paused.filter(r => r.projectId !== id);
  if (S.breakStart && !S.paused.length) S.breakStart = null;
  p.closed = t; editing = null;
  save(); render(); showSummary(p, true);
}
function reopenProject(id) {
  const p = proj(id); if (!p) return;
  delete p.closed; save(); render(); toast(`${p.name} is back on the clock board`);
}
function deleteProject(id) {
  const p = proj(id);
  S.projects = S.projects.filter(p => p.id !== id);
  S.entries = S.entries.filter(e => e.projectId !== id);
  S.running = S.running.filter(r => r.projectId !== id);
  S.paused = S.paused.filter(r => r.projectId !== id);
  if (S.breakStart && !S.paused.length) S.breakStart = null;
  editing = null; save(); render();
  if (p) toast(`${p.name} deleted`);
}

/* ---------- making sure clocks don't run on by mistake ---------- */
// gap = {kind: "closed", from}          tracker was closed, or the computer asleep or off
//       {kind: "away", from, until}     computer on, but no mouse or keyboard use (Chrome/Edge)
//       {kind: "check", from, at}       a clock has run a long time without a "still working?" answer
const AWAYK = KEY + ":away", CHECKK = KEY + ":checked", EVERYK = KEY + ":check-every", AWAYONK = KEY + ":away-on";
const AWAY = 5 * 60000;                // no mouse or keyboard for this long counts as away
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch {} };
let beat = 0;
function heartbeat() {
  const t = now(), last = +lsGet(SEEN) || 0, away = +lsGet(AWAYK) || 0;
  if (!gap && S.running.length && last && t - last > GAP) gap = {kind: "closed", from: away && away < last ? away : last};
  lsSet(SEEN, t);
  beat = t;
}
function settle() { gap = null; lsSet(AWAYK, null); lsSet(CHECKK, now()); clearAlert(); }
function keepGap() { settle(); tick(); }
function stopAtGap() {
  const at = gap.kind === "check" ? gap.at : gap.from;
  S.running.forEach(r => record(r, Math.max(r.start, at)));
  S.running = []; settle();
  save(); render(); toast(`Clocks stopped at ${when(at)}`);
}
function takeOutAway() {   // count up to when you left, then carry on from when you came back
  const {from, until} = gap;
  S.running.forEach(r => record(r, Math.max(r.start, from)));
  S.running = S.running.map(r => ({...r, start: Math.max(r.start, until)}));
  settle(); save(); render(); toast(`Took out ${fmt(until - from)} away`);
}
// Asking out loud: a chime, a Windows pop-up that stays until clicked, and a blinking tab title.
// Repeats every few minutes until the question is answered, so it's hard to miss.
const SOUNDK = KEY + ":sound", NAG = 5 * 60000;
const canPop = "Notification" in window;
const soundOn = () => lsGet(SOUNDK) !== "0";
let actx = null, popup = null, asking = null, askedAt = 0;
function unlockSound() {   // browsers allow sound only after a click on the page, so get it ready on the first one
  try { if (!actx) actx = new AudioContext(); if (actx.state === "suspended") actx.resume(); } catch {}
}
function chime() {   // a soft two-note "ding-dong"; returns true if it played
  if (!soundOn() || !actx || actx.state !== "running") return false;
  const t0 = actx.currentTime;
  [[659.25, 0], [523.25, 0.4]].forEach(([hz, d]) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine"; o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 1.4);
    o.connect(g).connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 1.5);
  });
  return true;
}
function popUp(title, body, rang) {   // rang: our chime played, so Windows needn't add its own sound
  if (!canPop || Notification.permission !== "granted") return;
  try {
    if (popup) popup.close();
    popup = new Notification(title, {body, icon: "icon.svg", tag: "itt", renotify: true, requireInteraction: true, silent: rang || !soundOn()});
    popup.onclick = () => { window.focus(); if (popup) popup.close(); };
  } catch {}
}
function notify(title, body) {
  asking = [title, body]; askedAt = now();
  const rang = chime();
  if (!document.hasFocus() || document.hidden) popUp(title, body, rang);   // no pop-up if you're already looking at the tracker
}
function clearAlert() { asking = null; if (popup) { popup.close(); popup = null; } }
async function turnOnPopups() {
  unlockSound();
  const p = canPop ? await Notification.requestPermission().catch(() => "denied") : "denied";
  renderSafe();
  if (p !== "granted") { toast("Pop-ups need your OK. Click the lock icon by the address bar and allow notifications."); return; }
  testAlert();
}
function testAlert() {
  unlockSound();
  setTimeout(() => popUp("Index Time Tracker", "This is how the tracker will ask if you're still working.", chime()), 150);
  toast(soundOn() ? "You should hear a chime and see a pop-up" : "You should see a pop-up (sound is off)");
}
const checkEvery = () => { const v = lsGet(EVERYK); return v == null ? 2 * 3600000 : +v; };
function checkStillWorking(t) {
  const every = checkEvery();
  if (!every || gap || !S.running.length) return;
  const base = Math.max(+lsGet(CHECKK) || 0, ...S.running.map(r => r.start));
  if (t - base < every) return;
  gap = {kind: "check", from: base, at: t};
  notify("Still working?", `Your clock has been running for ${fmt(t - base)}. Open the tracker to answer.`);
}
// Away detection uses Chrome and Edge's idle detector, which sees mouse and keyboard use anywhere on the computer
let awayOn = false, idleCtl = null;
const canAway = "IdleDetector" in window;
async function startAway() {
  try {
    if (idleCtl) idleCtl.abort();
    idleCtl = new AbortController();
    const det = new IdleDetector();
    det.addEventListener("change", () => onIdle(det.userState));
    await det.start({threshold: AWAY, signal: idleCtl.signal});
    awayOn = true;
  } catch { awayOn = false; }
  renderSafe();
}
function stopAway() {
  if (idleCtl) idleCtl.abort();
  idleCtl = null; awayOn = false; lsSet(AWAYONK, null); lsSet(AWAYK, null);
  renderSafe(); toast("Away detection is off");
}
function onIdle(state) {
  const t = now();
  if (state === "idle") { if (S.running.length && !lsGet(AWAYK)) lsSet(AWAYK, t - AWAY); return; }
  const from = +lsGet(AWAYK) || 0;
  lsSet(AWAYK, null);
  if (!from || !S.running.length || (gap && gap.kind !== "check")) return;
  gap = {kind: "away", from, until: t};
  notify("Welcome back", `You were away for ${fmt(t - from)} with a clock running. Open the tracker to keep or take out that time.`);
  tick();
}
async function turnOnReminders() {
  const [idle] = await Promise.all([
    IdleDetector.requestPermission().catch(() => "denied"),
    "Notification" in window ? Notification.requestPermission().catch(() => "denied") : "denied"
  ]);
  if (idle !== "granted") { toast("Away detection needs your OK. Click the lock icon by the address bar to allow it."); return; }
  lsSet(AWAYONK, 1); await startAway();
  if (awayOn) toast("Away detection is on");
}
async function resumeAway() {
  if (!canAway || !lsGet(AWAYONK)) { renderSafe(); return; }
  const st = await navigator.permissions.query({name: "idle-detection"}).then(p => p.state).catch(() => "prompt");
  if (st === "granted") await startAway(); else renderSafe();
}
function renderGap(t) {
  if (gap && !S.running.length) gap = null;
  $("#gap").hidden = !gap;
  if (!gap) return;
  const f = when(gap.from);
  $("#gapTake").hidden = gap.kind !== "away";
  $("#gapKeep").textContent = gap.kind === "check" ? "Yes, still working" : "Keep the time";
  if (gap.kind === "closed") {
    $("#gapText").textContent = `Your clocks kept running while the tracker was closed or the computer was asleep or off — from ${f} until now (${fmt(t - gap.from)}).`;
    $("#gapStop").textContent = `Stop them at ${f}`;
  } else if (gap.kind === "away") {
    $("#gapText").textContent = `You were away from the computer from ${f} until ${when(gap.until)} (${fmt(gap.until - gap.from)}) with a clock running.`;
    $("#gapTake").textContent = `Take out the ${fmt(gap.until - gap.from)} away`;
    $("#gapStop").textContent = `Stop them at ${f}`;
  } else {
    $("#gapText").textContent = `Still working? Your clock has been running since ${f} (${fmt(gap.at - gap.from)}).`;
    $("#gapStop").textContent = `No — stop them at ${when(gap.at)}`;
  }
}

/* ---------- clock face ---------- */
const TICKS = Array.from({length: 12}, (_, i) => {
  const a = i * Math.PI / 6, r1 = i % 3 ? 30 : 27;
  return `<line class="tick" x1="${(40 + r1 * Math.sin(a)).toFixed(2)}" y1="${(40 - r1 * Math.cos(a)).toFixed(2)}" x2="${(40 + 33 * Math.sin(a)).toFixed(2)}" y2="${(40 - 33 * Math.cos(a)).toFixed(2)}"/>`;
}).join("");
const angle = ms => (ms / 10000) % 360;   // hand makes one full turn per hour
const face = (ms, key) => `<div class="face"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="rim" cx="40" cy="40" r="36"/>${TICKS}<line class="hand" data-hand="${key}" x1="40" y1="40" x2="40" y2="14" style="transform:rotate(${angle(ms)}deg)"/><circle class="hub" cx="40" cy="40" r="3.5"/></svg></div>`;

/* ---------- render ---------- */
function render() {
  closeMenu();
  const iv = intervals();
  let h = `<div class="row head" style="--n:${ACTIVITIES.length}"><div>Project</div>${ACTIVITIES.map((a, i) => `<div class="ah" style="--c:var(--a${i % 7})">${esc(a.name)}</div>`).join("")}<div>Project total</div></div>`;
  if (!openProjects().length) h += `<div class="empty">${S.projects.length ? "All your projects are closed. Create a new one below." : "Create your first project below, then click any clock to start tracking."}</div>`;
  for (const p of openProjects()) {
    const mine = iv.filter(x => x.p === p.id);
    const anyOn = S.running.some(r => r.projectId === p.id);
    const name = editing === p.id
      ? `<form class="edit" data-rename="${p.id}"><input name="n" value="${esc(p.name)}" aria-label="Project name">
          <button class="btn small primary" type="submit">Save</button>
          <button type="button" class="btn small ghost" data-cancel="1">Cancel</button></form>`
      : `<div class="pnrow"><button type="button" class="name" data-edit="${p.id}" title="Rename">${esc(p.name)}</button>
         <button type="button" class="btn icon more" data-menu="project|${p.id}" aria-haspopup="menu" aria-label="More for ${esc(p.name)}" title="Rename, close or delete">${I.more}</button></div>`;
    const clocks = ACTIVITIES.map((a, i) => {
      const ms = clockSum(0, mine.filter(x => x.a === a.id));
      const on = S.running.some(x => same(x, p.id, a.id)), pz = S.paused.some(x => same(x, p.id, a.id));
      return `<button type="button" class="clk${on ? " on" : ""}${pz ? " paused" : ""}" style="--c:var(--a${i % 7})" data-clock="${p.id}|${a.id}" ${S.breakStart ? "disabled" : ""} aria-pressed="${on}" aria-label="${on ? "Stop" : "Start"} ${esc(a.name)} on ${esc(p.name)}">
        ${face(ms, p.id + "|" + a.id)}<span class="lab">${esc(a.short)}</span><span class="t" data-t="${p.id}|${a.id}">${fmt(ms, on)}</span></button>`;
    }).join("");
    const tot = clockSum(0, mine);
    h += `<div class="row" style="--n:${ACTIVITIES.length}"><div class="pn">${name}</div>${clocks}
      <div class="tot">${face(tot, "tot|" + p.id)}<span class="lab">Total</span><span class="t" data-t="tot|${p.id}">${fmt(tot, anyOn)}</span></div></div>`;
  }
  $("#board").innerHTML = h;
  fillSelects(); renderReport(); renderLog(); renderSafe(); renderExtras();
  tick();
}
const PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`;
const setHTML = (el, h) => { if (el.innerHTML !== h) el.innerHTML = h; };
let lastReport = 0;
function tick() {
  const t = now(), iv = intervals(), b = bounds();
  if (t - beat > 30000) heartbeat();
  checkStillWorking(t);
  renderGap(t);
  const stat = (id, from) => {
    const w = worked(from, iv), c = clockSum(from, iv);
    $("#" + id).textContent = fmt(w);
    $("#" + id + "S").textContent = c - w > 60000 ? `${dec(w)} h · all clocks ${fmt(c)}` : `${dec(w)} h`;
  };
  stat("dDay", b.day); stat("dWeek", b.week); stat("dMonth", b.month);

  const bb = $("#breakBtn");
  if (S.breakStart) {
    bb.className = "break on"; bb.disabled = false;
    setHTML(bb, `<span class="bl">${PLAY}END BREAK</span><small>On break ${fmt(t - S.breakStart, true)} · ${S.paused.length} clock${S.paused.length === 1 ? "" : "s"} waiting</small>`);
  } else {
    bb.className = "break"; bb.disabled = !S.running.length;
    setHTML(bb, `<span class="bl">${PAUSE}BREAK</span><small>${S.running.length ? `Pause ${S.running.length} running clock${S.running.length === 1 ? "" : "s"}` : "Start a clock first"}</small>`);
  }
  const projOn = new Set();
  for (const r of S.running) {
    const key = r.projectId + "|" + r.activityId;
    const ms = clockSum(0, iv.filter(x => x.p === r.projectId && x.a === r.activityId));
    const el = document.querySelector(`[data-t="${key}"]`); if (el) el.textContent = fmt(ms, true);
    const hd = document.querySelector(`[data-hand="${key}"]`); if (hd) hd.style.transform = `rotate(${angle(ms)}deg)`;
    projOn.add(r.projectId);
  }
  for (const pid of projOn) {
    const ms = clockSum(0, iv.filter(x => x.p === pid));
    const el = document.querySelector(`[data-t="tot|${pid}"]`); if (el) el.textContent = fmt(ms, true);
    const hd = document.querySelector(`[data-hand="tot|${pid}"]`); if (hd) hd.style.transform = `rotate(${angle(ms)}deg)`;
  }
  // Keep the report's totals current while clocks run
  if (S.running.length && t - lastReport > 60000) renderReport();
  document.title = S.breakStart ? "On break · Index Time Tracker"
    : S.running.length ? `${fmt(worked(b.day, iv))} today · Index Time Tracker` : "Index Time Tracker";
  // A question waiting: blink the tab title, and ask again every few minutes
  if (!gap && asking) clearAlert();
  if (gap && Math.floor(t / 1000) % 2) document.title = gap.kind === "check" ? "🔔 Still working?" : "🔔 Check your time";
  if (gap && asking && t - askedAt >= NAG) notify(...asking);
  const nr = $("#navRun");
  nr.hidden = !S.running.length && !S.breakStart;
  nr.className = S.breakStart ? "run brk" : "run";
  nr.textContent = S.breakStart ? "On break" : fmt(worked(b.day, iv));
  renderMini(t, iv, b);
  badge(gap ? (Math.floor(t / 1000) % 2 ? S.running.length : 0) : S.breakStart ? "dot" : S.running.length);
}
// The installed app's taskbar icon: the number of running clocks, a dot on break, blinking while a question waits
let lastBadge = null;
function badge(b) {
  if (b === lastBadge || !navigator.setAppBadge) return;
  lastBadge = b;
  (b === "dot" ? navigator.setAppBadge() : b ? navigator.setAppBadge(b) : navigator.clearAppBadge()).catch(() => {});
}
setInterval(tick, 1000);

/* ---------- report period: Week / Month / Year / All / Custom, stepped with ‹ › ---------- */
const UNITK = KEY + ":unit", UNITS = ["week", "month", "year", "all", "custom"];
const per = {unit: UNITS.includes(lsGet(UNITK)) ? lsGet(UNITK) : "week", offset: 0};
function periodRange() {
  const d = new Date(), Y = d.getFullYear(), M = d.getMonth(), o = per.offset;
  const at = (y, m, dd) => new Date(y, m, dd).getTime();
  switch (per.unit) {
    case "month": return [at(Y, M + o, 1), at(Y, M + o + 1, 1)];
    case "year":  return [at(Y + o, 0, 1), at(Y + o + 1, 0, 1)];
    case "all":   return [0, Infinity];
    case "custom": {
      const f = parseDT($("#from").value, "00:00"), t = parseDT($("#to").value, "00:00");
      return [isNaN(f) ? 0 : f, isNaN(t) ? Infinity : new Date(t).setDate(new Date(t).getDate() + 1)];
    }
    default: { const mon = d.getDate() - (d.getDay() + 6) % 7 + 7 * o; return [at(Y, M, mon), at(Y, M, mon + 7)]; }
  }
}
// "Mon 21 – Sun 27 Sep", "September 2026", "2026"
function rangeText([a, b]) {
  if (per.unit === "all" || (a === 0 && b === Infinity)) return "All time";
  if (per.unit === "month") return `${MOL(a)} ${yr(a)}`;
  if (per.unit === "year") return String(yr(a));
  if (per.unit === "custom") return `${a ? dShort(a) : "The start"} – ${b === Infinity ? "today" : dShort(b - 1)}`;
  const e = b - 1;
  return withYear(`${WD(a)} ${dnum(a)}${MO(a) === MO(e) ? "" : " " + MO(a)} – ${WD(e)} ${dnum(e)} ${MO(e)}`, e);
}
function relText() {
  const names = {week: ["This week", "Last week"], month: ["This month", "Last month"], year: ["This year", "Last year"]}[per.unit];
  return names ? names[-per.offset] || "" : "";
}
// For the Excel file names: 2026-09-21 to 2026-09-27
function periodLabel([a, b]) {
  if (a === 0 && b === Infinity) return "All time";
  const last = b === Infinity ? "today" : dayKey(new Date(b).setDate(new Date(b).getDate() - 1));
  return `${a === 0 ? "the start" : dayKey(a)} to ${last}`;
}
// Mon–Fri days in the period, up to today
function workdays([a, b]) {
  if (!a) return 0;
  const end = Math.min(b, bounds().day + 86400000), d = new Date(a); let n = 0;
  while (d.getTime() < end) { const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

/* ---------- report ---------- */
// Hours per project and activity inside the period (time is split at the period's edges)
function grid([a, b]) {
  const iv = intervals(), rows = [];
  for (const p of S.projects) {
    const cells = ACTIVITIES.map(ac => clockSum(a, iv.filter(x => x.p === p.id && x.a === ac.id), b));
    const tot = cells.reduce((s, c) => s + c, 0);
    if (tot) rows.push({name: p.name, cells, tot});
  }
  return rows;
}
// What was worked on between s and e: each project and its activities, in the order they were started
function dayWhat(iv, s, e) {
  const what = new Map();
  for (const x of iv.filter(x => x.e > s && x.s < e).sort((x, y) => x.s - y.s)) {
    const name = (proj(x.p) || {}).name || "";
    if (!what.has(name)) what.set(name, []);
    if (!what.get(name).includes(x.a)) what.get(name).push(x.a);
  }
  return [...what].map(([name, acts]) => ({name, acts}));
}
// Every day of the period up to today, with the time actually worked (clocks running together count once).
// Days with no time stay in the list (ms 0), unless the period is too long to list every day.
function periodDays([a, b]) {
  const iv = intervals(), days = [], end = Math.min(b, bounds().day + 86400000);
  let start = a;
  if (!start) { if (!iv.length) return days; start = Math.min(...iv.map(x => x.s)); }
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const everyDay = (end - d.getTime()) / 86400000 <= 62;
  while (d.getTime() < end) {
    const s = Math.max(d.getTime(), a); d.setDate(d.getDate() + 1);
    const e = Math.min(d.getTime(), b), ms = worked(s, iv, e);
    if (ms || everyDay) days.push({day: s, ms, what: ms ? dayWhat(iv, s, e) : []});
  }
  return days;
}
// Only the days that have time, for the Worked hours tab
const workedDays = r => periodDays(r).filter(x => x.ms).map(x => ({day: x.day, w: x.ms, what: x.what}));
const TABK = KEY + ":tab";
const reportTab = () => ({project: "project", closed: "closed"})[lsGet(TABK)] || "worked";

const tag = id => `<span class="tag"><i class="dot" style="--c:${actColor(id)}"></i>${esc(actName(id))}</span>`;
const hrs = ms => `<td class="num hrs"><b>${dec(ms)}</b><span>${fmt(ms)}</span></td>`;
const kpi = (label, big, unit, extra) => `<div class="kpi"><span>${label}</span><b>${big}${unit ? `<small>${unit}</small>` : ""}</b>${extra ? `<em>${extra}</em>` : ""}</div>`;
// One bar per project, split by activity; its length is relative to the biggest project shown
function bar(parts, tot, max) {
  const used = parts.filter(x => x.ms);
  return `<div class="bar" style="width:${Math.max(3, tot / max * 100).toFixed(1)}%">${used.map(x => `<i style="--c:${actColor(x.id)};width:${(x.ms / tot * 100).toFixed(2)}%" title="${esc(actName(x.id))}: ${dec(x.ms)} h"></i>`).join("")}</div>
    <div class="split">${used.map(x => `<span><i class="dot" style="--c:${actColor(x.id)}"></i>${esc(actName(x.id))} ${dec(x.ms)}</span>`).join("")}</div>`;
}
const cellsToParts = cells => cells.map((ms, i) => ({id: ACTIVITIES[i].id, ms}));

function renderFilter(tab, r) {
  $("#filter").hidden = tab === "closed";
  const stepping = ["week", "month", "year"].includes(per.unit);
  $("#stepper").hidden = !stepping;
  $("#custom").hidden = per.unit !== "custom";
  const rel = relText();
  $("#rangeText").innerHTML = `${esc(rangeText(r))}${rel ? `<small>${rel}</small>` : ""}`;
  $("#next").disabled = per.offset >= 0;
  document.querySelectorAll("#unit [data-unit]").forEach(b => b.setAttribute("aria-pressed", b.dataset.unit === per.unit));
}
function renderReport() {
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
    const days = workedDays(r), w = days.reduce((s, x) => s + x.w, 0), wd = workdays(r);
    $("#summary").innerHTML = `
    <div class="kpis">
      ${kpi("Worked · billable", dec(w), "h", fmt(w))}
      ${kpi("Days worked", days.length, "", wd ? `of ${wd} workday${wd === 1 ? "" : "s"}` : "")}
      ${kpi("Average per day", dec(days.length ? w / days.length : 0), "h")}
    </div>
    <div class="tablewrap"><table class="rt">
      <thead><tr><th class="c-day">Day</th><th>Worked on</th><th class="num c-hrs">Hours</th></tr></thead>
      <tbody>${days.map(x => `<tr><td class="day"><b>${WD(x.day)} ${dnum(x.day)}</b><span>${withYear(MOL(x.day), x.day)}</span></td>
        <td><div class="proj">${x.what.map(p => `<strong>${esc(p.name)}</strong><div class="acts">${p.acts.map(tag).join("")}</div>`).join("")}</div></td>
        ${hrs(x.w)}</tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total worked</td>${hrs(w)}</tr></tfoot>
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
  <div class="legend">${ACTIVITIES.map(a => `<span class="tag"><i class="dot" style="--c:${actColor(a.id)}"></i>${esc(a.name)}</span>`).join("")}</div>
  <div class="tablewrap"><table class="rt">
    <thead><tr><th class="c-proj">Project</th><th>Where the time went</th><th class="num c-hrs">Hours</th></tr></thead>
    <tbody>${rows.map(x => `<tr class="prow"><td class="pname">${esc(x.name)}</td><td>${bar(cellsToParts(x.cells), x.tot, max)}</td>${hrs(x.tot)}</tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2">Total project time · ${rows.length} project${rows.length === 1 ? "" : "s"}</td>${hrs(all)}</tr></tfoot>
  </table></div>
  ${all - w > 60000 ? `<div class="info">${I.info}<div>Project time is <b>${dec(all - w)} h more</b> than the ${dec(w)} h you worked, because some clocks ran at the same time. Each book gets its full clock time.</div></div>` : ""}
  <p class="rnote">For billing each book.</p>`;
}
// Closed projects tab: every closed project, whatever dates are picked, newest first
const closedList = () => S.projects.filter(p => p.closed).sort((a, b) => b.closed - a.closed);
function renderClosed() {
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

/* ---------- time entries ---------- */
const opts = (list, sel) => list.map(x => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.name)}</option>`).join("");
const fields = e => `
  <label>Project<select name="p">${opts(S.projects.filter(p => !p.closed || p.id === e.projectId), e.projectId)}</select></label>
  <label>Activity<select name="a">${opts(ACTIVITIES, e.activityId)}</select></label>
  <label>Date<input type="date" name="d" value="${dayKey(e.start)}" required></label>
  <label>Start<input type="time" name="s" value="${hm(e.start)}" required></label>
  <label>End<input type="time" name="e" value="${hm(e.end)}" required></label>
  <label class="wide">Note<input name="note" value="${esc(e.note || "")}" placeholder="What did you do? e.g. ch. 52-54" maxlength="200" autocomplete="off"></label>`;
const entryRow = e => `<div class="erow" data-row="${e.id}">
  <span class="time">${hm(e.start)} – ${hm(e.end)}${dayKey(e.end) !== dayKey(e.start) ? ` <small>+1 day</small>` : ""}</span>
  <span class="p"><i class="dot" style="--c:${actColor(e.activityId)}"></i><span class="pt">${esc((proj(e.projectId) || {}).name)}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span></span>
  <span class="a">${esc(actName(e.activityId))}</span>
  <b class="h">${dec(e.end - e.start)}</b>
  <button type="button" class="btn icon edit" data-eedit="${e.id}" aria-label="Edit this entry" title="Edit">${I.pen}</button></div>`;
function renderLog() {
  if (entryEdit) return;   // don't wipe a half-finished edit
  const r = periodRange(), [a, b] = r;
  const list = S.entries.filter(e => e.end > a && e.start < b).sort((x, y) => y.start - x.start);
  $("#logCount").textContent = `${list.length} · ${rangeText(r)}`;
  if (!list.length) { $("#log").innerHTML = `<p class="empty">No time entries in this period.</p>`; return; }
  const groups = [];
  for (const e of list) {
    const k = dayKey(e.start), g = groups[groups.length - 1];
    if (g && g.k === k) g.items.push(e); else groups.push({k, day: e.start, items: [e]});
  }
  $("#log").innerHTML = groups.map(g => `<div class="dayhead">${dLong(g.day)}<span>${dec(worked(0, g.items.map(e => ({s: e.start, e: e.end}))))} h</span></div>${g.items.map(entryRow).join("")}`).join("");
}
function editEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  entryEdit = null; renderLog(); entryEdit = id; entryDel = null;
  const row = document.querySelector(`[data-row="${id}"]`);
  if (!row) return;
  row.outerHTML = `<form class="eform" data-entry="${id}">${fields(e)}
    <div class="fbtns"><button type="button" class="btn ghost danger" data-edel="${id}">Delete</button>
    <button type="button" class="btn ghost" data-ecancel="1">Cancel</button>
    <button class="btn primary" type="submit">Save</button></div></form>`;
  const first = document.querySelector(`[data-entry="${id}"] select`); if (first) first.focus();
}
// Read date/start/end from a form; an end earlier than the start means it ran past midnight
function readTimes(f) {
  const s = parseDT(f.elements.d.value, f.elements.s.value);
  let e = parseDT(f.elements.d.value, f.elements.e.value);
  if (isNaN(s) || isNaN(e)) { toast("Fill in the date, start and end"); return null; }
  if (e <= s) e = new Date(e).setDate(new Date(e).getDate() + 1);
  if (e > now() + 60000) { toast("That end time hasn't happened yet"); return null; }
  return [s, e];
}
function fillSelects() {
  const f = $("#addTime"), p = f.elements.p.value, a = f.elements.a.value;
  f.elements.p.innerHTML = opts(openProjects(), p);
  f.elements.a.innerHTML = opts(ACTIVITIES, a);
  $("#addToggle").disabled = !openProjects().length;
  $("#addToggle").title = openProjects().length ? "" : "Create a project first";
  if (!f.elements.d.value) f.elements.d.value = dayKey(now());
}
function showAdd(on) {
  $("#addTime").hidden = !on; $("#addToggle").hidden = on;
  if (on) { $("#addTime").elements.d.value = dayKey(now()); $("#addTime").elements.p.focus(); }
}

/* ---------- ⋯ menus (projects on the clock board, and closed projects) ---------- */
const CONFIRM_FOR = 10000;   // a "Click again to …" that isn't clicked within 10 seconds was an accident
let menu = null, menuTimer;
function openMenu(kind, id, anchor) {
  if (menu && menu.anchor === anchor) { closeMenu(); return; }
  menu = {kind, id, anchor, confirm: null};
  drawMenu();
  const first = $("#menu button"); if (first) first.focus();
}
function closeMenu() {
  if (!menu) return;
  clearTimeout(menuTimer); menu = null; $("#menu").hidden = true;
}
function drawMenu() {
  const el = $("#menu");
  const items = menu.kind === "project"
    ? [["rename", I.pen, "Rename"], ["close", I.done, menu.confirm === "close" ? "Click again to close" : "Close project"], ["delete", I.trash, menu.confirm === "delete" ? "Click again to delete" : "Delete project", "danger"]]
    : menu.kind === "export"
    ? [["xlsx", I.sheet, "Excel workbook"], ["pdf", I.pdf, "PDF"], ...(opt("invoices") ? [["invoice", I.receipt, per.unit === "week" ? `Invoice ${invoiceNumber(periodRange()[0])}` : "Invoice (pick Week first)"]] : [])]
    : [["copy", I.copy, "Copy summary"], ["reopen", I.undo, "Reopen project"]];
  el.innerHTML = (menu.kind === "export" ? `<h3>Report for ${esc(docPeriod(periodRange()))}</h3>` : "")
    + items.map(([act, icon, label, tone]) => `<button type="button" role="menuitem" data-act="${act}" class="${tone || ""}${menu.confirm === act ? " sure" : ""}">${icon}${label}</button>`).join("")
    + (menu.kind === "project" ? `<p>Closing copies a summary for Basecamp and keeps all the time.</p>`
      : menu.kind === "export" ? `<p>Excel and PDF: one file with worked hours, project time and time entries.${opt("invoices") ? " The invoice uses your worked hours and notes." : ""}</p>` : "");
  el.hidden = false;
  const r = menu.anchor.getBoundingClientRect(), w = el.offsetWidth;
  el.style.top = `${r.bottom + window.scrollY + 6}px`;
  // Buttons on the right half of the page get a menu that lines up with their right edge
  const x = r.left + r.width / 2 > document.documentElement.clientWidth / 2 ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(x + window.scrollX, document.documentElement.clientWidth - w - 8))}px`;
}
function menuAction(act) {
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
  else if (act === "close") closeProject(id);
  else if (act === "delete") deleteProject(id);
  else if (act === "copy") showSummary(proj(id), false);
  else if (act === "reopen") reopenProject(id);
  else if (act === "xlsx" || act === "pdf") exportReport(act);
  else if (act === "invoice") { if (per.unit === "week") openInvoice(); else toast("Invoices are weekly. Click Week above, then pick the week."); }
}

/* ---------- export / backup ---------- */
const BACKK = KEY + ":backup-at";
function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const download = (filename, text, type) => saveBlob(filename, new Blob([text], {type}));
// The period in words for the report files, always with the year: "Mon 14 – Sun 20 Sep 2026"
function docPeriod([a, b]) {
  if (per.unit === "all" || (a === 0 && b === Infinity)) return "All time";
  if (per.unit === "month") return `${MOL(a)} ${yr(a)}`;
  if (per.unit === "year") return String(yr(a));
  const e = b === Infinity ? now() : b - 1, full = t => `${WD(t)} ${dnum(t)} ${MO(t)} ${yr(t)}`;
  if (!a) return `Up to ${full(e)}`;
  if (yr(a) !== yr(e)) return `${full(a)} – ${full(e)}`;
  return `${WD(a)} ${dnum(a)}${MO(a) === MO(e) ? "" : " " + MO(a)} – ${WD(e)} ${dnum(e)} ${MO(e)} ${yr(e)}`;
}
// Activity colours for paper and Excel (the light-mode ones, whatever the screen is using)
const PRINT_COLORS = ["#3B6EA8", "#7657A8", "#2D8A6C", "#A87A1E", "#AE4A67", "#4F7F8C", "#8C5A3C"];
// Everything the report files need, worked out once for the chosen period
function reportData() {
  const r = periodRange(), [a, b] = r, t = now(), iv = intervals();
  return {
    periodText: docPeriod(r), generated: t, workdays: workdays(r),
    activities: ACTIVITIES.map((x, i) => ({id: x.id, name: x.name, color: PRINT_COLORS[i % 7]})),
    days: periodDays(r),
    projects: grid(r),
    workedMs: worked(a, iv, b),
    entries: S.entries.concat(S.running.map(x => ({...x, end: t}))).filter(e => e.end > a && e.start < b)
      .map(e => ({start: e.start, end: e.end, project: (proj(e.projectId) || {}).name || "", activity: e.activityId, note: e.note || ""}))
  };
}
// The Excel and PDF helpers are only loaded the first time you export (they are stored with the app, so this works offline)
const LIBS = {xlsx: ["lib/exceljs.min.js"], pdf: ["lib/jspdf.umd.min.js", "lib/jspdf.plugin.autotable.min.js"]};
const scripts = {};
function loadScript(src) {
  return scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = src;
    el.onload = res; el.onerror = () => { delete scripts[src]; el.remove(); rej(new Error("Couldn't load " + src)); };
    document.head.appendChild(el);
  }));
}
let exporting = false;
async function exportReport(kind) {
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
function backup() {
  download(`index-time-backup-${dayKey(now())}.json`, JSON.stringify(S, null, 2), "application/json");
  lsSet(BACKK, now()); renderSafe(); toast("Backup saved to your downloads");
}
function restore(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!valid(d)) throw 0;
      S = {...blank(), ...d}; editing = entryEdit = null; save(); render();
      toast(`Restored ${S.projects.length} project${S.projects.length === 1 ? "" : "s"}`);
    } catch { toast("That file isn't a tracker backup"); }
  };
  rd.readAsText(file);
}
// Combine another copy of the data into this one without losing anything from either
function mergeIn(d) {
  const idMap = {};
  for (const p of d.projects) {
    const match = S.projects.find(x => x.id === p.id) || S.projects.find(x => x.name.toLowerCase() === String(p.name).toLowerCase());
    if (match) idMap[p.id] = match.id; else S.projects.push(p);
  }
  const fix = x => ({...x, projectId: idMap[x.projectId] || x.projectId});
  const have = new Set(S.entries.map(e => e.id));
  S.entries.push(...d.entries.filter(e => !have.has(e.id)).map(fix));
  if (!S.invoice && d.invoice) S.invoice = d.invoice;
  if (!S.options && d.options) S.options = d.options;
  if (!S.running.length && !S.breakStart) {
    S.running = (d.running || []).map(fix); S.paused = (d.paused || []).map(fix); S.breakStart = d.breakStart || null;
  }
}

/* ---------- weekly invoice ---------- */
// Date = the Monday the week starts. Number = the following Monday as YYMMDD (week of 7 Sep 2026 → 260914).
const pad2 = n => String(n).padStart(2, "0");
function invoiceNumber(monday) { const d = new Date(monday); d.setDate(d.getDate() + 7); return `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
const usDate = t => { const d = new Date(t); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(2)}`; };
const round2 = n => Math.round(n * 100) / 100;
const invProfile = () => ({currency: "$", ...(S.invoice || {})});
const invReady = p => !!(p.name && p.billTo && +p.rate > 0);
// One line of description for a day: "Katzung Pharmacology: Flipping ch. 50-51, Detailing (MR). Stroke: Editing"
function describeDay(s, e) {
  const t = now(), projs = new Map();
  const list = S.entries.concat(S.running.map(r => ({...r, end: t}))).filter(x => x.end > s && x.start < e).sort((x, y) => x.start - y.start);
  for (const x of list) {
    const name = (proj(x.projectId) || {}).name || "";
    if (!projs.has(name)) projs.set(name, new Map());
    const acts = projs.get(name);
    if (!acts.has(x.activityId)) acts.set(x.activityId, []);
    const n = (x.note || "").trim();
    if (n && !acts.get(x.activityId).includes(n)) acts.get(x.activityId).push(n);
  }
  return [...projs].map(([name, acts]) => `${name}: ${[...acts].map(([id, notes]) => actName(id) + (notes.length ? " " + notes.join("; ") : "")).join(", ")}`).join(". ");
}
function invoiceData() {
  const r = periodRange(), p = invProfile(), rate = round2(+p.rate || 0);
  // Each day is rounded to 2 decimals, and the totals add up those rounded lines, so the maths on the page is exact
  const lines = periodDays(r).filter(x => x.ms).map(x => {
    const hours = round2(x.ms / 3600000);
    return {date: x.day, desc: describeDay(x.day, x.day + 86400000), hours, total: round2(hours * rate)};
  });
  return {number: invoiceNumber(r[0]), date: r[0], currency: p.currency || "$", rate, billTo: p.billTo || "",
    me: {name: p.name || "", logo: p.logo || "", payMethod: p.payMethod || "", payDetails: p.payDetails || "", phone: p.phone || "", email: p.email || ""},
    lines, totalHours: round2(lines.reduce((s, l) => s + l.hours, 0)), total: round2(lines.reduce((s, l) => s + l.total, 0))};
}
let invEditing = false, invLogo = null;
function openInvoice() { invEditing = !invReady(invProfile()); renderInvoice(); const d = $("#invDlg"); if (!d.open) d.showModal(); }
function renderInvoice() {
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
function readLogo(file) {
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
async function saveInvoicePDF() {
  try {
    for (const src of LIBS.pdf) await loadScript(src);
    const d = invoiceData();
    saveBlob(`invoice ${d.number}.pdf`, ReportFiles.buildInvoice(window.jspdf.jsPDF, d).output("blob"));
    toast(`Saved invoice ${d.number}.pdf to your downloads`);
  } catch (e) { console.error(e); toast("Couldn't make the invoice. Try again; if it keeps failing, reload the tracker."); }
}

/* ---------- auto-save file (Chrome and Edge) ---------- */
// The file's handle is remembered in IndexedDB so the tracker can find it again next time.
const canFile = "showSaveFilePicker" in window;
let fileH = null, fileOK = false, fileSaved = 0, fileTimer;
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open("itt-file", 1);
    o.onupgradeneeded = () => o.result.createObjectStore("h");
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const tx = o.result.transaction("h", mode), q = fn(tx.objectStore("h"));
      tx.oncomplete = () => res(q.result); tx.onerror = () => rej(tx.error);
    };
  });
}
function queueFile() { if (fileH && fileOK) { clearTimeout(fileTimer); fileTimer = setTimeout(writeFile, 800); } }
async function writeFile() {
  if (!fileH || !fileOK) return;
  try {
    // Chrome writes to a temporary copy and swaps it in on close, so a power cut can't leave a half-written file
    const w = await fileH.createWritable(); await w.write(JSON.stringify(S, null, 2)); await w.close();
    fileSaved = now();
  } catch {
    fileOK = await fileH.queryPermission({mode: "readwrite"}).then(p => p === "granted").catch(() => false);
    if (fileOK) toast("Couldn't update the auto-save file. Is it open in another program?");
  }
  renderSafe();
}
async function useFile(h, text) {
  try { const d = JSON.parse(text); if (valid(d)) mergeIn(d); } catch {}   // empty or new file: nothing to bring in
  fileH = h; fileOK = true;
  await idb("readwrite", s => s.put(h, "file")).catch(() => {});
  save(); render(); await writeFile();
  toast(`Auto-saving to ${h.name}`);
}
async function fileAction(kind) {
  try {
    if (kind === "new") {
      const h = await showSaveFilePicker({suggestedName: "time-tracker-data.json", types: [{description: "Time tracker data", accept: {"application/json": [".json"]}}]});
      await useFile(h, await (await h.getFile()).text().catch(() => ""));
    } else if (kind === "open") {
      const [h] = await showOpenFilePicker({types: [{description: "Time tracker data", accept: {"application/json": [".json"]}}]});
      const text = await (await h.getFile()).text();
      try { if (!valid(JSON.parse(text))) throw 0; } catch { toast("That file isn't tracker data"); return; }
      if (await h.requestPermission({mode: "readwrite"}) !== "granted") { toast("The tracker needs permission to save to that file"); return; }
      await useFile(h, text);
    } else if (kind === "allow") {
      fileOK = await fileH.requestPermission({mode: "readwrite"}) === "granted";
      renderSafe(); if (fileOK) writeFile();
    } else if (kind === "stop") {
      await idb("readwrite", s => s.delete("file")).catch(() => {});
      fileH = null; fileOK = false; renderSafe(); toast("Auto-save file disconnected. The file itself is still there.");
    }
  } catch (e) { if (e && e.name !== "AbortError") toast("Something went wrong with the file. Try again."); }
}
async function reconnectFile() {
  if (!canFile) return;
  fileH = await idb("readonly", s => s.get("file")).catch(() => null) || null;
  if (fileH) fileOK = await fileH.queryPermission({mode: "readwrite"}).then(p => p === "granted").catch(() => false);
  renderSafe(); if (fileOK) writeFile();
}

/* ---------- mini tracker: a small window that stays on top of other windows (Chrome and Edge) ---------- */
// It lives only while the main window is open (minimised is fine). It uses the main window's code and styles.
const canMini = "documentPictureInPicture" in window;
let mini = null;
const STOP = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
async function toggleMini() {
  if (mini) { mini.close(); return; }
  try { mini = await documentPictureInPicture.requestWindow({width: 300, height: 330}); }
  catch { toast("The mini tracker couldn't open"); return; }
  const d = mini.document;
  for (const n of document.querySelectorAll('link[rel="stylesheet"]')) { const l = d.createElement("link"); l.rel = "stylesheet"; l.href = n.href; d.head.appendChild(l); }
  d.title = "Time Tracker";
  d.body.className = "mini";
  d.body.innerHTML = `<div id="m"></div>`;
  d.addEventListener("click", miniClick);
  d.addEventListener("pointerdown", unlockSound, true);
  mini.addEventListener("pagehide", () => { mini = null; renderMiniBtn(); });
  mini.setInterval(tick, 1000);   // its own timer keeps it ticking while the main window is minimised
  renderMiniBtn(); tick();
}
function renderMiniBtn() {
  const b = $("#miniBtn");
  b.hidden = !canMini;
  b.setAttribute("aria-pressed", !!mini);
  b.querySelector("span").textContent = mini ? "Close mini tracker" : "Mini tracker";
}
function renderMini(t, iv, b) {
  if (!mini) return;
  const d = mini.document, box = d.getElementById("m"); if (!box) return;
  const row = (pid, aid, cls) => {
    const p = proj(pid), i = ACTIVITIES.findIndex(a => a.id === aid);
    if (!p || i < 0) return "";
    return `<button type="button" class="mrow${cls}" style="--c:var(--a${i % 7})" data-m="clock|${pid}|${aid}" ${S.breakStart ? "disabled" : ""}>
      <span class="dot"></span><span class="mn"><b>${esc(p.name)}</b><small>${esc(ACTIVITIES[i].name)}${cls === " paused" ? " · waiting" : ""}</small></span>
      <span class="mt" data-mt="${pid}|${aid}"></span><span class="mi">${cls === " on" ? STOP : cls === " paused" ? PAUSE : PLAY}</span></button>`;
  };
  // Up to 3 clocks used most recently, so you can start one without the main window
  const last = new Map();
  for (const e of S.entries) { const k = e.projectId + "|" + e.activityId; if (!(last.get(k) > e.end)) last.set(k, e.end); }
  const busy = k => S.running.concat(S.paused).some(r => r.projectId + "|" + r.activityId === k);
  const recent = [...last].filter(([k]) => { const p = proj(k.split("|")[0]); return p && !p.closed && !busy(k); })
    .sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => k.split("|"));
  const now_ = [...S.running.map(r => row(r.projectId, r.activityId, " on")), ...S.paused.map(r => row(r.projectId, r.activityId, " paused"))].join("");
  const ask = gap ? `<div class="banner"><p data-mg></p><button class="btn" type="button" data-m="keep">${esc($("#gapKeep").textContent)}</button>${gap.kind === "away" ? `<button class="btn" type="button" data-m="take">${esc($("#gapTake").textContent)}</button>` : ""}<button class="btn ghost" type="button" data-m="stop">${esc($("#gapStop").textContent)}</button></div>` : "";
  const brk = S.breakStart ? `<button type="button" class="break on" data-m="break">${PLAY}END BREAK</button>`
    : `<button type="button" class="break" data-m="break" ${S.running.length ? "" : "disabled"}>${PAUSE}BREAK</button>`;
  setHTML(box, `${ask}<div class="mtop"><div class="mtot"><span>Today</span><b data-mtot></b></div>${brk}</div>
    <div class="mlist">${now_}${recent.length ? `${now_ ? `<div class="mhead">Recent</div>` : ""}${recent.map(([p, a]) => row(p, a, "")).join("")}` : ""}
    ${!now_ && !recent.length ? `<p class="mempty">Start a clock in the main window. Clocks you use show up here.</p>` : ""}</div>`);
  const mg = d.querySelector("[data-mg]"); if (mg) mg.textContent = $("#gapText").textContent;
  d.querySelector("[data-mtot]").textContent = fmt(worked(b.day, iv));
  for (const el of d.querySelectorAll("[data-mt]")) {
    const [p, a] = el.dataset.mt.split("|"), on = S.running.some(x => same(x, p, a));
    el.textContent = fmt(clockSum(0, iv.filter(x => x.p === p && x.a === a)), on);
  }
}
function miniClick(e) {
  const el = e.target.closest("[data-m]"); if (!el || el.disabled) return;
  const [k, p, a] = el.dataset.m.split("|");
  if (k === "clock") toggleClock(p, a);
  else if (k === "break") toggleBreak();
  else if (k === "keep" && gap) keepGap();
  else if (k === "take" && gap && gap.kind === "away") takeOutAway();
  else if (k === "stop" && gap) stopAtGap();
}

/* ---------- "Keep your time safe" card ---------- */
// A checklist while anything is left to set up; one calm line once everything is on.
let safeOpen = false;
function renderSafe() {
  const el = $("#safe"); if (!el) return;
  if (el.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;   // don't close an open dropdown
  const every = checkEvery(), backedUp = +lsGet(BACKK) || 0;
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
function safeAction(a) {
  if (a === "open") { safeOpen = true; renderSafe(); }
  else if (a === "close") { safeOpen = false; renderSafe(); }
  else if (a.startsWith("file-")) fileAction(a.slice(5));
  else if (a === "away-on") turnOnReminders();
  else if (a === "away-off") stopAway();
  else if (a === "pop-on") turnOnPopups();
  else if (a === "pop-test") testAlert();
  else if (a === "sound") { lsSet(SOUNDK, soundOn() ? "0" : null); renderSafe(); if (soundOn()) testAlert(); else toast("Sound is off"); }
  else if (a === "backup") backup();
}

/* ---------- events ---------- */
let tt;
function toast(m) { const el = $("#toast"); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3500); }

$("#board").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.clock) { const [p, a] = d.clock.split("|"); toggleClock(p, a); }
  else if (d.menu) { const [k, id] = d.menu.split("|"); openMenu(k, id, b); }
  else if (d.edit) startRename(d.edit);
  else if (d.cancel) { editing = null; render(); }
});
$("#board").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, p = proj(f.dataset.rename), n = f.elements.n.value.trim();
  if (p && n) { p.name = n; save(); }
  editing = null; render();
});
function showAddProject(on) {
  $("#addForm").hidden = !on; $("#addOpen").hidden = on;
  if (on) $("#newName").focus(); else $("#newName").value = "";
}
$("#addOpen").addEventListener("click", () => showAddProject(true));
$("#addClose").addEventListener("click", () => showAddProject(false));
$("#newName").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); showAddProject(false); } });
$("#addForm").addEventListener("submit", e => {
  e.preventDefault();
  if (addProject($("#newName").value)) showAddProject(false); else $("#newName").focus();
});

// Views: Clocks, Reports, Settings. The tracker always opens on Clocks.
function setView(v) {
  document.querySelectorAll(".views [data-view]").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  document.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== v; });
  closeMenu(); window.scrollTo(0, 0);
}
$(".views").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
$("#miniBtn").addEventListener("click", toggleMini);
document.addEventListener("pointerdown", unlockSound, true);
document.addEventListener("keydown", unlockSound, true);
$("#breakBtn").addEventListener("click", toggleBreak);
$("#gapKeep").addEventListener("click", () => { if (gap) keepGap(); });
$("#gapTake").addEventListener("click", () => { if (gap && gap.kind === "away") takeOutAway(); });
$("#gapStop").addEventListener("click", () => { if (gap) stopAtGap(); });

// Report
$(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { lsSet(TABK, b.dataset.tab); renderReport(); } });
$("#unit").addEventListener("click", e => {
  const b = e.target.closest("[data-unit]"); if (!b) return;
  per.unit = b.dataset.unit; per.offset = 0; lsSet(UNITK, per.unit);
  entryEdit = null; renderReport(); renderLog();
  if (per.unit === "custom" && !$("#from").value) $("#from").focus();
});
$("#prev").addEventListener("click", () => { per.offset--; entryEdit = null; renderReport(); renderLog(); });
$("#next").addEventListener("click", () => { if (per.offset < 0) { per.offset++; entryEdit = null; renderReport(); renderLog(); } });
["#from", "#to"].forEach(s => $(s).addEventListener("change", () => { entryEdit = null; renderReport(); renderLog(); }));
$("#exportBtn").addEventListener("click", e => openMenu("export", null, e.currentTarget));
$("#summary").addEventListener("click", e => { const b = e.target.closest("[data-menu]"); if (b) { const [k, id] = b.dataset.menu.split("|"); openMenu(k, id, b); } });

// ⋯ menu
$("#menu").addEventListener("click", e => {
  e.stopPropagation();   // the menu redraws itself, so the "clicked outside" check below must not see this click
  const b = e.target.closest("[data-act]"); if (b && menu) menuAction(b.dataset.act);
});
document.addEventListener("click", e => { if (menu && !e.target.closest("#menu") && !e.target.closest("[data-menu]")) closeMenu(); });
window.addEventListener("resize", closeMenu);

// Summary pop-up
$("#closedCopy").addEventListener("click", async () => {
  const ok = await copyText($("#closedText").textContent);
  $("#closedMsg").innerHTML = ok ? `✓ Copied again. <b>Remember to post your time on Basecamp.</b>` : `Couldn't copy. Select the text above and press Ctrl+C.`;
});
$("#closedDone").addEventListener("click", () => $("#closedDlg").close());

// Time entries
$("#addToggle").addEventListener("click", () => showAdd(true));
$("#addCancel").addEventListener("click", () => showAdd(false));
$("#log").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.eedit) editEntry(d.eedit);
  else if (d.ecancel) { entryEdit = null; renderLog(); }
  else if (d.edel) {
    if (entryDel !== d.edel) {
      const id = entryDel = d.edel; b.textContent = "Click again to delete"; b.classList.add("sure");
      setTimeout(() => { if (entryDel === id) { entryDel = null; if (b.isConnected) { b.textContent = "Delete"; b.classList.remove("sure"); } } }, CONFIRM_FOR);
      return;
    }
    S.entries = S.entries.filter(x => x.id !== d.edel); entryEdit = entryDel = null;
    save(); render(); toast("Time entry deleted");
  }
});
$("#log").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, x = S.entries.find(y => y.id === f.dataset.entry), t = readTimes(f);
  if (!x || !t) return;
  Object.assign(x, {projectId: f.elements.p.value, activityId: f.elements.a.value, start: t[0], end: t[1]});
  const note = f.elements.note.value.trim(); if (note) x.note = note; else delete x.note;
  entryEdit = null; save(); render(); toast("Time entry updated");
});
$("#addTime").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, t = readTimes(f);
  if (!t || !proj(f.elements.p.value)) return;
  const note = f.elements.note.value.trim();
  S.entries.push({id: uid(), projectId: f.elements.p.value, activityId: f.elements.a.value, start: t[0], end: t[1], ...(note ? {note} : {})});
  f.elements.s.value = f.elements.e.value = f.elements.note.value = "";
  showAdd(false);
  save(); render(); toast(`Added ${fmt(t[1] - t[0])} to ${proj(f.elements.p.value).name}`);
});

// Note bar
$("#noteBar").addEventListener("submit", e => { e.preventDefault(); commitNote(); });
$("#noteSkip").addEventListener("click", hideNote);

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

// Keep your time safe
$("#extras").addEventListener("change", e => { if (e.target.dataset.opt) setOpt(e.target.dataset.opt, e.target.checked); });
$("#safe").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) safeAction(b.dataset.s); });
$("#safe").addEventListener("change", e => {
  if (e.target.id !== "checkEvery") return;
  lsSet(EVERYK, e.target.value); lsSet(CHECKK, now());
  e.target.blur(); renderSafe();
});
$("#restoreFile").addEventListener("change", e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; });

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#noteBar").hidden) { hideNote(); return; }
  if (menu) { const a = menu.anchor; closeMenu(); if (a && a.isConnected) a.focus(); return; }
  if (editing) { editing = null; render(); }
  if (entryEdit) { entryEdit = null; renderLog(); }
  if (!$("#addTime").hidden) showAdd(false);
});

/* ---------- start ---------- */
load(); heartbeat(); render(); renderMiniBtn(); reconnectFile(); resumeAway();
// Right-click menu on the taskbar icon (manifest "shortcuts") opens ?do=break or ?do=stop
function runShortcut(url) {
  const a = new URL(url).searchParams.get("do");
  if (a === "break") { if (S.breakStart || S.running.length) toggleBreak(); else toast("Start a clock first"); }
  else if (a === "stop") stopAll();
}
if ("launchQueue" in window) launchQueue.setConsumer(p => { if (p.targetURL) runShortcut(p.targetURL); });
else runShortcut(location.href);
if (location.search) history.replaceState(null, "", location.pathname);
// Ask the browser not to clear this site's storage when the disk gets full
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
