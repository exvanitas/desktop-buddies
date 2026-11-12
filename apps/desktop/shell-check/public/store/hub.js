/* The Store package's check, from inside it. store-package.ps1 starts the installed package through
   its alias with this folder as the app folder, and reads what it wrote from outside. It asks the exe
   what only the package can answer, writes store-check.json in the data folder, and quits. */
/* Every argument goes through: data_write's path travels in the third, as a header. */
const invoke = (...args) => window.__TAURI__.core.invoke(...args);
const answer = async f => { try { return { ok: await f() }; } catch (e) { return { error: String(e) }; } };

(async () => {
  const out = {};
  out.info = await answer(async () => { const i = await invoke('shell_info'); return { packaged: i.packaged === true, dataDir: i.dataDir }; });
  /* The startup task, round and back: it starts off, as the manifest says. */
  out.startBefore = await answer(() => invoke('autostart', {}));
  out.startOn = await answer(() => invoke('autostart', { on: true }));
  out.startRead = await answer(() => invoke('autostart', {}));
  out.startOff = await answer(() => invoke('autostart', { on: false }));
  out.startAfter = await answer(() => invoke('autostart', {}));
  /* .buddy files: declared by the package, so on, and not the app's to change. */
  out.assoc = await answer(() => invoke('file_assoc', {}));
  out.assocSet = await answer(() => invoke('file_assoc', { on: false }));
  const bytes = new TextEncoder().encode(JSON.stringify(out));
  await invoke('data_write', bytes, { headers: { 'x-path': encodeURIComponent('store-check.json') } });
  await invoke('log_line', { line: 'STORE CHECK written' });
})().catch(e => invoke('log_line', { line: `STORE CHECK threw ${e}` })).finally(() => invoke('quit'));
