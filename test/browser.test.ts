// The fixture pages built as an app and used in Chromium, as a person types: the keys, the toolbar, the
// undo, pasting a link, the tabs and the live preview drawn by sinter-markdown, and a form that resets
// the value. Every page runs under `script-src 'self'; style-src 'self'; require-trusted-types-for
// 'script'` and fails on any violation report or console error.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import sinter from '@tiaforge-ui/sinter/vite';
import { app } from './app.js';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; require-trusted-types-for 'script'";
const a = app(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
const dist = join(a.root, 'dist');
let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  await build({
    root: a.root, logLevel: 'silent',
    plugins: [sinter({ libraries: ['@tiaforge-ui/sinter-markdown', '@tiaforge-ui/sinter-richtext'] })],
    build: { outDir: dist, emptyOutDir: true },
  });
  server = createServer((req, res) => {
    let path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = readFileSync(join(dist, path));
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
  a.remove();
});

/** a tab on `path` that records every policy violation and console error */
async function open(path: string): Promise<{ page: Page; check: () => Promise<void> }> {
  const p = await browser.newPage();
  const errors: string[] = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    (window as unknown as { __v: string[] }).__v = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.sample}`));
  });
  await p.goto(base + path);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-sn-ready') || !!document.querySelector('textarea'));
  return { page: p, check: async () => {
    expect(await p.evaluate(() => (window as unknown as { __v: string[] }).__v)).toEqual([]);
    expect(errors).toEqual([]);
    await p.close();
  } };
}

const value = (p: Page, sel = 'textarea') => p.$eval(sel, (t) => (t as HTMLTextAreaElement).value);
/** puts the selection on the text, `«` and `»` marking it in `marked` */
async function select(p: Page, marked: string) {
  const start = marked.indexOf('«');
  const end = marked.indexOf('»') - 1;
  await p.focus('textarea');
  await p.$eval('textarea', (t, [s, e]) => (t as HTMLTextAreaElement).setSelectionRange(s!, e!), [start, end]);
}
const selection = (p: Page) => p.$eval('textarea', (t) => {
  const el = t as HTMLTextAreaElement;
  return el.value.slice(0, el.selectionStart) + '«' + el.value.slice(el.selectionStart, el.selectionEnd) + '»' + el.value.slice(el.selectionEnd);
});
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const count = (p: Page) => p.textContent('#count');

test('tabs: the source in the first frame, the preview drawn by md-doc when shown', async () => {
  const { page: p, check } = await open('');
  expect(await value(p)).toBe('# Fish & chips\n\nA short history of *fish & chips*.\n\n- London\n- Lancashire\n');
  expect(await p.$('.preview')).toBeNull(); // not rendered, so not parsed, until it is shown
  expect(await p.$eval('[role=tab][aria-selected=true]', (b) => b.textContent)).toBe('Write');
  await p.click('text=Preview');
  await p.waitForSelector('.preview h1');
  expect(await p.textContent('.preview h1')).toBe('Fish & chips');
  expect(await p.$$eval('.preview li', (l) => l.map((e) => e.textContent))).toEqual(['London', 'Lancashire']);
  expect(await p.isVisible('textarea')).toBe(false);
  expect(await p.isVisible('[role=toolbar]')).toBe(false);
  // back to the source, as it was
  await p.click('text=Write');
  expect(await p.isVisible('textarea')).toBe(true);
  expect(await p.$('.preview')).toBeNull();
  await check();
});

test('keys: Ctrl+B wraps the selection, and one undo takes it back; the model follows each edit', async () => {
  const { page: p, check } = await open('');
  await p.fill('textarea', 'one two three');
  expect(await count(p)).toBe('13 characters');
  await select(p, 'one «two» three');
  await p.keyboard.press(`${MOD}+b`);
  expect(await selection(p)).toBe('one **«two»** three');
  expect(await count(p)).toBe('17 characters');
  await p.keyboard.press(`${MOD}+i`);
  expect(await value(p)).toBe('one **_two_** three');
  await p.keyboard.press(`${MOD}+z`);
  expect(await value(p)).toBe('one **two** three');
  await p.keyboard.press(`${MOD}+z`);
  expect(await value(p)).toBe('one two three');
  expect(await count(p)).toBe('13 characters');
  await p.keyboard.press(`${MOD}+Shift+z`);
  expect(await value(p)).toBe('one **two** three');
  await check();
});

test('keys: Enter continues a list and ends it on an empty item; Tab nests an item, Shift+Tab takes it back', async () => {
  const { page: p, check } = await open('');
  await p.fill('textarea', '');
  await p.keyboard.type('- one');
  await p.keyboard.press('Enter');
  await p.keyboard.type('two');
  await p.keyboard.press('Tab');
  expect(await value(p)).toBe('- one\n  - two');
  expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA'); // Tab stayed in the field
  await p.keyboard.press('Enter');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.type('three');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter'); // an empty item: the list ends
  await p.keyboard.type('after');
  expect(await value(p)).toBe('- one\n  - two\n- three\nafter');
  // Tab outside a list moves focus, as in any field
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  await check();
});

test('the toolbar: a button applies its command and keeps the focus and the selection in the textarea', async () => {
  const { page: p, check } = await open('');
  await p.fill('textarea', 'alpha\nbeta');
  await select(p, '«alpha\nbeta»');
  await p.click('[data-rt-command=bulletList]');
  expect(await selection(p)).toBe('- «alpha\n- beta»');
  expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
  await p.click('[data-rt-command=bulletList]');
  expect(await value(p)).toBe('alpha\nbeta');
  await select(p, '«alpha»\nbeta');
  await p.click('[data-rt-command=link]');
  expect(await selection(p)).toBe('[alpha](«url»)\nbeta');
  await p.keyboard.type('https://example.com');
  expect(await value(p)).toBe('[alpha](https://example.com)\nbeta');
  await p.click('text=Preview');
  await p.waitForSelector('.preview a');
  expect(await p.$eval('.preview a', (e) => [e.getAttribute('href'), e.textContent])).toEqual(['https://example.com', 'alpha']);
  await check();
});

test('pasting a URL over selected text links it', async () => {
  const { page: p, check } = await open('');
  await p.fill('textarea', 'read the docs');
  await select(p, 'read the «docs»');
  await p.$eval('textarea', (t) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://example.com/docs');
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await selection(p)).toBe('read the [docs](https://example.com/docs)«»');
  expect(await count(p)).toBe(`${'read the [docs](https://example.com/docs)'.length} characters`);
  await check();
});

test('split: the preview is live beside the source, with the app\'s fill for links', async () => {
  const { page: p, check } = await open('split.html');
  expect(await p.$$('[role=tab]')).toHaveLength(0);
  expect(await p.textContent('.preview')).toBe(''); // md-doc over an empty draft: the fill, so not the default
  await p.focus('textarea');
  await p.keyboard.type('## Notes\n\nSee [the site](https://example.com).');
  await p.waitForFunction(() => document.querySelector('.preview h2')?.textContent === 'Notes');
  expect(await p.$eval('.preview a', (e) => [e.className, e.textContent])).toEqual(['ext', 'the site ↗']);
  expect(await p.getAttribute('textarea', 'placeholder')).toBe('Write in markdown');
  expect(await p.getAttribute('textarea', 'rows')).toBe('12');
  await check();
});

test('a form: its own toolbar, the comment policy in the preview, the value reset by the page', async () => {
  const { page: p, check } = await open('comment.html');
  expect(await p.$$eval('[role=toolbar] button', (bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual(['Bold', 'Link']);
  expect(await p.$eval('textarea', (t) => [t.hasAttribute('required'), t.getAttribute('maxlength'), t.getAttribute('aria-label')])).toEqual([true, '2000', 'Comment']);
  await p.focus('textarea');
  await p.keyboard.type('# Not a heading');
  await select(p, '# Not a «heading»');
  await p.click('[data-rt-command=bold]');
  expect(await value(p)).toBe('# Not a **heading**');
  await p.click('text=Preview');
  await p.waitForSelector('.preview strong');
  expect(await p.$$('.preview h1')).toHaveLength(0); // headings: 'strong'
  await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#sent')?.textContent === '# Not a **heading**');
  await p.click('text=Write');
  expect(await value(p)).toBe(''); // the page set its state, and the textarea followed
  await check();
});
