/* Stands in for the world: one SharedWorker with an id and a tick count. */
const id = Math.random().toString(36).slice(2);
const born = Date.now();
let ticks = 0;
setInterval(() => { ticks++; }, 16);
onconnect = e => {
  const port = e.ports[0];
  port.onmessage = () => port.postMessage({ id, ticks, age: Date.now() - born });
  port.start();
};
