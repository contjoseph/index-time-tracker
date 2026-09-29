/* The break reminder ("Still on break?"): when to ask. Pure.
   The first ask is 5 minutes into a break; after "ask again in N min" it's N minutes after that answer.
   Never while the person is away from the computer (the idle detector says so): it waits until they're back. */

export const FIRST_ASK = 5 * 60000;
export const SNOOZES = [5, 10, 20, 30];   // minutes offered for "ask again in …"

// Is a "Still on break?" question due now? `next` = the time chosen with the last snooze (0 = none yet)
export function breakAskDue({breakStart, next, idle, now}) {
  if (!breakStart || idle) return false;
  return now >= (next || breakStart + FIRST_ASK);
}
export const nextAsk = (now, minutes) => now + minutes * 60000;
