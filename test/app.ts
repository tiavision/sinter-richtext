// A throwaway app that uses the package as an app does: installed in node_modules (links to this folder
// and to the sinter and sinter-markdown beside it), named in `sinter({ libraries })`, its pages the
// fixture pages, its helpers and types modules theirs.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const PKG = resolve(import.meta.dirname, '..');
const linked = (name: string) => realpathSync(join(PKG, 'node_modules/@tiaforge-ui', name));

/** a new app folder with the fixture pages (`head` added to each page's head) and `files`; `remove()` deletes it */
export function app(head = '', files: Record<string, string> = {}): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sinter-richtext-app-'));
  const fixtures = Object.fromEntries(readdirSync(join(PKG, 'fixtures')).map((f) => {
    const s = readFileSync(join(PKG, 'fixtures', f), 'utf8');
    return f.endsWith('.ts') ? [`src/${f}`, s] : [f, s.replace('<meta charset="utf-8">', `<meta charset="utf-8">${head}`)];
  }));
  for (const [f, s] of Object.entries({ ...fixtures, ...files })) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), s);
  }
  mkdirSync(join(root, 'node_modules/@tiaforge-ui'), { recursive: true });
  symlinkSync(PKG, join(root, 'node_modules/@tiaforge-ui/sinter-richtext'), 'dir');
  for (const n of ['sinter', 'sinter-markdown']) symlinkSync(linked(n), join(root, 'node_modules/@tiaforge-ui', n), 'dir');
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}
