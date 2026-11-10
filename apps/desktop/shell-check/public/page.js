/* An overlay or window for the contract check. The hub drives it over a BroadcastChannel. */
const { label } = window.__BUDDIES__;
const tauri = window.__TAURI__;
const channel = new BroadcastChannel('check');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let renewing = null, presses = 0;

addEventListener('pointerdown', () => { presses++; });
addEventListener('contextmenu', e => e.preventDefault());

const commands = {
  ping: () => ({ boot: window.__BUDDIES__, href: location.href, origin: location.origin }),
  capture: async ({ on }) => tauri.core.invoke('capture', { on }),
  renew: ({ on }) => {
    clearInterval(renewing); renewing = null;
    if (on) renewing = setInterval(() => tauri.core.invoke('capture', { on: true }), 400);
  },
  /* on, off, on, off, all in flight at once */
  storm: async ({ count }) => {
    await Promise.all(Array.from({ length: count }, (_, i) => tauri.core.invoke('capture', { on: i % 2 === 0 })));
  },
  presses: () => presses,
  /* never comes back, like a page that died mid-drag */
  hang: () => { setTimeout(() => { for (;;); }, 50); },
  go: ({ url }) => { location.href = url; },
  popup: ({ url }) => String(window.open(url)),
  /* with no user gesture, this only runs if the browser arguments reached this window */
  sound: async () => {
    const a = new AudioContext();
    await sleep(300);
    return a.state;
  },
  worker: async () => {
    const port = new SharedWorker('worker.js', { name: 'check' }).port;
    port.start();
    return new Promise(done => { port.onmessage = e => done(e.data); port.postMessage('ask'); });
  },
  titlebar: async ({ what }) => {
    const w = tauri.window.getCurrentWindow();
    await w[what]();
  },
  maximized: () => tauri.window.getCurrentWindow().isMaximized()
};

channel.onmessage = async ({ data: m }) => {
  if (m.to !== label) return;
  try { channel.postMessage({ reply: m.id, value: await commands[m.cmd](m.args || {}) }); }
  catch (e) { channel.postMessage({ reply: m.id, error: String(e) }); }
};
channel.postMessage({ hello: label });
