# Implementation Directive — Migrate Exam App Content to 100% Obsidian-Compatible Markdown

> **Audience**: the implementing AI agent.
> **Repository**: `Exam App` (vanilla ES modules + Vite, zero runtime dependencies, single-file build).
> **Nature of this document**: an authoritative work order. Every step below states a *goal*, the *subtasks you are expected to derive*, and a *concrete, checkable outcome*. A reviewing agent will later audit the result against the Outcome lines and the Acceptance Matrix at the end. Do not consider the task done until every Outcome is literally true.

---

## 1. Mission

Replace the app's current hand-authored-HTML content format with **Markdown that is 100% compatible with Obsidian's own note-taking syntax**, so that a note written in an Obsidian vault can be moved into an Exam App question — by a human or by an AI — with no translation step and no loss.

The user authors notes in Obsidian. Obsidian is therefore the *source of truth for syntax*. The app is a consumer of that syntax, never a definer of it.

### 1.1 Non-negotiable principles

| # | Principle |
| :--- | :--- |
| P1 | **No invented syntax.** If Obsidian does not support a construct natively, the app does not support it either. You may not introduce custom markers (no `==red: text==`, no `{color}`, no shortcodes). |
| P2 | **No HTML anywhere in content.** Content strings are Markdown only. The renderer escapes `&`, `<`, `>` before emitting anything, so raw HTML in a JSON file renders as visible literal text, never as markup. Legacy HTML content has no value and is to be converted, not supported. |
| P3 | **Zero new runtime dependencies.** No `marked`, no `markdown-it`, no `DOMPurify`. The supported subset is small and closed; hand-write the renderer. `devDependencies` may not grow either unless a test genuinely requires it. |
| P4 | **Colour is semantic, never literal.** The only colour mechanisms are Obsidian callout types and `==highlight==`. Every colour resolves through a CSS custom property that has a value in both themes. No hard-coded hex in the content pipeline. |
| P5 | **The single-file build must keep working.** `npm run build` (vite + vite-plugin-singlefile) must still produce a working offline `dist/`. |
| P6 | **Match the existing codebase voice.** Look at `src/core/cloze.js`: modules open with a block comment explaining *why the module exists and who depends on it*, not what each line does. Follow that. Same for naming and file layout. |

---

## 2. The supported syntax surface (this is the spec — implement exactly this)

Everything in this section is native Obsidian syntax. Anything not listed is **out of scope** and must survive as literal text (see 2.4).

### 2.1 Inline

| Construct | Obsidian syntax | Emitted element |
| :--- | :--- | :--- |
| Bold | `**text**`, `__text__` | `<strong>` |
| Italic | `*text*`, `_text_` | `<em>` |
| Bold + italic | `***text***` | `<strong><em>` |
| Strikethrough | `~~text~~` | `<del>` |
| Highlight | `==text==` | `<mark>` |
| Inline code | `` `text` `` | `<code>` |
| External link | `[label](https://…)` | `<a rel="noopener noreferrer" target="_blank">` |
| Internal link | `[[Note name]]`, `[[Note name\|alias]]` | non-navigable `<span class="md-wikilink">` showing the alias when present, otherwise the note name |
| Escapes | `\*`, `\_`, `\=`, `\~`, `` \` ``, `\[`, `\\` | the literal character, unformatted |

Nesting must work in both directions (`**bold with `code`**`, `==highlight with *italic*==`). Emphasis inside a word (`snake_case_name`) must **not** turn into italics — match Obsidian's behaviour here.

### 2.2 Block

| Construct | Obsidian syntax | Emitted element |
| :--- | :--- | :--- |
| Headings | `#` … `######` | `<h1>`…`<h6>`, then clamped (see 2.3) |
| Unordered list | `- `, `* ` (nesting by indent) | `<ul><li>` |
| Ordered list | `1. ` (nesting by indent) | `<ol><li>` |
| Task list | `- [ ] `, `- [x] ` | `<li class="md-task">` with a **disabled** `<input type="checkbox">` |
| Blockquote | `> ` | `<blockquote>` |
| Callout | `> [!type] Optional title` + `> ` body lines | `<div class="md-callout md-callout-<type>">` with title and body parts |
| Fenced code | ` ```lang ` … ` ``` ` | `<pre><code class="language-lang">` — contents never parsed for Markdown |
| Table | pipe table with `---` delimiter row, `:---:` alignment | `<table>` with `<thead>`/`<tbody>` |
| Thematic break | `---`, `***` on their own line | `<hr>` |
| Paragraph | blank-line separated | `<p>` |

### 2.3 Obsidian behaviours you must reproduce exactly

1. **Soft line breaks are real breaks.** Obsidian ships with *Strict line breaks* **off**, so a single newline inside a paragraph renders as a line break. Emit `<br>`. A blank line starts a new paragraph.
2. **Heading clamp.** The question card already provides the top-level title, so a content `#` must not compete with it. Parse the real level, then shift the whole document so its shallowest heading lands on `<h2>`, capping at `<h6>`. Relative hierarchy inside the note is preserved; absolute level is normalised. This must be a pure function so it is unit-testable on its own.
3. **`%%comment%%` is stripped**, inline and as a block. Author-only notes must never reach the reader.
4. **YAML frontmatter is stripped** when the string opens with a `---` line and a later `---` line closes it. Pasting a whole Obsidian note must not dump metadata into the question.
5. **Callout aliases.** Accept Obsidian's alias sets and normalise them to one canonical class each. Support at minimum:
   `note` · `abstract|summary|tldr` · `info` · `todo` · `tip|hint|important` · `success|check|done` · `question|help|faq` · `warning|caution|attention` · `failure|fail|missing` · `danger|error` · `bug` · `example` · `quote|cite`.
   An unknown type falls back to `note` rather than breaking the block. Foldable markers (`> [!note]-`) parse without error; folding behaviour itself is out of scope, render expanded.
6. **`![[embed]]`** cannot be resolved without a vault. Render the target name as a muted `md-embed-missing` span; never emit a broken `<img>`. (Real images continue to use the schema's `content.media`, which this migration does not touch.)

### 2.4 Deliberately out of scope — must render as literal, harmless text

`$math$` / `$$block math$$`, footnotes (`[^1]`), inline `#tag`, `> [!note]` folding state, comment blocks other than `%%`, HTML of any kind. These must appear verbatim on screen and must never throw, never swallow surrounding content, and never emit an element.

---

## 3. Steps

Each step is a unit of work. Decompose it into subtasks yourself; the Outcome line is what will be audited.

### Step 0 — Recon

**Goal**: know every place content is parsed, rendered, styled, authored, documented, or tested before changing anything.

Subtasks to derive: enumerate render call sites, CSS rules that style content elements, JSON files whose strings contain markup, docs describing the format, and tests asserting on it. Use `grep` for `innerHTML`, `isFormattedContent`, `format`, `escapeHTML`, and for `<[a-z]` inside `data/*.json` and `public/examples/*.json`.

Known starting points (verify, do not trust blindly — line numbers drift):

- Render: [src/features/test/test-ui.js](src/features/test/test-ui.js) ≈149–155 (question text), ≈269–270 (explanation), ≈405 (option text, currently fully escaped); [src/main.js](src/main.js) ≈373–374 (preview), ≈638–639 (preview explanation).
- The heuristic to delete: `const isFormattedContent = … || q.format === 'html' || /<[a-z][\s\S]*>/i.test(rawQText)`. It misclassifies ordinary text containing `List<String>` or `a<b` as HTML and silently deletes it. It goes away completely, along with every read of `q.format`.
- Cloze: [src/core/cloze.js](src/core/cloze.js) — `parseCloze`, `clozeMarkup(text, escape)`.
- CSS: [src/style.css](src/style.css) ≈1160 `.question-text`, ≈1182–1227 global `code` / `pre` / `pre code` + `[data-theme="light"]` overrides, ≈3234–3245 `.search-highlight`, ≈3291–3320 `.stats-item-text pre|code` (a duplicate of the global block).
- Editor: [src/features/stats/question-editor.js](src/features/stats/question-editor.js) ≈29 `renderClozePreview`, ≈257 body textarea, ≈348 option textarea, ≈512 explanation textarea, ≈702 `wrapCodeSelection`.
- i18n: [src/core/i18n.js](src/core/i18n.js) — three parallel blocks, `tr` ≈18, `en` ≈394, `de` ≈770. Every new key must exist in all three.
- Content carrying HTML today: `data/reading_feature_guide.json`, `data/software_architecture_reading_test.json`, `data/web_technologies_reading_test.json`, `public/examples/sample-{tr,en,de}.json`.
- Docs: [AI_AGENT_PROMPT.md](AI_AGENT_PROMPT.md), [README.md](README.md), [public/examples/schema-guide.md](public/examples/schema-guide.md).
- Tests: [tests/](tests/) — `samples.test.mjs`, `cloze.test.mjs`, `question-editor.test.mjs` are the likely touch points.

**Outcome**: `MD_MIGRATION_REPORT.md` exists at repo root and opens with an inventory table: every file you will touch, its role, and the change class (`rewrite` / `edit` / `delete` / `new`). Nothing outside this table gets modified later without the table being updated.

---

### Step 1 — Freeze the spec as a document

**Goal**: one authoritative, human-readable syntax reference that both the app's users and future AI generators read.

Create `docs/MARKDOWN_SPEC.md` from section 2 of this directive: the supported table, the Obsidian behaviours, the out-of-scope list, and one short "this is what it looks like in the app" example per construct. State plainly that the format is Obsidian Markdown and that HTML is not supported.

**Outcome**: `docs/MARKDOWN_SPEC.md` exists and every construct in section 2.1/2.2 appears in it with its exact syntax. No construct appears there that the renderer does not implement, and none is missing.

---

### Step 2 — The renderer

**Goal**: `src/core/markdown.js` — a dependency-free Markdown → HTML renderer for exactly the spec surface.

Required public API (name things as you see fit, but the three capabilities must be separable):

- `renderMarkdown(text)` → block-level HTML. Used for question bodies, explanations, reading cards.
- `renderInlineMarkdown(text)` → inline-only HTML, no `<p>`/`<h*>`/lists/tables. Used for option text and any single-line label.
- `plainText(text)` → all formatting removed. Needed for search matching, sorting, and truncated list previews so that `**Bold**` does not leak asterisks into UI chrome.

Implementation requirements:

1. **Escape first, structure second.** `&`, `<`, `>` are escaped before any element is emitted. The output tag set is a closed whitelist — assert it in a test.
2. **Fenced and inline code are inviolable.** Their contents are escaped and emitted verbatim: no emphasis, no links, no cloze markers, no callout parsing inside them.
3. **Pure functions, no DOM.** The module must be importable and unit-testable under plain `node --test` without jsdom.
4. **Never throw.** Malformed input (unclosed fence, ragged table, `> [!` with no closing bracket, lone `==`) degrades to sensible text output. Fuzzing it with truncated fragments of valid documents must not produce an exception.
5. **Links are constrained.** Only `http:`, `https:`, and `mailto:` survive as `<a>`; anything else (notably `javascript:`) renders as literal text.

**Outcome**: `npm test` passes with a new `tests/markdown.test.mjs` that covers every row of the 2.1 and 2.2 tables, every behaviour in 2.3, every item in 2.4, plus the five requirements above. A test asserting that `<script>alert(1)</script>` in the input appears as visible text and produces no `<script>` element is mandatory.

---

### Step 3 — Cloze × Markdown

**Goal**: fill-in-the-blank questions render their gaps correctly inside Markdown, and rendering can never disagree with grading.

The invariant: **`parseCloze` remains the sole authority on what a blank is.** The renderer must emit exactly the blanks `parseCloze` reports, in the same order, with the same indices — because [src/features/test/test-engine.js](src/features/test/test-engine.js) grades by index.

Approach: protect each `{{…}}` marker with a sentinel that cannot survive as text or be mangled by inline parsing, render Markdown, then substitute the numbered gap spans back in. Do not run Markdown over the marker contents. Replace `clozeMarkup`'s `escape`-callback design — it exists only to let callers choose between escaping and trusting raw HTML, a choice that no longer exists.

**Outcome**: `tests/cloze.test.mjs` proves that (a) a cloze sentence with `**bold**` around a blank renders both correctly, (b) `{{x}}` inside a fenced code block or inline code does **not** become a gap, and (c) for a corpus of cloze sentences the gap count and order in the rendered HTML equal `parseCloze(...).blanks` exactly. Existing grading tests still pass unmodified.

---

### Step 4 — Migrate the render call sites

**Goal**: one rendering path, no heuristics, no format flag.

Subtasks: route question text, explanations, and reading bodies through `renderMarkdown`; route option text through `renderInlineMarkdown` (options gain inline formatting — this is an intended improvement over today's blanket `escapeHTML`); route search/preview/list-truncation text through `plainText`; delete `isFormattedContent` and every read of `q.format`; check `src/core/migration.js` and `src/features/sources/sources-service.js` for a `format` field to strip on import.

Wrap all rendered output in a single scope class — use `md-content` — so CSS can target rendered elements without leaking into app chrome.

**Outcome**: `grep -rn "isFormattedContent\|format === 'html'" src/` returns nothing. Every `innerHTML` assignment that receives author content is fed by a `markdown.js` function; no call site passes an author string to `innerHTML` unrendered. Search-highlighting still works on question text.

---

### Step 5 — CSS

**Goal**: rendered Markdown looks deliberate in both themes, styles live in one scoped place, and rules made obsolete by this migration are removed rather than orphaned.

This step is not optional polish; the user called it out explicitly. Four parts:

**5a. New scoped stylesheet.** Create `src/core/markdown.css` (imported the same way the project imports its other feature CSS — check `src/main.js` and the existing `question-editor.css`/`import-report.css` pattern and match it). Every rule is scoped under `.md-content`. Cover: `h2`–`h6` (a real, restrained type scale), `p`, `strong`, `em`, `del`, `mark`, `code`, `pre`, `a`, `ul`/`ol`/`li` including nesting, `.md-task`, `blockquote`, `table`/`th`/`td`, `hr`, `.md-callout` and its per-type variants, `.md-wikilink`, `.md-embed-missing`. Include `:first-child`/`:last-child` margin collapsing so a rendered block does not add stray space inside a card.

**5b. Tokens.** Callout colours and the `mark` background must be new custom properties defined in **both** `:root` (light) and `[data-theme="dark"]` in [src/style.css](src/style.css). Note the theme attribute lives on `<html>` (see commit `0a60c2b`) — do not reintroduce a `body`-scoped selector. Reuse the existing vocabulary where it fits (`--primary-color`, `--success-color`, `--error-color`, `--warning-color`, `--note-color`, `--text-secondary`, `--border-color`, `--radius-md`) and add only what is genuinely missing. Each callout type needs a border/icon hue and a low-alpha surface tint that stays legible on both `--bg-color` values.

**5c. Retire and repoint the old rules.** The global element selectors `code`, `pre`, `pre code` at ≈1182–1227 currently style the *entire application*, and `.stats-item-text pre|code` at ≈3291–3320 is a near-duplicate of them. Both were written for hand-authored HTML. Move the styling into the `.md-content` scope, apply `md-content` to the stats item container so it inherits instead of duplicating, and delete what is left over. Their hard-coded `#38bdf8` / `#0f172a` / `#e2e8f0` values must become tokens in the process.

Also resolve two conflicts:

- `.question-text` sets `font-size: 1.15rem; font-weight: 600` (≈1160). A rendered heading or list must not inherit prompt weight. Decide and document one rule: the question *prompt* keeps its emphasis, everything the renderer emits below it uses normal weight and its own scale.
- `<mark>` from `==highlight==` and `.search-highlight` (≈3234) are both yellow-ish and **will nest** when a user searches for a highlighted word. Give them distinguishable treatments and verify the nested case is still readable in both themes.

**5d. Dead-rule sweep.** After Step 7's content conversion, any CSS rule whose only purpose was styling hand-authored HTML is dead. Find them with evidence (`grep` for the selector across `src/`, `index.html`, and the JSON corpus) and delete them. Do not leave commented-out blocks.

**Outcome**: `MD_MIGRATION_REPORT.md` contains a CSS section listing, per rule you removed or moved, the selector, its old location, and the grep output proving nothing else needs it. `grep -n "^code\s*{\|^pre\s*{" src/style.css` returns nothing. No hex literal remains in `markdown.css` outside the token definitions. Rendered content is legible in light and dark, and `pre`/`table` scroll inside themselves so no card ever scrolls the page horizontally.

---

### Step 6 — The editor

**Goal**: a human authoring a question in the app writes the same Markdown they write in Obsidian, sees it rendered before saving, and is never asked to type an angle bracket.

Subtasks: generalise `wrapCodeSelection` (≈702) into a reusable `wrapSelection(textarea, before, after)` and build a compact toolbar above each content textarea (body ≈257, options ≈348, explanation ≈512) with the constructs that are actually used often: **bold**, *italic*, `code`, `==highlight==`, list, heading, link, callout. Options get the inline-only subset — no heading, no list, no callout. Add a live preview using the same renderer as the test view, so what the author sees is what the learner gets; the existing `renderClozePreview` (≈29) is the natural place to host it. Every new label and tooltip needs a key in all three i18n blocks.

**Outcome**: `npm test` passes with `tests/question-editor.test.mjs` extended to cover `wrapSelection` (including the collapsed-selection case, where the caret must land between the markers) and toolbar-to-textarea wiring. `grep -c` for each new i18n key returns 3. No `<code>`-literal insertion remains anywhere in the editor.

---

### Step 7 — Convert the content corpus

**Goal**: not one HTML tag left in shipped content.

Convert all six files listed in Step 0 from HTML to Markdown by hand or by script — but *review every result*, because these files are the app's worked examples and their prose is intentional. `<h3>` → `##` after clamping, `<ul><li>` → `- `, `<strong>` → `**`, `<code>` → backticks, `<blockquote>` → `>`. Where the original prose was using a blockquote as an aside, prefer the callout that matches its intent — these files are the showcase for the new format and should demonstrate it, including at least one callout, one highlight, and one task or table so the CSS is exercised by real content.

The three `sample-{tr,en,de}.json` files are parallel translations; keep them structurally identical to each other.

**Outcome**: `grep -rn "<[a-z][a-z0-9]*[ >/]" data/*.json public/examples/*.json` returns nothing. Every file still parses as JSON, still imports into the app, and `tests/samples.test.mjs` passes — extended with a guard test that fails if any shipped JSON string ever contains an HTML tag again.

---

### Step 8 — Documentation

**Goal**: the generator prompt and the user-facing docs describe Markdown, and nothing anywhere still tells an author to write HTML.

- [AI_AGENT_PROMPT.md](AI_AGENT_PROMPT.md): rewrite the formatting rule (currently rule 4, "HTML in Strings", plus every `<b>`/`<code>`-bearing example in the schema section and the full template) to mandate Obsidian Markdown. Add an explicit prohibition on HTML with a one-line reason, and a compact syntax table pointing to `docs/MARKDOWN_SPEC.md`. Because this file exists to be pasted into other AIs, the examples must be exemplary — every JSON string in it must be valid Markdown under the new spec.
- [README.md](README.md): update the content-format section, and mention the Obsidian workflow — a note can be pasted in as-is.
- [public/examples/schema-guide.md](public/examples/schema-guide.md): same treatment.

**Outcome**: `grep -rn "<b>\|<code>\|<h3>\|inline HTML" AI_AGENT_PROMPT.md README.md public/examples/schema-guide.md` returns only occurrences that are deliberately showing what *not* to do, and each such occurrence is visibly labelled as prohibited.

---

### Step 9 — Verify end to end

**Goal**: evidence, not assertion.

Run `npm test` and `npm run build`. Then actually open the app (`npm run dev`) and walk one question of **every** type — reading, single_choice, multiple_choice, true_false, short_answer, fill_in_the_blank, flashcard, topic_review — in **both** themes, from `public/examples/sample-en.json`. Confirm: formatting renders, callouts are coloured, code blocks scroll rather than overflow, cloze gaps are numbered and gradeable, options show inline formatting, search highlighting still works over rendered text, and the editor preview matches the test view.

**Outcome**: `MD_MIGRATION_REPORT.md` has a verification section with the real, pasted output of `npm test` and `npm run build`, plus a per-type / per-theme checklist marked from actual observation. Screenshots if your tooling can produce them. Anything you could not verify is listed as unverified — do not claim it.

---

### Step 10 — Ship

Per [.agents/AGENTS.md](.agents/AGENTS.md), this project deploys from `main`: build, commit, and push to `origin main` once Step 9 is green. Live testing depends on the deployment, so a local-only result is an incomplete task. Use a conventional-commit message consistent with the repo's history (`feat(content): …`). Do not skip hooks.

**Outcome**: `git status` clean, `git log origin/main -1` shows your commit, the deployed site serves the migrated content.

---

## 4. Acceptance Matrix

The reviewing agent will check these directly. Each row must be true and independently verifiable.

| # | Assertion | How it is checked |
| :--- | :--- | :--- |
| A1 | No HTML in shipped content | `grep -rn "<[a-z][a-z0-9]*[ >/]" data/*.json public/examples/*.json` → empty |
| A2 | Heuristic and format flag gone | `grep -rn "isFormattedContent\|format === 'html'" src/` → empty |
| A3 | Zero new dependencies | `package.json` `dependencies` still absent/empty; `devDependencies` unchanged |
| A4 | Renderer is escape-first | test proves `<script>` input yields literal text, no element |
| A5 | Only whitelisted tags emitted | test asserts the output tag set against an explicit list |
| A6 | Every spec construct implemented and tested | each row of 2.1/2.2 has a case in `tests/markdown.test.mjs` |
| A7 | Obsidian fidelity | soft break → `<br>`; `%%comment%%` and frontmatter stripped; heading clamp; callout aliases — all tested |
| A8 | Out-of-scope constructs are inert | math, footnotes, `#tag` render literally without throwing |
| A9 | Render never disagrees with grading | cloze gap count/order equals `parseCloze` blanks, tested |
| A10 | Global content CSS retired | `grep -n "^code\s*{\|^pre\s*{" src/style.css` → empty; `.stats-item-text` duplicates gone |
| A11 | Both themes covered by tokens | every new custom property has a value in `:root` **and** `[data-theme="dark"]` |
| A12 | No literal colour in the content pipeline | no hex in `markdown.css` outside token definitions |
| A13 | No horizontal page scroll | `pre` and `table` scroll within `.md-content` |
| A14 | Editor authors Markdown | toolbar present, preview uses the same renderer, no HTML insertion remains |
| A15 | i18n complete | every new key present in `tr`, `en`, and `de` |
| A16 | Docs consistent | `AI_AGENT_PROMPT.md`, `README.md`, `schema-guide.md` describe Markdown; all their examples are valid under the spec |
| A17 | Suite and build green | pasted `npm test` and `npm run build` output in the report |
| A18 | Report is complete and honest | `MD_MIGRATION_REPORT.md` covers Steps 0–10, and unverified items are labelled as such |

---

## 5. Working rules

- **Sequence matters.** Steps 2–3 before 4; 4 before 5c/5d (you cannot prove a rule is dead while a call site still needs it); 7 before the 5d sweep.
- **Commit in coherent slices**, not one giant commit — renderer, call sites, CSS, content, docs.
- **If you find a conflict between this directive and the code**, do not silently pick one. Implement the rest, and record the conflict in the report with your reasoning and what you chose.
- **If a step is blocked**, finish every other step in full and say explicitly in the report what you left out and why. Do not narrow the scope on your own.
- **Do not touch** the FSRS scheduler, the grading logic beyond the cloze rendering seam, the question schema's field names, `content.media`, or the GitHub sync mechanism. This migration is about the content *format* only.
