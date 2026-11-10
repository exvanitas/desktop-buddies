/* A failure in Peel: a dashed misprint saying what happened, why, and what to do. */
import { h, type Kid } from './dom';

export function misprintOf(f: { title: string; why?: string; fix?: string }, attrs: Record<string, string>, ...actions: Kid[]) {
  return h('div', { class: 'misprint', role: 'alert', ...attrs },
    h('p', {}, h('b', { dir: 'auto' }, f.title), [f.why, f.fix].filter(Boolean).join(' ')),
    ...actions);
}
