/* Small helpers for building a Peel page. No `style` attributes: the pages' CSP refuses them. */
export type Kid = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

function fill<E extends Element>(e: E, attrs: Attrs, kids: Kid[]) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) e.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, String(v));
  }
  e.append(...kids.filter((k): k is Node | string | number => k !== null && k !== undefined && k !== false).map(k => typeof k === 'number' ? String(k) : k));
  return e;
}
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]) => fill(document.createElement(tag), attrs, kids);
export const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]) => fill(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs, kids);

/* A plain button that isn't a submit. */
export function button(words: Kid | Kid[], click: (e: MouseEvent) => void, attrs: Attrs = {}) {
  const b = h('button', { type: 'button', ...attrs }, ...[words].flat());
  b.addEventListener('click', click);
  return b;
}
