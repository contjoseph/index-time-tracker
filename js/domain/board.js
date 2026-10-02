/* The order of the books on the clock board, and which books have gone quiet. Pure: data in, answer out.
   Running books come first, then the most recently used. Rows move as little as possible: once the board is
   drawn, a row moves only when a clock starts on it below a book that isn't running (see placeStarted). */
export const QUIET = 7 * 86400000;   // a book with no time for this long gets "Close it?"

// The last moment a book was used: its latest time entry, a running clock's start, or when it was created
export function lastUsed(p, entries, running) {
  let t = p.created || 0;
  for (const e of entries) if (e.projectId === p.id && e.end > t) t = e.end;
  for (const r of running) if (r.projectId === p.id && r.start > t) t = r.start;
  return t;
}
// The order when the tracker opens: running books (longest running first), then the most recently used
export function initialOrder(projects, entries, running) {
  const since = id => Math.min(...running.filter(r => r.projectId === id).map(r => r.start));
  const on = projects.filter(p => running.some(r => r.projectId === p.id)).sort((a, b) => since(a.id) - since(b.id));
  const off = projects.filter(p => !on.includes(p)).map(p => [p.id, lastUsed(p, entries, running)]).sort((a, b) => b[1] - a[1]);
  return [...on.map(p => p.id), ...off.map(x => x[0])];
}
// A clock just started on `id`. If a book that isn't running sits above it, move it up to just below the running
// books at the top; otherwise leave the order alone. `on` is the set of running book ids (including `id`).
export function placeStarted(order, id, on) {
  const i = order.indexOf(id);
  if (i < 0 || order.slice(0, i).every(x => on.has(x))) return order;
  const rest = order.filter(x => x !== id);
  let at = 0;
  while (at < rest.length && on.has(rest[at])) at++;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
// Open books with no clock running and no time for a week, quietest first. keep[id] = "don't ask before" time.
export function quietProjects(projects, entries, running, t, keep = {}) {
  return projects.filter(p => !p.closed && !running.some(r => r.projectId === p.id) && !(keep[p.id] > t))
    .map(p => ({p, last: lastUsed(p, entries, running)}))
    .filter(x => t - x.last >= QUIET)
    .sort((a, b) => a.last - b.last);
}
