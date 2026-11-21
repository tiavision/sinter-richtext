// The commands, on text written with its selection: `«` and `»` mark it, `«»` a cursor.
import { describe, expect, test } from 'vitest';
import {
  bold, bulletList, code, codeBlock, diff, heading, indent, inlineCode, italic, link, newline, orderedList,
  pasteLink, quote, strikethrough, taskList, type Command, type TextState,
} from '../sinter/commands.js';

const read = (s: string): TextState => {
  const start = s.indexOf('«');
  const end = s.indexOf('»') - 1;
  if (start < 0 || end < start) throw new Error(`no selection in ${JSON.stringify(s)}`);
  return { text: s.replace('«', '').replace('»', ''), start, end };
};
const write = ({ text, start, end }: TextState) => text.slice(0, start) + '«' + text.slice(start, end) + '»' + text.slice(end);
const run = (cmd: Command, s: string) => {
  const r = cmd(read(s));
  return r && write(r);
};

describe('inline marks', () => {
  test.each([
    ['a «b» c', 'a **«b»** c'],
    ['a **«b»** c', 'a «b» c'], // the marks just outside
    ['a «**b**» c', 'a «b» c'], // the marks inside
    ['a« b »c', 'a **«b»** c'], // not the spaces at the ends
    ['a «»', 'a **«»**'], // an empty pair, the cursor inside
    ['a **«»**', 'a «»'],
    ['wo«»rd', '**wo«»rd**'], // a word under the cursor
    ['**wo«»rd**', 'wo«»rd'],
    ['«one\ntwo»', '«**one**\n**two**»'], // each line
    ['«- one\n- two»', '«- **one**\n- **two**»'], // after a list marker
    ['«# Title\n\n> quoted»', '«# **Title**\n\n> **quoted**»'],
    ['«**one**\n**two**»', '«one\ntwo»'],
  ])('bold: %j → %j', (s, out) => expect(run(bold, s)).toBe(out));

  test('italic, strikethrough, inline code', () => {
    expect(run(italic, 'a «b»')).toBe('a _«b»_');
    expect(run(strikethrough, 'a «b»')).toBe('a ~~«b»~~');
    expect(run(inlineCode, 'a «b»')).toBe('a `«b»`');
    expect(run(italic, '**«b»**')).toBe('**_«b»_**'); // marks of another kind stay
  });

  test('a selection of only spaces does not apply', () => expect(run(bold, 'a«  »b')).toBeNull());
});

describe('links', () => {
  test.each([
    ['see «docs»', 'see [docs](«url»)'],
    ['see «https://x.dev/a»', 'see [«text»](https://x.dev/a)'],
    ['see «»', 'see [«text»](url)'],
  ])('link: %j → %j', (s, out) => expect(run(link, s)).toBe(out));
  test('not over lines', () => expect(run(link, '«a\nb»')).toBeNull());

  test('a URL pasted over text links it', () => {
    expect(run(pasteLink('https://x.dev'), 'see «docs» here')).toBe('see [docs](https://x.dev)«» here');
    expect(run(pasteLink('just text'), 'see «docs»')).toBeNull();
    expect(run(pasteLink('https://x.dev'), 'see «»')).toBeNull(); // nothing selected: an ordinary paste
    expect(run(pasteLink('https://x.dev'), '«https://old.dev»')).toBeNull(); // a URL replaces a URL
  });
});

describe('line commands', () => {
  test.each([
    ['Ti«»tle', '## Ti«»tle'],
    ['## Ti«»tle', 'Ti«»tle'],
    ['# Ti«»tle', '## Ti«»tle'],
    ['«»', '## «»'],
  ])('heading: %j → %j', (s, out) => expect(run(heading(2), s)).toBe(out));

  test.each([
    ['«one\ntwo»', '> «one\n> two»'] /* the selection stays on the text */,
    ['«> one\n> two»', '«one\ntwo»'],
    ['«one\n\ntwo»', '> «one\n>\n> two»'], // a blank line stays in the quote
    ['«»', '> «»'],
  ])('quote: %j → %j', (s, out) => expect(run(quote, s)).toBe(out));

  test.each([
    [bulletList, '«one\ntwo»', '- «one\n- two»'],
    [bulletList, '«- one\n- two»', '«one\ntwo»'],
    [bulletList, '«1. one\n2. two»', '«- one\n- two»'], // another kind is changed
    [orderedList, '«one\ntwo\nthree»', '1. «one\n2. two\n3. three»'],
    [orderedList, '«- one\n  - sub\n- two»', '«1. one\n  1. sub\n2. two»'], // numbered per indentation
    [orderedList, '«1. one\n2. two»', '«one\ntwo»'],
    [taskList, '«one\n- two»', '- [ ] «one\n- [ ] two»'],
    [taskList, '«- [x] done\n- [ ] open»', '«done\nopen»'],
    [bulletList, '«one\n\ntwo»', '- «one\n\n- two»'], // blank lines stay blank
    [bulletList, 'o«»ne', '- o«»ne'],
  ])('list: %#', (cmd, s, out) => expect(run(cmd, s)).toBe(out));

  test('a selection ending at a line start leaves that line', () => {
    expect(run(bulletList, '«one\n»two')).toBe('- «one\n»two');
  });

  test('code blocks', () => {
    expect(run(codeBlock, '«a\nb»')).toBe('```\n«a\nb»\n```');
    expect(run(codeBlock, '«```\na\n```»')).toBe('«a»');
    expect(run(codeBlock, '«```\n```»')).toBe('«»');
    expect(run(codeBlock, '«x ``` y»')).toBe('````\n«x ``` y»\n````'); // a fence longer than the backticks inside
    expect(run(code, 'a «b» c')).toBe('a `«b»` c'); // inline on a line of text
    expect(run(code, '«»')).toBe('```\n«»\n```'); // a block on a blank line
    expect(run(code, '«a\nb»')).toBe('```\n«a\nb»\n```');
  });
});

describe('Enter', () => {
  test.each([
    ['- one«»', '- one\n- «»'],
    ['* one«»', '* one\n* «»'],
    ['1. one«»', '1. one\n2. «»'],
    ['9) one«»', '9) one\n10) «»'],
    ['- [x] done«»', '- [x] done\n- [ ] «»'],
    ['  - sub«»', '  - sub\n  - «»'],
    ['> quoted«»', '> quoted\n> «»'],
    ['> - in a quote«»', '> - in a quote\n> - «»'],
    ['- one«» two', '- one\n- «» two'], // splits the item
    ['- one\n- «»', '- one\n«»'], // an empty item ends the list
    ['> - «»', '> «»'], // keeping the quote
    ['> «»', '«»'], // an empty quoted line ends the quote
  ])('%j → %j', (s, out) => expect(run(newline, s)).toBe(out));

  test.each([
    ['plain«»'],
    ['-«»'], // `-` alone: a setext underline or a rule may follow
    ['-«» one'], // in the prefix
    ['- «one»'], // a selection
  ])('native: %j', (s) => expect(run(newline, s)).toBeNull());
});

describe('Tab and Shift+Tab', () => {
  test.each([
    ['- one\n- tw«»o', '- one\n  - tw«»o'],
    ['1. one\n2. tw«»o', '1. one\n   2. tw«»o'], // under the sibling's content
    ['- one\n  - two\n  - th«»ree', '- one\n  - two\n    - th«»ree'],
    ['- «one\n- two»', '  - «one\n  - two»'], // several items, the first without a sibling: by its marker
  ])('indent: %j → %j', (s, out) => expect(run(indent(1), s)).toBe(out));

  test.each([
    ['- one\n  - tw«»o', '- one\n- tw«»o'],
    ['1. one\n   - tw«»o', '1. one\n- tw«»o'],
    ['- one\n  - two\n    - th«»ree', '- one\n  - two\n  - th«»ree'],
    ['- o«»ne', '- o«»ne'], // already at the edge: unchanged, the key still taken
  ])('outdent: %j → %j', (s, out) => expect(run(indent(-1), s)).toBe(out));

  test('not a list: Tab moves focus', () => expect(run(indent(1), 'plain«»')).toBeNull());
});

describe('diff', () => {
  test('the one replacement between two texts', () => {
    expect(diff('a b c', 'a **b** c')).toEqual({ from: 2, to: 3, insert: '**b**' });
    expect(diff('a **b** c', 'a b c')).toEqual({ from: 2, to: 7, insert: 'b' });
    expect(diff('same', 'same')).toBeNull();
    expect(diff('one\ntwo', '- one\n- two')).toEqual({ from: 0, to: 4, insert: '- one\n- ' });
  });
  test('never splits a surrogate pair', () => {
    const d = diff('😀', '😃')!; // U+1F600 and U+1F603 share their high surrogate
    expect(d).toEqual({ from: 0, to: 2, insert: '😃' });
  });
});
