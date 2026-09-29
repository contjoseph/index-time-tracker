/* Time zones, using the browser's own zone database (so daylight saving is always right). Pure. */

const fmts = {};
// The wall-clock date and minute of a moment in a zone: {y, mo, d, min}
export function zparts(ts, tz) {
  const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat("en-US", {timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"}));
  const p = {}; for (const x of f.formatToParts(ts)) p[x.type] = +x.value;
  return {y: p.year, mo: p.month, d: p.day, min: (p.hour % 24) * 60 + p.minute};
}
// How far a zone's clock is ahead of UTC at a moment (ms)
export const zoneOff = (ts, tz) => { const p = zparts(ts, tz); return Date.UTC(p.y, p.mo - 1, p.d, 0, p.min) - Math.floor(ts / 60000) * 60000; };
// The moment when a zone's clock shows y-mo-d plus min minutes (the reverse of zparts)
export function zoneTs(y, mo, d, min, tz) { const g = Date.UTC(y, mo - 1, d, 0, min), t1 = g - zoneOff(g, tz); return g - zoneOff(t1, tz); }
// "EDT" or "EST" (for America/New_York), at a moment
export const zoneAbbr = (ts, tz) => new Intl.DateTimeFormat("en-US", {timeZone: tz, timeZoneName: "short"}).formatToParts(ts).find(p => p.type === "timeZoneName").value;
// How far a zone's clock is ahead of this computer's (ms)
export const aheadOfHere = (ts, tz) => zoneOff(ts, tz) + new Date(ts).getTimezoneOffset() * 60000;
