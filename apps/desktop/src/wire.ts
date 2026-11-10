/* How pages reach the hub. A BroadcastChannel, not a relay through the world's SharedWorker: the
   worker never hears that a port has closed, so a closed Manager would stay on its list, and the
   simulation would carry app traffic. On a channel, a page that closes just stops listening, and
   a post to nobody is nothing. The Maker can join later with no change here. */

export interface Wire<T = unknown> {
  post(m: T): void;
  /* Everyone else on the wire hears it, in order, as a copy. The sender doesn't. */
  listen(f: (m: T) => void): void;
  close(): void;
}

export const CHANNEL = 'desktop-buddies';
/* The right-click menu's: overlays and the menu page, so they never hear the main channel's traffic,
   which can carry whole buddy files. */
export const MENU_CHANNEL = 'desktop-buddies-menu';

/* One message from a page that doesn't listen. The receivers are fixed as it's posted, so closing
   straight after loses nothing, and the page holds no channel that every message is copied into. */
export function postOnce<T>(m: T, name = CHANNEL) {
  const c = new BroadcastChannel(name);
  c.postMessage(m);
  c.close();
}

export function broadcastWire<T>(name = CHANNEL): Wire<T> {
  const c = new BroadcastChannel(name);
  return {
    post: m => c.postMessage(m),
    listen: f => { c.onmessage = e => f(e.data as T); },
    close: () => c.close()
  };
}

/* The same thing in memory, for tests. `wire()` is one more page on it. */
export function createBus<T>() {
  const ends = new Set<{ hear(m: T): void }>();
  return {
    wire(): Wire<T> {
      let hear: (m: T) => void = () => {};
      const end = { hear: (m: T) => hear(m) };
      ends.add(end);
      return {
        post(m) {
          const copy = structuredClone(m);
          for (const e of ends) if (e !== end) queueMicrotask(() => { if (ends.has(e)) e.hear(structuredClone(copy)); });
        },
        listen(f) { hear = f; },
        close() { ends.delete(end); }
      };
    }
  };
}
