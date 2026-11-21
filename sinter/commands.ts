// The editor's commands: each takes a textarea's text and selection and returns the next ones, or null
// when it does not apply (the key then does what it does natively). They are pure, so they are tested
// without a browser, and rt-editor.ts applies the result to the textarea as one edit the browser's undo
// knows (see `diff`).

/** A textarea's text and its selection, `start` <= `end` (equal: a cursor). */
export interface TextState {
  text: string;
  start: number;
  end: number;
}

/** null: the command does not apply here. */
export type Command = (s: TextState) => TextState | null;

interface Splice {
  at: number;
  remove: number;
  insert: string;
}

/**
 * Applies non-overlapping splices, sorted by `at`. A position in removed text moves to the end of what
 * replaced it; a position where text is inserted moves after it.
 */
function splice({ text, start, end }: TextState, edits: Splice[]): TextState {
  let out = '';
  let last = 0;
  for (const e of edits) {
    out += text.slice(last, e.at) + e.insert;
    last = e.at + e.remove;
  }
  out += text.slice(last);
  const map = (p: number) => {
    let d = 0;
    for (const e of edits) {
      if (p >= e.at + e.remove) d += e.insert.length - e.remove;
      else if (p > e.at) return e.at + d + e.insert.length;
      else break;
    }
    return p + d;
  };
  return { text: out, start: map(start), end: map(end) };
}

const lineStart = (t: string, i: number) => t.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (t: string, i: number) => {
  const n = t.indexOf('\n', i);
  return n < 0 ? t.length : n;
};

/** The lines the selection touches, as [start, end) offsets; a selection ending at a line's start leaves that line out. */
function lines({ text, start, end }: TextState): [number, number][] {
  const last = end > start && end === lineStart(text, end) ? end - 1 : end;
  const out: [number, number][] = [];
  for (let s = lineStart(text, start); ; ) {
    const e = lineEnd(text, s);
    out.push([s, e]);
    if (e >= last || e === text.length) return out;
    s = e + 1;
  }
}

const blank = (s: string) => s.trim() === '';

// ---------------------------------------------------------------------------------------------------
// Inline marks

const WORD = /[\p{L}\p{N}\p{M}_]/u;

/** A block's prefix: indentation, quote markers, a list marker (with a task box) or a heading's #s. */
const BLOCK_PREFIX = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/;

/**
 * Toggles an inline mark: `**` bold, `_` italic, `~~` strikethrough, `` ` `` code. A selection is wrapped
 * without the whitespace at its ends (`** a **` is not bold); a cursor in a word wraps the word; a cursor
 * elsewhere gets an empty pair with the cursor inside. Already wrapped, just outside or just inside the
 * selection, it is unwrapped. Over several lines, each line's text is toggled, after its list marker,
 * quote or heading, since a mark cannot span a paragraph.
 */
export const wrap = (m: string): Command => (s) => {
  const { text, start, end } = s;
  const k = m.length;
  // the marks just outside the selection
  if (start >= k && text.slice(start - k, start) === m && text.slice(end, end + k) === m && !text.slice(start, end).includes('\n')) {
    return splice(s, [{ at: start - k, remove: k, insert: '' }, { at: end, remove: k, insert: '' }]);
  }
  if (start === end) {
    let a = start;
    let b = start;
    while (a > 0 && WORD.test(text[a - 1]!)) a--;
    while (b < text.length && WORD.test(text[b]!)) b++;
    if (a === b) return { text: text.slice(0, start) + m + m + text.slice(start), start: start + k, end: start + k };
    if (a >= k && text.slice(a - k, a) === m && text.slice(b, b + k) === m) {
      return splice(s, [{ at: a - k, remove: k, insert: '' }, { at: b, remove: k, insert: '' }]);
    }
    return { text: text.slice(0, a) + m + text.slice(a, b) + m + text.slice(b), start: start + k, end: start + k };
  }
  // one segment per line: [from, to) of the selection, after the block prefix when it starts the line, trimmed
  const segs: [number, number][] = [];
  for (const [ls, le] of lines(s)) {
    let a = Math.max(ls, start);
    let b = Math.min(le, end);
    if (a === ls) a += BLOCK_PREFIX.exec(text.slice(ls, le))![0].length;
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (a < b) segs.push([a, b]);
  }
  if (segs.length === 0) return null;
  const wrapped = ([a, b]: [number, number]) => b - a >= 2 * k && text.startsWith(m, a) && text.slice(b - k, b) === m;
  const unwrap = segs.every(wrapped);
  const edits: Splice[] = [];
  for (const [a, b] of segs) {
    if (unwrap) edits.push({ at: a, remove: k, insert: '' }, { at: b - k, remove: k, insert: '' });
    else if (!wrapped([a, b])) edits.push({ at: a, remove: 0, insert: m }, { at: b, remove: 0, insert: m });
  }
  const next = splice(s, edits);
  if (segs.length > 1) return { text: next.text, start, end: end + next.text.length - text.length };
  // one segment: the selection is its text, inside the marks
  const [a, b] = segs[0]!;
  return unwrap ? { text: next.text, start: a, end: b - 2 * k } : { text: next.text, start: a + k, end: b + k };
};

export const bold = wrap('**');
export const italic = wrap('_');
export const strikethrough = wrap('~~');
export const inlineCode = wrap('`');

const URL_TEXT = /^(?:https?:\/\/|mailto:)\S+$/i;

/**
 * A link: the selected text as its text, with `url` selected to be typed over; a selected URL as its
 * destination, with `text` selected; nothing selected, both placeholders, `text` selected.
 */
export const link: Command = (s) => {
  const { text, start, end } = s;
  const sel = text.slice(start, end);
  if (sel.includes('\n')) return null;
  const put = (label: string, url: string, pick: 'label' | 'url') => {
    const md = `[${label}](${url})`;
    const at = pick === 'label' ? start + 1 : start + label.length + 3;
    return { text: text.slice(0, start) + md + text.slice(end), start: at, end: at + (pick === 'label' ? label : url).length };
  };
  if (URL_TEXT.test(sel.trim())) return put('text', sel.trim(), 'label');
  return sel ? put(sel, 'url', 'url') : put('text', 'url', 'label');
};

/** Pasting a URL over selected text links the text to it; the cursor goes after the link. */
export const pasteLink = (url: string): Command => (s) => {
  const { text, start, end } = s;
  const sel = text.slice(start, end);
  url = url.trim();
  if (!sel || sel.includes('\n') || !URL_TEXT.test(url) || URL_TEXT.test(sel.trim())) return null;
  const md = `[${sel}](${url})`;
  return { text: text.slice(0, start) + md + text.slice(end), start: start + md.length, end: start + md.length };
};

// ---------------------------------------------------------------------------------------------------
// Line commands: each applies to the lines the selection touches

/** A heading of `level` on each line; on lines that are all that level already, removes it. */
export const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): Command => (s) => {
  const ls = lines(s).filter(([a, b]) => !blank(s.text.slice(a, b)));
  if (ls.length === 0) {
    const at = lineStart(s.text, s.start);
    return splice(s, [{ at, remove: 0, insert: '#'.repeat(level) + ' ' }]);
  }
  const H = /^#{1,6}(?:[ \t]+|$)/;
  const same = ls.every(([a, b]) => new RegExp(`^#{${level}}(?:[ \\t]+|$)`).test(s.text.slice(a, b)));
  return splice(s, ls.map(([a, b]) => {
    const old = H.exec(s.text.slice(a, b))?.[0] ?? '';
    return { at: a, remove: old.length, insert: same ? '' : '#'.repeat(level) + ' ' };
  }));
};

/** A quote: `> ` before each line; on lines that are all quoted, removes one level. */
export const quote: Command = (s) => {
  const ls = lines(s);
  const Q = /^[ \t]{0,3}>[ \t]?/;
  const quoted = ls.every(([a, b]) => blank(s.text.slice(a, b)) || Q.test(s.text.slice(a, b)));
  const some = ls.some(([a, b]) => !blank(s.text.slice(a, b)));
  return splice(s, ls.map(([a, b]) => {
    const line = s.text.slice(a, b);
    if (quoted && some) return { at: a, remove: Q.exec(line)?.[0].length ?? 0, insert: '' };
    return { at: a, remove: 0, insert: blank(line) && ls.length > 1 ? '>' : '> ' };
  }));
};

/** A list item: its indentation, its marker with the spaces after it, and its task box. */
const ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)(\[[ xX]\][ \t]+)?/;

type ListKind = 'bullet' | 'ordered' | 'task';
const kindOf = (m: RegExpExecArray): ListKind => (m[3] ? 'ordered' : m[6] ? 'task' : 'bullet');

/**
 * A list of `kind` over the lines: `- `, `1. ` (numbered from 1 at each indentation), `- [ ] `. Lines
 * that are all that kind already become plain lines; a list of another kind is changed to this one,
 * keeping its indentation, and a task keeps its box. Blank lines stay blank.
 */
export const list = (kind: ListKind): Command => (s) => {
  const ls = lines(s);
  const items = ls.map(([a, b]) => ({ a, line: s.text.slice(a, b), m: ITEM.exec(s.text.slice(a, b)) }));
  const filled = items.filter((i) => !blank(i.line) || ls.length === 1);
  const off = filled.length > 0 && filled.every((i) => i.m && kindOf(i.m) === kind);
  const counts = new Map<string, number>();
  const edits: Splice[] = [];
  for (const { a, line, m } of filled) {
    const indent = m ? m[1]! : /^[ \t]*/.exec(line)![0];
    const old = m ? m[0].length : indent.length;
    if (off) {
      edits.push({ at: a, remove: old, insert: indent });
      continue;
    }
    const n = (counts.get(indent) ?? 0) + 1;
    counts.set(indent, n);
    const marker = kind === 'ordered' ? `${n}. ` : kind === 'task' ? (m?.[6] ? `- ${m[6]}` : '- [ ] ') : '- ';
    edits.push({ at: a, remove: old, insert: indent + marker });
  }
  return splice(s, edits);
};

export const bulletList = list('bullet');
export const orderedList = list('ordered');
export const taskList = list('task');

const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** A fenced code block around the lines; lines that are fenced, first and last, are unfenced. */
export const codeBlock: Command = (s) => {
  const ls = lines(s);
  const [fa, fb] = ls[0]!;
  const [la, lb] = ls[ls.length - 1]!;
  if (ls.length > 1 && FENCE.test(s.text.slice(fa, fb)) && FENCE.test(s.text.slice(la, lb))) {
    if (ls.length === 2) return splice(s, [{ at: fa, remove: lb - fa, insert: '' }]);
    return splice(s, [
      { at: fa, remove: fb - fa + 1, insert: '' },
      { at: la - 1, remove: lb - la + 1, insert: '' },
    ]);
  }
  // a fence longer than any run of backticks inside
  const inside = s.text.slice(fa, lb);
  let n = 3;
  for (const run of inside.match(/`{3,}/g) ?? []) n = Math.max(n, run.length + 1);
  const fence = '`'.repeat(n);
  const next = splice(s, [{ at: fa, remove: 0, insert: fence + '\n' }, { at: lb, remove: 0, insert: '\n' + fence }]);
  // the selection stays on the same text, inside the fences (on a blank line both insertions are at one place)
  return { text: next.text, start: s.start + fence.length + 1, end: s.end + fence.length + 1 };
};

/** Code: inline on one line of text; a block over several lines, or on a blank line. */
export const code: Command = (s) => {
  const line = s.text.slice(lineStart(s.text, s.start), lineEnd(s.text, s.start));
  return s.text.slice(s.start, s.end).includes('\n') || (s.start === s.end && blank(line)) ? codeBlock(s) : inlineCode(s);
};

// ---------------------------------------------------------------------------------------------------
// Keys

const QUOTE = /^[ \t]{0,3}(?:>[ \t]?)+/;

/**
 * Enter in a list item or a quote: a new item after it (the next number; an unchecked box for a task),
 * or a new quoted line. Enter in an empty item ends the list, and in an empty quoted line ends the
 * quote. null with a selection, in the prefix, or on any other line.
 */
export const newline: Command = (s) => {
  const { text, start, end } = s;
  if (start !== end) return null;
  const ls = lineStart(text, start);
  const line = text.slice(ls, lineEnd(text, start));
  const q = QUOTE.exec(line)?.[0] ?? '';
  const m = ITEM.exec(line.slice(q.length));
  if (m && m[5] === '' && !m[6]) return null; // `-` alone: a line that may become a setext heading or a rule
  const prefix = q.length + (m ? m[0].length : 0);
  if (prefix === 0 || start < ls + prefix) return null;
  if (blank(line.slice(prefix))) {
    // empty: an item drops its marker, keeping the quote; a quoted line drops its quote
    const keep = m ? q : '';
    return { text: text.slice(0, ls) + keep + text.slice(ls + line.length), start: ls + keep.length, end: ls + keep.length };
  }
  let next = q;
  if (m) {
    next += m[1]! + (m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2]!) + (m[5] || ' ') + (m[6] ? '[ ] ' : '');
  }
  const insert = '\n' + next;
  return { text: text.slice(0, start) + insert + text.slice(end), start: start + insert.length, end: start + insert.length };
};

/** The list item on the line before `ls` with an indentation of at most `max`, if one comes before a line at the left edge. */
function itemAbove(text: string, ls: number, max: number): RegExpExecArray | null {
  for (let e = ls - 1; e > 0; ) {
    const a = lineStart(text, e);
    const line = text.slice(a, e);
    const m = ITEM.exec(line);
    if (m && m[1]!.length <= max) return m;
    if (!m && !blank(line) && !/^[ \t]/.test(line)) return null;
    e = a - 1;
  }
  return null;
}

/**
 * Tab (`1`) and Shift+Tab (`-1`) on list items: an item moves under the content of the item before it,
 * or back to the indentation of its parent. Applies when the selection's lines include an item; the
 * lines that are not items stay. null when none is, so Tab moves focus as usual.
 */
export const indent = (dir: 1 | -1): Command => (s) => {
  const ls = lines(s).map(([a, b]) => ({ a, m: ITEM.exec(s.text.slice(a, b)) }));
  const first = ls.find((l) => l.m);
  if (!first) return null;
  const cur = first.m![1]!.length;
  let delta: number;
  if (dir === 1) {
    const sib = itemAbove(s.text, first.a, cur);
    // under the sibling's content; with no sibling, by the item's own marker
    delta = sib && sib[1]!.length === cur ? sib[0].length - (sib[6]?.length ?? 0) - cur : first.m![0].length - (first.m![6]?.length ?? 0) - cur;
  } else {
    const parent = cur > 0 ? itemAbove(s.text, first.a, cur - 1) : null;
    delta = parent ? parent[1]!.length - cur : -cur;
  }
  if (delta === 0) return s;
  const edits: Splice[] = [];
  for (const { a, m } of ls) {
    if (!m) continue;
    const have = m[1]!.length;
    if (delta > 0) edits.push({ at: a, remove: 0, insert: ' '.repeat(delta) });
    else if (have > 0) edits.push({ at: a, remove: Math.min(have, -delta), insert: '' });
  }
  return splice(s, edits);
};

// ---------------------------------------------------------------------------------------------------

/**
 * The one replacement that turns `a` into `b`: the text between their common start and common end.
 * rt-editor.ts selects [from, to) and inserts `insert`, one step for the browser's undo. Never splits a
 * surrogate pair.
 */
export function diff(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let p = 0;
  const n = Math.min(a.length, b.length);
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--;
  let q = 0;
  while (q < n - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
  if (q > 0 && isLow(a.charCodeAt(a.length - q))) q--;
  return { from: p, to: a.length - q, insert: b.slice(p, b.length - q) };
}
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The commands a toolbar button names, by its `data-rt-command`. */
export const commands = {
  bold,
  italic,
  strikethrough,
  code,
  link,
  heading: heading(2),
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  quote,
  bulletList,
  orderedList,
  taskList,
  codeBlock,
} satisfies Record<string, Command>;

export type CommandName = keyof typeof commands;
