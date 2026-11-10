/* world.ts for the edge shots: the real host, with edge-world.ts beside it to hold her in a pose.
   edge-shots.ps1 puts it in place of world.js in its own copy of the app. It never ships. */
import { createHost, type Message } from '../src/host';
import { addDangle, createPoser, type Ask } from './edge-world';

interface WorkerPort { postMessage(m: unknown): void; start(): void; onmessage: ((e: { data: Message | Ask }) => void) | null }
const scope = globalThis as unknown as { onconnect: (e: { ports: WorkerPort[] }) => void };

addDangle();
let hub: WorkerPort | null = null;
const host = createHost({
  random: Math.random, now: () => performance.now(),
  after: (ms, f) => setTimeout(f, ms) as unknown as number, cancel: id => clearTimeout(id),
  every: (ms, f) => { setInterval(f, ms); },
  note: text => hub?.postMessage({ k: 'note', text })
});
const poser = createPoser(host);
scope.onconnect = e => {
  const port = e.ports[0]!;
  host.connect(port);
  port.onmessage = ({ data: m }) => {
    if (m.k === 'probe') return port.postMessage(poser.ask(m));
    if (!poser.heard(m)) return;
    if (m.k === 'start') hub = port;
    host.message(port, m);
    poser.after(m);
  };
  port.start();
};
