/* The auto-save file (Chrome and Edge): create, open, reconnect, and write after every change. */
import {looksLikeData, validate} from "../data/schema.js";
import {S, commit, mergeIn} from "../data/store.js";
import {now, toast} from "./dom.js";
import {renderSafe} from "./settings.js";

/* ---------- auto-save file (Chrome and Edge) ---------- */
// The file's handle is remembered in IndexedDB so the tracker can find it again next time.
export const canFile = "showSaveFilePicker" in window;
export let fileH = null, fileOK = false, fileSaved = 0, fileTimer;
export function idb(mode, fn) {
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
export function queueFile() { if (fileH && fileOK) { clearTimeout(fileTimer); fileTimer = setTimeout(writeFile, 800); } }
export async function writeFile() {
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
export async function useFile(h, text) {
  let problems = [];
  try { const r = validate(JSON.parse(text)); mergeIn(r.data); problems = r.problems; } catch {}   // empty or new file: nothing to bring in
  fileH = h; fileOK = true;
  await idb("readwrite", s => s.put(h, "file")).catch(() => {});
  commit(); await writeFile();
  toast(`Auto-saving to ${h.name}` + (problems.length ? `. Part of the file was damaged: ${problems.join("; ")}` : ""));
}
export async function fileAction(kind) {
  try {
    if (kind === "new") {
      const h = await showSaveFilePicker({suggestedName: "time-tracker-data.json", types: [{description: "Time tracker data", accept: {"application/json": [".json"]}}]});
      await useFile(h, await (await h.getFile()).text().catch(() => ""));
    } else if (kind === "open") {
      const [h] = await showOpenFilePicker({types: [{description: "Time tracker data", accept: {"application/json": [".json"]}}]});
      const text = await (await h.getFile()).text();
      try { if (!looksLikeData(JSON.parse(text))) throw 0; } catch { toast("That file isn't tracker data"); return; }
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
export async function reconnectFile() {
  if (!canFile) return;
  fileH = await idb("readonly", s => s.get("file")).catch(() => null) || null;
  if (fileH) fileOK = await fileH.queryPermission({mode: "readwrite"}).then(p => p === "granted").catch(() => false);
  renderSafe(); if (fileOK) writeFile();
}