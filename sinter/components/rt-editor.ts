// The script of <rt-editor>: keys, toolbar buttons and pasted links, run as commands on the textarea.
// sinter renders the markup and binds the value; this applies each command's result as one edit the
// browser records for undo (the textarea's own `insertText`), so the textarea's `input` event, bound in
// the markup, emits `change` as typing does. It writes no node sinter renders: it edits the text of the
// textarea it was handed as a ref, as a user would.
import { RtEditorComponent } from './rt-editor.html';
import { bold, code, commands, diff, indent, italic, link, newline, pasteLink, type Command, type TextState } from '../commands.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Ctrl (⌘ on Apple) + key, and Tab, Shift+Tab, Enter */
const KEYS: Record<string, Command> = { b: bold, i: italic, e: code, k: link };

export class RtEditor extends RtEditorComponent {
  #stop = new AbortController();

  connected() {
    const { input, toolbar } = this.refs;
    const signal = this.#stop.signal;

    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return; // an IME's Enter is the IME's
      const mod = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      let cmd: Command | undefined;
      if (mod && !e.altKey && !e.shiftKey) cmd = KEYS[e.key.toLowerCase()];
      else if (!mod && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'Enter' && !e.shiftKey) cmd = newline;
        else if (e.key === 'Tab') cmd = indent(e.shiftKey ? -1 : 1);
      }
      if (cmd && this.#run(cmd)) e.preventDefault();
    }, { signal });

    input.addEventListener('paste', (e) => {
      const url = e.clipboardData?.getData('text/plain');
      if (url && this.#run(pasteLink(url))) e.preventDefault();
    }, { signal });

    // a button keeps the focus and the selection in the textarea
    toolbar.addEventListener('mousedown', (e) => {
      if (target(e)) e.preventDefault();
    }, { signal });
    toolbar.addEventListener('click', (e) => {
      const name = target(e)?.dataset.rtCommand;
      const cmd = name && Object.hasOwn(commands, name) ? commands[name as keyof typeof commands] : undefined;
      if (cmd) this.#run(cmd, true);
    }, { signal });
  }

  disconnected() {
    this.#stop.abort();
  }

  /** Runs `cmd` on the textarea; false when it does not apply (or the textarea takes no edits). */
  #run(cmd: Command, focus = false): boolean {
    const el = this.refs.input;
    if (el.disabled || el.readOnly) return false;
    const before: TextState = { text: el.value, start: el.selectionStart, end: el.selectionEnd };
    const next = cmd(before);
    if (!next) return false;
    if (focus) el.focus({ preventScroll: true });
    const d = diff(before.text, next.text);
    if (d) {
      el.setSelectionRange(d.from, d.to);
      // insertText keeps the browser's undo; where it does not take, the text is set and `input` sent
      const done = document.activeElement === el && (d.insert ? document.execCommand('insertText', false, d.insert) : document.execCommand('delete'));
      const set = !done || el.value !== next.text; // not inserted, or changed by the browser as it was
      if (!done) el.setRangeText(d.insert, d.from, d.to);
      else if (set) el.value = next.text;
      if (set) el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: d.insert }));
    }
    el.setSelectionRange(next.start, next.end);
    return true;
  }
}

/** The command button an event is from: inside the toolbar, not disabled. */
function target(e: Event): HTMLElement | null {
  const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-rt-command]');
  return el && !(el as HTMLButtonElement).disabled ? el : null;
}
