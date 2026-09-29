/* The shape of the tracker's data (docs/DATA.md), its version, the upgrades between versions, and a check
   that cleans up damaged data without losing good rows. Pure: no page, no storage. Works in the browser
   and in Node, so it can be unit-tested. */
const CURRENT_VERSION = 2;
const blank = () => ({version: CURRENT_VERSION, projects: [], entries: [], running: [], paused: [], breakStart: null, schedule: {}, options: {}});

// Upgrades, one step per version. Each takes data at version n and returns it at n + 1.
// Add a step here whenever the shape changes, and never edit an old one.
const MIGRATIONS = {
  // 1 → 2: the schedule and the options switches became standard parts of the data
  1: d => ({...d, schedule: d.schedule && typeof d.schedule === "object" ? d.schedule : {}, options: d.options && typeof d.options === "object" ? d.options : {}, version: 2})
};
function migrate(d, problems = []) {
  let v = Number.isInteger(d.version) && d.version > 0 ? d.version : 1;
  if (v > CURRENT_VERSION) problems.push(`made by a newer version of the tracker (data version ${v}); some parts may be ignored`);
  while (v < CURRENT_VERSION) { d = MIGRATIONS[v](d); v = d.version; }
  return d;
}

const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = x => typeof x === "string" && x.length > 0;
const isTime = x => typeof x === "number" && isFinite(x) && x > 0;
const WEEK = /^\d{4}-\d{2}-\d{2}$/, SLOT = /^([0-6])-(\d{1,4})$/;
let seq = 0;
const newId = () => "fix" + Date.now().toString(36) + (seq++).toString(36);

// Is this tracker data at all? (A backup, the auto-save file, or what the browser has stored.)
const looksLikeData = d => isObj(d) && Array.isArray(d.projects) && Array.isArray(d.entries);

// Clean and upgrade data. Returns {data, problems}: problems are plain sentences, one per kind of fix,
// and `skipped` counts the rows that had to be left out. Unknown fields are kept, so newer data isn't damaged.
// Throws only if it isn't tracker data at all.
function validate(raw) {
  if (!looksLikeData(raw)) throw new Error("not tracker data");
  const problems = [], count = {};
  const note = (k, n = 1) => { count[k] = (count[k] || 0) + n; };
  let d = migrate({...raw}, problems);

  const ids = new Set();
  const projects = d.projects.filter(p => {
    if (!isObj(p) || !isStr(p.id) || typeof p.name !== "string" || ids.has(p.id)) { note("project"); return false; }
    ids.add(p.id); return true;
  }).map(p => {
    const q = {...p};
    if (q.created != null && !isTime(q.created)) delete q.created;
    if (q.closed != null && !isTime(q.closed)) delete q.closed;
    if (q.extras != null && !Array.isArray(q.extras)) delete q.extras;
    return q;
  });

  const eids = new Set();
  const entries = [];
  for (const e of d.entries) {
    if (!isObj(e) || !isStr(e.projectId) || !isStr(e.activityId) || !isTime(e.start) || !isTime(e.end) || e.start === e.end) { note("entry"); continue; }
    const x = {...e};
    if (x.end < x.start) { [x.start, x.end] = [x.end, x.start]; note("swapped"); }
    if (!isStr(x.id) || eids.has(x.id)) x.id = newId();
    if (x.note != null && typeof x.note !== "string") delete x.note;
    eids.add(x.id); entries.push(x);
  }
  const clock = r => isObj(r) && isStr(r.projectId) && isStr(r.activityId);
  const keep = (list, test) => (Array.isArray(list) ? list : []).filter(r => { if (test(r)) return true; note("clock"); return false; });
  const running = keep(d.running, r => clock(r) && isTime(r.start));
  const paused = keep(d.paused, clock);
  const breakStart = isTime(d.breakStart) ? d.breakStart : null;

  const schedule = {};
  for (const [w, slots] of Object.entries(isObj(d.schedule) ? d.schedule : {})) {
    if (!WEEK.test(w) || !Array.isArray(slots)) { note("week"); continue; }
    const good = [...new Set(slots.filter(k => { const m = SLOT.exec(k); return m && +m[2] < 1440; }))];
    if (good.length < slots.length) note("slot", slots.length - good.length);
    if (good.length) schedule[w] = good;
  }
  const options = {};
  for (const [k, v] of Object.entries(isObj(d.options) ? d.options : {})) if (typeof v === "boolean") options[k] = v;

  d = {...d, projects, entries, running, paused, breakStart, schedule, options};
  if (d.invoice != null && !isObj(d.invoice)) delete d.invoice;

  const n = (k, one, many) => `${count[k]} ${count[k] === 1 ? one : many}`;
  if (count.project) problems.push(`${n("project", "project", "projects")} left out (missing name or id, or a duplicate)`);
  if (count.entry) problems.push(`${n("entry", "time entry", "time entries")} left out (missing or impossible times)`);
  if (count.swapped) problems.push(`${n("swapped", "time entry", "time entries")} had start and end the wrong way round, now fixed`);
  if (count.clock) problems.push(`${n("clock", "running clock", "running clocks")} left out (incomplete)`);
  if (count.week || count.slot) problems.push("some schedule slots left out (unreadable)");
  const skipped = (count.project || 0) + (count.entry || 0) + (count.clock || 0);
  return {data: d, problems, skipped};
}

export {CURRENT_VERSION, blank, migrate, validate, looksLikeData};
