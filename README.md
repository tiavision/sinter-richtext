# @tiaforge-ui/sinter-richtext

A markdown editor for [sinter](https://github.com/tiaforge/sinter). The source is in a `<textarea>`,
and a toolbar and keys edit it. The preview is drawn by
[sinter-markdown](https://github.com/tiaforge/sinter/tree/main/packages/sinter-markdown)'s `<md-doc>`
with the app's own fills, so it shows what the page will. The value is the markdown that was typed:
it is what the app stores, and it round-trips exactly.

```html
<main data-sn-state="{ draft: '' }">
  <rt-editor data-sn-model="draft" data-sn-with="{ label: 'Comment' }">
    <md-doc slot="preview" data-sn-with="{ doc: md.parse(draft) }"></md-doc>
  </rt-editor>
</main>
```

## Using it

```sh
npm install @tiaforge-ui/sinter-richtext @tiaforge-ui/sinter-markdown
```

```js
// vite.config.js: both packages are component libraries
sinter({ libraries: ['@tiaforge-ui/sinter-markdown', '@tiaforge-ui/sinter-richtext'] })
```

```ts
// src/sinter.helpers.ts: md.parse for the preview
export * as md from '@tiaforge-ui/sinter-markdown';
```

The editor needs no helpers of its own. `sinter-markdown` is an optional peer: the preview is a slot,
so any display can fill it.

### Props, events, slots

| | |
| --- | --- |
| `value` / `change` | The source. `data-sn-model="draft"` binds it, and every edit sends a `change`: typing, a button, a key, an undo. When the page sets the state (to clear it after sending, say), the textarea follows. |
| `label` | The accessible name of the textarea and the tabs. Required: the editor has no visible label of its own. |
| `layout` | `'tabs'` (the default): Write and Preview in one place. `'split'`: side by side, stacked when narrow, the preview live. |
| `placeholder`, `rows` (default 8), `required`, `disabled`, `maxlength` | The textarea's own attributes. |
| slot `preview` | What Preview shows. It is rendered only while it is shown, so with tabs the markdown is parsed when Preview opens, not on every keystroke. |
| slot `toolbar` | Replaces the buttons. Any element in it with `data-rt-command="…"` runs that command (below), with the same focus handling and undo as the built-in buttons. |

The source is a plain field with no `name`: a sinter form posts state (`data-sn-body="{ body: draft }"`),
not field names.

### Commands and keys

| Command (`data-rt-command`) | Button | Key | What it does |
| --- | --- | --- | --- |
| `bold`, `italic`, `strikethrough` | B, I, S | Ctrl/⌘+B, Ctrl/⌘+I | Toggles `**`, `_`, `~~` around the selection, without the spaces at its ends. With no selection it wraps the word under the cursor, or inserts an empty pair. Over several lines, each line is wrapped after its list marker or quote. |
| `code` | `</>` | Ctrl/⌘+E | Inline `` ` `` on one line of text. A fenced block over several lines or on a blank line, its fence longer than any backticks inside. |
| `link` | Link | Ctrl/⌘+K | `[selection](url)` with `url` selected to type over. A selected URL becomes the destination, with `text` selected. |
| `heading` (`h1`, `h2`, `h3`) | H | | Toggles `## ` (or that level) on the lines. |
| `quote` | “ | | Toggles `> ` on the lines. |
| `bulletList`, `orderedList`, `taskList` | •, 1., ☐ | | Toggles `- `, `1. ` (numbered per indentation), `- [ ] ` on the lines. A list of another kind is converted. |
| `codeBlock` | | | Fences the lines, or unfences them. |
| | | Enter | In a list item, starts the next one: the next number, or an unchecked box for a task. In an empty item, ends the list. In a quote, continues it; on an empty quoted line, ends it. |
| | | Tab, Shift+Tab | On list items: nests the item under the one before it, or moves it back out. Anywhere else Tab moves the focus as in any field. |
| | | Paste | A URL pasted over selected text links that text. |

Each command reaches the textarea as one edit through the browser's own `insertText`, so a single
Ctrl/⌘+Z undoes it, and the undo history mixes typing and commands correctly. The keys leave IME
composition alone. The commands are pure functions of `{ text, start, end }`, exported from the package
for an app's own scripts:

```ts
import { bold, type TextState } from '@tiaforge-ui/sinter-richtext';
bold({ text: 'a b c', start: 2, end: 3 }); // { text: 'a **b** c', start: 4, end: 5 }
```

### A comment form

```html
<form data-sn-state="{ body: '' }" data-sn-post="/api/comments" data-sn-body="{ body }" data-sn-then="body = ''">
  <rt-editor data-sn-model="body" data-sn-with="{ label: 'Comment', required: true, rows: 4 }">
    <span slot="toolbar">
      <button type="button" data-rt-command="bold" aria-label="Bold">B</button>
      <button type="button" data-rt-command="link" aria-label="Link">Link</button>
    </span>
    <md-doc slot="preview" data-sn-with="{ doc: md.parse(body, { headings: 'strong', images: 'link', html: 'text' }) }">
      <a slot="link" rel="nofollow ugc" data-sn-attr="{ href: $slot.node.url }"><slot></slot></a>
    </md-doc>
  </rt-editor>
  <button>Send</button>
</form>
```

The preview uses the same `md.parse` options and fills as the page that shows the comments, so the
preview and the published comment match.

## Why a textarea

The editor edits the markdown source instead of a WYSIWYG document. That keeps it small and exact: the
value is the text the user typed, with nothing serialized back, and the browser handles the cursor,
IME, spellcheck, undo, autofill and accessibility for a textarea as it does for any field.
sinter-markdown's tree has no source positions, by design. A WYSIWYG editor would need its own document
model and a mapping back to markdown, and would lose formatting on the way back.

## The package

```
sinter/
  components/
    rt-editor.html     the markup, the contract (props, events, slots) and the scoped styles
    rt-editor.ts       its script: keys, toolbar clicks and pastes, run as commands on the textarea
  commands.ts          the commands: pure functions of the text and selection
  index.ts             the entry: the commands
  sinter.types.ts      the components' types (none yet)
fixtures/              pages using the editor: tabs, split, a form with its own toolbar
test/
  commands.test.ts     every command, on text written with its selection («»)
  check.test.ts        `sinter check` over the fixture pages: no error, no warning
  browser.test.ts      the fixtures built as an app, in Chromium under a strict CSP and Trusted Types
```

## Developing

The sinter packages are linked from a sinter checkout beside this folder (`file:../sinter`). Build sinter
first (`npm ci && npm run build` there), and install `packages/sinter-markdown`'s own dependencies, since
its parser imports `@tiaforge-ui/sinter/memo` from where it really is.

```sh
npm install          # .npmrc keeps the file: links (install-links=false, legacy-peer-deps for npm 9)
npx sinter check     # the fixture pages; also writes sinter/sinter.components.d.ts
npm run typecheck
npm test
```

`rolldown` is pinned to the version sinter's Vite uses, so that the two copies of Vite's types match
(`plugins: [sinter()]` in the browser test).

## License

MIT
