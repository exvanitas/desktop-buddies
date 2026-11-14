/* The one world, in a SharedWorker the hub and every overlay connect to. There is no page here. */
import { createHost, type Message } from './host';

/* the SharedWorker global, which the DOM library doesn't describe */
interface WorkerPort { postMessage(m: unknown): void; start(): void; onmessage: ((e: { data: Message }) => void) | null }
const scope = globalThis as unknown as { onconnect: (e: { ports: WorkerPort[] }) => void };

let hub: WorkerPort | null = null; /* whoever starts the world hears its notes */
const host = createHost({
  random: Math.random, now: () => performance.now(),
  after: (ms, f) => setTimeout(f, ms) as unknown as number, cancel: id => clearTimeout(id),
  every: (ms, f) => { const id = setInterval(f, ms); return () => clearInterval(id); },
  note: text => hub?.postMessage({ k: 'note', text })
});
scope.onconnect = e => {
  const port = e.ports[0]!;
  host.connect(port);
  port.onmessage = m => { if (m.data.k === 'start') hub = port; host.message(port, m.data); };
  port.start();
};
