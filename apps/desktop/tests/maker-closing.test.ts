// @vitest-environment happy-dom
/* The closing dialog's guard on its own: while it's up, nothing from outside reaches the page, the
   dialog included, and once it's down everything does again. */
import assert from '@buddies/test-support/dom-assert';
import { afterEach, test } from 'vitest';
import { closingDialog } from '../src/maker-closing';

afterEach(() => { document.body.replaceChildren(); });

const TYPES = ['dragenter', 'dragover', 'drop', 'paste', 'change', 'input'];
/* Which of these, sent at `target`, reach a listener on the document, and which go unrefused. */
function reaching(target: EventTarget) {
  const heard: string[] = [];
  const hear = (e: Event) => { heard.push(e.type); };
  for (const t of TYPES) document.addEventListener(t, hear);
  /* refused means not heard, and the browser's own handling stopped too */
  for (const t of TYPES) { const e = new Event(t, { bubbles: true, cancelable: true }); target.dispatchEvent(e); if (!e.defaultPrevented) heard.push(`${t} allowed`); }
  for (const t of TYPES) document.removeEventListener(t, hear);
  return heard.join();
}

test('while it\'s up, nothing from outside gets anywhere, even dropped on the dialog', () => {
  const ui = closingDialog();
  ui.show();
  const box = document.querySelector('dialog.closing')!;
  assert.strictEqual(reaching(document.body), '');
  assert.strictEqual(reaching(box), '');
  assert.strictEqual(reaching(box.firstElementChild!), '');
  ui.hide();
  assert.strictEqual(reaching(document.body), TYPES.flatMap(t => [t, `${t} allowed`]).join(), 'and once it\'s down, everything does');
});
