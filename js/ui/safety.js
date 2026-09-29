/* Clock-out safety: the tracker-closed, away, "Still working?", plan-end and "Still on break?" questions, the banner,
   the chime and pop-ups, away detection, and the blinking tab title. */
import {fmt, when, worked} from "../core/time.js";
import {breakAskDue, nextAsk} from "../domain/breaks.js";
import {P, S, commit} from "../data/store.js";
import {tick} from "../main.js";
import {record, toggleBreak} from "./clocks.js";
import {$, now, toast} from "./dom.js";
import {renderSafe} from "./settings.js";

export const GAP = 10 * 60000;                // a longer silence than this with clocks running gets a question
/* ---------- making sure clocks don't run on by mistake ---------- */
export let gap = null;   // the question on screen, or null (kinds below)
export function setGap(g) { gap = g; }
// gap = {kind: "closed", from}          tracker was closed, or the computer asleep or off
//       {kind: "away", from, until}     computer on, but no mouse or keyboard use (Chrome/Edge)
//       {kind: "check", from, at}       a clock has run a long time without a "still working?" answer
//       {kind: "plan", from, at}        a planned block (Schedule) ended at `from` with a clock still running
//       {kind: "break", from, at, back?} still on break? (from = when the break started; back = when you came back, if seen)
export const AWAY = 5 * 60000;                // no mouse or keyboard for this long counts as away
export let beat = 0;
export function heartbeat() {
  const t = now(), last = P.get("seen"), away = P.get("away");
  if (!gap && S.running.length && last && t - last > GAP) gap = {kind: "closed", from: away && away < last ? away : last};
  P.set("seen", t);
  beat = t;
}
export function settle() { gap = null; P.set("away", null); P.set("checked", now()); clearAlert(); }
export function keepGap() { settle(); tick(); }
export function stopAtGap() {
  const at = gap.kind === "check" ? gap.at : gap.kind === "plan" ? now() : gap.from;   // plan: you may have kept working past it
  S.running.forEach(r => record(r, Math.max(r.start, at)));
  S.running = []; settle();
  commit(); toast(`Clocks stopped at ${when(at)}`);
}
export function takeOutAway() {   // count up to when you left, then carry on from when you came back
  const {from, until} = gap;
  S.running.forEach(r => record(r, Math.max(r.start, from)));
  S.running = S.running.map(r => ({...r, start: Math.max(r.start, until)}));
  settle(); commit(); toast(`Took out ${fmt(until - from)} away`);
}
// Asking out loud: a chime, a Windows pop-up that stays until clicked, and a blinking tab title.
// Repeats every few minutes until the question is answered, so it's hard to miss.
export const NAG = 5 * 60000;
export const canPop = "Notification" in window;
export const soundOn = () => P.get("sound");
export let actx = null, popup = null, asking = null, askedAt = 0;
export function unlockSound() {   // browsers allow sound only after a click on the page, so get it ready on the first one
  try { if (!actx) actx = new AudioContext(); if (actx.state === "suspended") actx.resume(); } catch {}
}
export function chime() {   // a soft two-note "ding-dong"; returns true if it played
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
export function popUp(title, body, rang) {   // rang: our chime played, so Windows needn't add its own sound
  if (!canPop || Notification.permission !== "granted") return;
  try {
    if (popup) popup.close();
    popup = new Notification(title, {body, icon: "icon.svg", tag: "itt", renotify: true, requireInteraction: true, silent: rang || !soundOn()});
    popup.onclick = () => { window.focus(); if (popup) popup.close(); };
  } catch {}
}
export function notify(title, body) {
  asking = [title, body]; askedAt = now();
  const rang = chime();
  if (!document.hasFocus() || document.hidden) popUp(title, body, rang);   // no pop-up if you're already looking at the tracker
}
export function clearAlert() { asking = null; if (popup) { popup.close(); popup = null; } }
export async function turnOnPopups() {
  unlockSound();
  const p = canPop ? await Notification.requestPermission().catch(() => "denied") : "denied";
  renderSafe();
  if (p !== "granted") { toast("Pop-ups need your OK. Click the lock icon by the address bar and allow notifications."); return; }
  testAlert();
}
export function testAlert() {
  unlockSound();
  setTimeout(() => popUp("Index Time Tracker", "This is how the tracker will ask if you're still working.", chime()), 150);
  toast(soundOn() ? "You should hear a chime and see a pop-up" : "You should see a pop-up (sound is off)");
}
export const checkEvery = () => P.get("check-every");
export function checkStillWorking(t) {
  const every = checkEvery();
  if (!every || gap || !S.running.length) return;
  const base = Math.max(P.get("checked"), ...S.running.map(r => r.start));
  if (t - base < every) return;
  gap = {kind: "check", from: base, at: t};
  notify("Still working?", `Your clock has been running for ${fmt(t - base)}. Open the tracker to answer.`);
}
// "Still on break?": 5 minutes into a break, then when you choose ("ask again in 5/10/20/30 min"), and at once when
// you come back to the computer. Never while you're away (see breakAskDue in domain/breaks.js).
export function askBreak(t, back) {
  gap = {kind: "break", from: S.breakStart, at: t, ...(back ? {back} : {})};
  notify("Still on break?", back ? `Welcome back. You're still on break (${fmt(t - S.breakStart)}). Open the tracker to end it.`
    : `You've been on break for ${fmt(t - S.breakStart)}. Open the tracker to end it.`);
}
export function checkBreak(t) {
  if (gap || !breakAskDue({breakStart: S.breakStart, next: P.get("break-ask"), idle: idleNow, now: t})) return;
  askBreak(t, 0);
}
export function endBreakAt(at) { settle(); toggleBreak(at); }   // the break's clocks restart from `at`
export function snoozeBreak(minutes) {
  settle();
  P.set("break-snooze", minutes); P.set("break-ask", nextAsk(now(), minutes));
  toast(`OK, I'll ask again in ${minutes} minutes`); tick();
}
// Away detection uses Chrome and Edge's idle detector, which sees mouse and keyboard use anywhere on the computer
export let awayOn = false, idleCtl = null;
export const canAway = "IdleDetector" in window;
export async function startAway() {
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
export function stopAway() {
  if (idleCtl) idleCtl.abort();
  idleCtl = null; awayOn = false; P.set("away-on", false); P.set("away", null);
  renderSafe(); toast("Away detection is off");
}
export let idleNow = false;   // the idle detector says nobody is using the computer
export function onIdle(state) {
  const t = now();
  idleNow = state === "idle";
  if (idleNow) { if ((S.running.length || S.breakStart) && !P.get("away")) P.set("away", t - AWAY); return; }
  const from = P.get("away");
  P.set("away", null);
  if (S.breakStart) { if (from && (!gap || gap.kind === "break")) { askBreak(t, t); tick(); } return; }
  if (!from || !S.running.length || (gap && gap.kind !== "check" && gap.kind !== "plan")) return;
  gap = {kind: "away", from, until: t};
  notify("Welcome back", `You were away for ${fmt(t - from)} with a clock running. Open the tracker to keep or take out that time.`);
  tick();
}
export async function turnOnReminders() {
  const [idle] = await Promise.all([
    IdleDetector.requestPermission().catch(() => "denied"),
    "Notification" in window ? Notification.requestPermission().catch(() => "denied") : "denied"
  ]);
  if (idle !== "granted") { toast("Away detection needs your OK. Click the lock icon by the address bar to allow it."); return; }
  P.set("away-on", true); await startAway();
  if (awayOn) toast("Away detection is on");
}
export async function resumeAway() {
  if (!canAway || !P.get("away-on")) { renderSafe(); return; }
  const st = await navigator.permissions.query({name: "idle-detection"}).then(p => p.state).catch(() => "prompt");
  if (st === "granted") await startAway(); else renderSafe();
}
export function renderGap(t) {
  if (gap && (gap.kind === "break" ? !S.breakStart : !S.running.length)) gap = null;   // answered some other way
  $("#gap").hidden = !gap;
  if (!gap) return;
  const f = when(gap.from), brk = gap.kind === "break";
  const lateBack = brk && gap.back && t - gap.back > 2 * 60000;   // noticed late: offer to restart from when you came back
  $("#gapTake").hidden = !(gap.kind === "away" || lateBack);
  $("#gapStop").hidden = brk;
  $("#gapSnooze").hidden = !brk;
  $("#gapKeep").textContent = gap.kind === "check" ? "Yes, still working" : gap.kind === "plan" ? "Keep working" : brk ? "End break" : "Keep the time";
  if (brk) {
    $("#gapText").textContent = gap.back ? `Welcome back — you're still on break (${fmt(t - gap.from)}). Back to work?`
      : `You've been on break for ${fmt(t - gap.from)}. Back to work?`;
    if (lateBack) $("#gapTake").textContent = `End at ${when(gap.back)}, when I came back`;
    const last = P.get("break-snooze");
    document.querySelectorAll("#gapSnooze [data-snooze]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.snooze === last));
  } else if (gap.kind === "closed") {
    $("#gapText").textContent = `Your clocks kept running while the tracker was closed or the computer was asleep or off — from ${f} until now (${fmt(t - gap.from)}).`;
    $("#gapStop").textContent = `Stop them at ${f}`;
  } else if (gap.kind === "away") {
    $("#gapText").textContent = `You were away from the computer from ${f} until ${when(gap.until)} (${fmt(gap.until - gap.from)}) with a clock running.`;
    $("#gapTake").textContent = `Take out the ${fmt(gap.until - gap.from)} away`;
    $("#gapStop").textContent = `Stop them at ${f}`;
  } else if (gap.kind === "plan") {
    $("#gapText").textContent = `Your planned time ended at ${f}, and a clock is still running.`;
    $("#gapStop").textContent = "Stop clocks now";
  } else {
    $("#gapText").textContent = `Still working? Your clock has been running since ${f} (${fmt(gap.at - gap.from)}).`;
    $("#gapStop").textContent = `No — stop them at ${when(gap.at)}`;
  }
}
export function tickSafety(t) { if (t - beat > 30000) heartbeat(); checkStillWorking(t); checkBreak(t); }
// The tab title: today's hours or "On break"; blinking, and asking again every few minutes, while a question waits
export function tickTitle(t, iv, b) {
  document.title = S.breakStart ? "On break · Index Time Tracker"
    : S.running.length ? `${fmt(worked(b.day, iv))} today · Index Time Tracker` : "Index Time Tracker";
  // A question waiting: blink the tab title, and ask again every few minutes
  if (!gap && asking) clearAlert();
  if (gap && Math.floor(t / 1000) % 2) document.title = gap.kind === "check" ? "🔔 Still working?" : gap.kind === "break" ? "🔔 Still on break?" : "🔔 Check your time";
  if (gap && asking && t - askedAt >= NAG && !(gap.kind === "break" && idleNow)) notify(...asking);   // a break question waits while you're away
}

// Events for this area (called once at start-up by js/main.js)
export function initSafety() {
document.addEventListener("pointerdown", unlockSound, true);
document.addEventListener("keydown", unlockSound, true);
$("#gapKeep").addEventListener("click", () => { if (!gap) return; if (gap.kind === "break") endBreakAt(now()); else keepGap(); });
$("#gapTake").addEventListener("click", () => { if (gap && gap.kind === "away") takeOutAway(); else if (gap && gap.kind === "break" && gap.back) endBreakAt(gap.back); });
$("#gapSnooze").addEventListener("click", e => { const b = e.target.closest("[data-snooze]"); if (b && gap && gap.kind === "break") snoozeBreak(+b.dataset.snooze); });
$("#gapStop").addEventListener("click", () => { if (gap) stopAtGap(); });
}
