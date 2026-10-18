// Central numeric input handling (iPhone: the decimal keypad of `inputmode=decimal` has NO minus key).
//  • data-num="abs"    – magnitude only (± bands, search distance, zone tolerances, radii): decimal keypad, a typed sign is dropped
//  • data-num="signed" – may be negative (TEDs, Tol−, nominal coordinates/angles, offsets): text keyboard + small ± button
//                        that flips the sign
//  • any other numeric field (inputmode=decimal / type=number) – decimal keypad, ',' and '.' accepted
// ',' and '.' are both accepted as decimal separator, as is the typographic minus '−'. The value is normalised in a
// capture-phase 'change' listener, i.e. BEFORE the field's own handler reads it – existing handlers keep working.
import { t as tt } from '../i18n';

/** Parse a user number: ',' or '.' as decimal separator, '−' as minus, spaces ignored; '' → null, invalid → NaN. */
export function parseNum(s: string): number | null {
  const x = s.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(',', '.');
  if (x === '' || x === '+' || x === '-') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(x) ? Number(x) : NaN;
}
/** text after normalisation (for handlers that read input.value) */
function normText(i: HTMLInputElement): void {
  const kind = i.dataset.num; let s = i.value.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(',', '.');
  if (kind === 'abs') s = s.replace(/^[+-]/, '');
  i.value = s;
}
const NUMSEL = 'input[type="number"], input[inputmode="decimal"], input[data-num]';
function enhance(i: HTMLInputElement) {
  if (i.dataset.numOk) return; i.dataset.numOk = '1';
  if (i.type === 'number') { i.type = 'text'; }
  i.autocomplete = 'off'; i.setAttribute('autocorrect', 'off'); i.setAttribute('autocapitalize', 'off'); i.spellcheck = false;
  if (i.dataset.num === 'signed') {
    // text keyboard (has '-' on the iOS 123 layer) + an explicit sign toggle next to the field
    i.inputMode = 'text'; i.setAttribute('enterkeyhint', 'done');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'num-pm'; b.textContent = '±'; b.tabIndex = -1;
    b.title = tt('Flip the sign (+/−)');
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus/keyboard
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); flipSign(i); };
    i.insertAdjacentElement('afterend', b);
  } else i.inputMode = 'decimal';
}
/** flip the sign of a field's value and fire 'change' like a user edit */
export function flipSign(i: HTMLInputElement) {
  const s = i.value.trim().replace(/[−–]/g, '-');
  // data-num-neg: a plain number means a NEGATIVE value (Tol−), so the positive side is written with an explicit '+'
  if (i.dataset.numNeg === '1') i.value = s.startsWith('+') ? '-' + s.slice(1) : '+' + s.replace(/^-/, '');
  else i.value = s.startsWith('-') ? s.slice(1) : s.startsWith('+') ? '-' + s.slice(1) : s === '' ? '-' : '-' + s;
  i.dispatchEvent(new Event('input', { bubbles: true })); if (s !== '') i.dispatchEvent(new Event('change', { bubbles: true }));
}
let installed = false;
/** Install once: enhance all current and future numeric fields; normalise values before the fields' own handlers. */
export function installNumFields(root: HTMLElement = document.body) {
  if (installed) return; installed = true;
  const scan = (n: ParentNode) => n.querySelectorAll<HTMLInputElement>(NUMSEL).forEach(enhance);
  scan(root);
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((x) => { if (x instanceof HTMLElement) { if (x.matches?.(NUMSEL)) enhance(x as HTMLInputElement); scan(x); } }); })
    .observe(root, { childList: true, subtree: true });
  const norm = (e: Event) => { const i = e.target; if (i instanceof HTMLInputElement && i.matches(NUMSEL)) normText(i); };
  document.addEventListener('change', norm, true);
  document.addEventListener('keydown', (e) => { const i = e.target; if (e.key === 'Enter' && i instanceof HTMLInputElement && i.matches(NUMSEL)) normText(i); }, true);
}
