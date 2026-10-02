/* Per-browser settings and reminders (not part of the tracker data, not in backups): one table, one place.
   Each is stored under "index-time-tracker:v1:<name>" in exactly the format the tracker has always used,
   so existing settings carry over. Works in the browser and in Node (for tests). */
const HOUR = 3600000;
// Kinds of value: how to read the stored text, and how to write a value back (null = remove the key)
const num = def => ({get: v => v == null ? def : (+v || 0), set: x => x == null ? null : String(+x)});
const flag = () => ({get: v => v != null, set: x => x ? "1" : null});                        // present = on
const oneOf = (list, def) => ({get: v => list.includes(v) ? v : def, set: x => x && x !== def && list.includes(x) ? x : null});
const json = (ok, def) => ({get: v => { try { const x = JSON.parse(v); return ok(x) ? x : def; } catch { return def; } }, set: x => x == null ? null : JSON.stringify(x)});

const PREFS = {
  // clock-out safety
  "seen":        num(0),            // last moment the tracker was open and awake (heartbeat)
  "away":        num(0),            // when you went idle with a clock running (0 = not away)
  "checked":     num(0),            // last "Still working?" answer
  "check-every": num(2 * HOUR),     // how often to ask "Still working?" (0 = never)
  "away-on":     flag(),            // away detection switched on
  "sound":       {get: v => v !== "0", set: x => x ? null : "0"},   // chime on unless "0"
  "plan-told":   num(0),            // end time of the last planned block asked about
  "break-ask":   num(0),            // when to ask "Still on break?" next (0 = 5 min after the break started)
  "break-snooze": {get: v => [5, 10, 20, 30].includes(+v) ? +v : 5, set: x => x && +x !== 5 ? String(+x) : null},   // last "ask again in" choice (minutes)
  // quiet books ("no time for a week, close it?")
  "quiet-asked": num(0),            // start of the day the question was last finished or put off ("Not now")
  "quiet-keep":  json(x => x && typeof x === "object" && !Array.isArray(x), {}),   // {projectId: don't ask before}
  // reports
  "unit":        oneOf(["week", "month", "year", "all", "custom"], "week"),
  "tab":         oneOf(["worked", "project", "closed"], "worked"),
  "backup-at":   num(0),            // last backup saved
  // schedule
  "sched-hours": json(r => r && r.to > r.from, {from: 6, to: 22}),
  "sched-copy":  oneOf(["full", "short"], "full"),
  // appearance ("" = follow the computer). index.html's <head> also reads this key, before the page draws.
  "theme":       oneOf(["", "light", "dark"], "")
};

function create(storage, prefix) {
  const key = name => { if (!PREFS[name]) throw new Error("unknown setting: " + name); return prefix + ":" + name; };
  return {
    get(name) { let v = null; try { v = storage.getItem(key(name)); } catch {} return PREFS[name].get(v); },
    set(name, x) {
      const v = PREFS[name].set(x), k = key(name);
      try { v == null ? storage.removeItem(k) : storage.setItem(k, v); } catch {}
    },
    names: Object.keys(PREFS)
  };
}
export {create, PREFS};
