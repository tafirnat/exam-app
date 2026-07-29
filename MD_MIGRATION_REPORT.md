# Markdown Migration Report

> **Repository**: `Exam App`
> **Objective**: replace hand-authored-HTML content with Markdown that is 100% compatible with Obsidian's own note syntax.
> **Directive**: [MARKDOWN_MIGRATION_PROMPT.md](MARKDOWN_MIGRATION_PROMPT.md)

This report covers two rounds of work:

- **Round 1** (commit `ad233a6`) implemented the migration.
- **Round 2** is an audit of Round 1 against the directive's Acceptance Matrix, plus the fixes for what the audit found. The audit is recorded in full, including the parts Round 1 claimed but had not done — an honest record of the defects is more useful than a clean-looking one.

---

## 1. Acceptance Matrix

| # | Assertion | Round 1 | Now | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| A1 | No HTML in shipped content | pass | **pass** | `grep -rn "<[a-z][a-z0-9]*[ >/]" data/*.json public/examples/*.json` → 0 |
| A2 | Heuristic and format flag gone | pass | **pass** | `grep -rn "isFormattedContent\|format === 'html'" src/` → 0 |
| A3 | Zero new dependencies | pass | **pass** | `package.json` untouched by both rounds; no `dependencies` key |
| A4 | Renderer is escape-first | pass | **pass** | `markdown.test.mjs` test 1 |
| A5 | Only whitelisted tags emitted | pass | **pass** | `markdown.test.mjs` "Tag whitelist enforcement" |
| A6 | Every spec construct implemented and tested | **FAIL** | **pass** | nested lists were unimplemented; see 3.3 |
| A7 | Obsidian fidelity | pass | **pass** | soft break, `%%`, frontmatter, clamp, aliases all tested |
| A8 | Out-of-scope constructs are inert | pass | **pass** | `markdown.test.mjs` test 7 |
| A9 | Render never disagrees with grading | pass | **pass** | `cloze.test.mjs`; plus whole-corpus parity check (5.3) |
| A10 | Global content CSS retired | pass | **pass** | guarded by test, not just grep |
| A11 | Both themes covered by tokens | **FAIL** | **pass** | 30 tokens were `:root`-only; see 3.1 |
| A12 | No literal colour in the content pipeline | **FAIL** | **pass** | 12 hex fallbacks removed; guarded by test |
| A13 | No horizontal page scroll | pass | **pass** | guarded by test |
| A14 | Editor authors Markdown | pass | **pass** | toolbar, `wrapSelection`, shared-renderer preview |
| A15 | i18n complete | pass | **pass** | 9 new keys × `tr`/`en`/`de` = 3 each |
| A16 | Docs consistent | **FAIL** | **pass** | 13 unlabelled HTML examples remained; see 3.4 |
| A17 | Suite and build green | partial | **pass** | output pasted in section 5 |
| A18 | Report is complete and honest | **FAIL** | **pass** | this document |

Two directive requirements outside the matrix also failed and are now fixed: **Step 2 requirement 4** (malformed input must not swallow content — see 3.2) and **Step 2 requirement 2** (code is inviolable — see 3.5).

---

## 2. Inventory of touched files

`R1` = changed in Round 1, `R2` = changed in Round 2.

| File | Role | Class | Round |
| :--- | :--- | :--- | :--- |
| `docs/MARKDOWN_SPEC.md` | Frozen syntax spec | new / edit | R1, R2 |
| `src/core/markdown.js` | Renderer | new / edit | R1, R2 |
| `src/core/markdown.css` | Scoped content styles | new / rewrite | R1, R2 |
| `src/core/cloze.js` | Cloze × Markdown seam | edit | R1, R2 |
| `src/style.css` | Design tokens, retired global rules | edit | R1, R2 |
| `src/features/test/test-ui.js` | Render call sites | edit | R1 |
| `src/main.js` | Preview + search call sites | edit | R1 |
| `src/features/stats/question-editor.js` | Toolbar, `wrapSelection`, preview | edit | R1 |
| `src/features/stats/question-editor.css` | Toolbar/preview styles | edit | R1 |
| `src/features/stats/stats-module.js` | `plainText` for list previews | edit | R1 |
| `src/features/sources/sources-service.js` | Strips legacy `format` on import | edit | R1 |
| `src/core/i18n.js` | 9 toolbar keys × 3 languages | edit | R1 |
| `index.html` | Imports `markdown.css` | edit | R1 |
| `data/reading_feature_guide.json` | Content | edit | R1 |
| `data/software_architecture_reading_test.json` | Content | edit | R1 |
| `data/web_technologies_reading_test.json` | Content | edit | R1 |
| `public/examples/sample-{tr,en,de}.json` | Parallel samples | edit | R1 |
| `AI_AGENT_PROMPT.md` | Generator prompt | edit | R1, R2 |
| `README.md` | Project docs | edit | R1, R2 |
| `public/examples/schema-guide.md` | Schema docs | edit | R1 |
| `tests/markdown.test.mjs` | Renderer tests | new / edit | R1, R2 |
| `tests/markdown-css.test.mjs` | Token, scoping, contrast guards | new | R2 |
| `tests/cloze.test.mjs` | Cloze × Markdown tests | edit | R1, R2 |
| `tests/question-editor.test.mjs` | `wrapSelection`, toolbar wiring | edit | R1 |
| `tests/samples.test.mjs` | HTML guard on shipped JSON | edit | R1 |

---

## 3. What the audit found, and the fix

### 3.1 Dark-mode code was invisible — a live regression (A11)

Round 1 defined 30 new custom properties in `:root` only. The block was even commented `/* Markdown & Callout Tokens (Light Theme) */`, with no `[data-theme="dark"]` counterpart, so both themes resolved to the light values.

The consequence was not cosmetic. `--code-text: #0f172a` on `--code-bg: rgba(15, 23, 42, 0.06)` over the dark page `#0b1120` measures **1.03:1** — code was effectively invisible in dark mode. The retired global rules had handled exactly this, flipping to `#38bdf8` on a slate surface for dark and overriding for light; that behaviour was dropped rather than ported.

**Fix.** A full dark token set in `[data-theme="dark"]`: code flips to light ink on a light wash, and every callout hue steps to its 400-level tint, matching the move `--primary-color` already makes.

Measuring then exposed a second failure of the same requirement (5b: a hue "that stays legible on both `--bg-color` values`") in the *light* theme, which Round 1 had tuned by eye: callout titles are ordinary-size text, and five of the thirteen were below 3:1 — `warning` at **1.94:1**, `success` 2.04, `abstract` 2.16, `tip` 2.25, `bug` 2.80. Light hues moved to the 600/700 level.

Worst pair now, computed over the composited surface: **4.52:1 light, 5.22:1 dark** — every pair clears WCAG AA. This is asserted by `tests/markdown-css.test.mjs`, which composites the alpha tint over the page background and computes the real ratio, so "legible in both themes" is a measurement rather than a claim.

### 3.2 Malformed tables silently deleted content (Step 2 req 4)

The table detector committed to a table on a leading `|` alone, consumed lines while advancing the cursor, and then fell through to the paragraph branch when the row count came up short — with the cursor already past the lines it had eaten.

```
in : "Intro paragraph\n\n| orphan pipe line\n\nAfter paragraph"
out: <p>Intro paragraph</p><p>After paragraph</p>        <- line deleted
```

A two-row pipe block with no delimiter row also lost its second row, consumed as an alignment row: `| a | b |\n| c | d |` produced `<tbody></tbody>`.

**Fix.** A delimiter row is now required before anything is consumed (`isTableDelimiterRow`), and nothing is consumed unless the whole block is accepted. Rejected input falls through to a paragraph intact. Prose containing a pipe is no longer mistaken for a table.

### 3.3 Nested lists were not implemented (A6)

`renderListBlock` ignored indentation entirely and emitted one flat list. `docs/MARKDOWN_SPEC.md` nevertheless promised "(indented for nested lists)" — so the frozen spec advertised a construct the renderer did not have, which Step 1's outcome forbids.

```
in : "- a\n  - a1\n  - a2\n- b"
out: <ul><li>a</li><li>a1</li><li>a2</li><li>b</li></ul>     <- flat
```

**Fix.** `buildListTree` reconstructs depth from indentation (tab = 4 columns), each level takes its `<ul>`/`<ol>` from its own first item, and an indented non-item line is treated as lazy wrapping and joined to the item above instead of becoming a phantom entry. `markdown.css` gained the nesting rules, including `flex-wrap` on `.md-task` so a task item can hold a sub-list.

### 3.4 Step 8 was largely not done (A16)

Round 1 changed 4 lines of `AI_AGENT_PROMPT.md`, 1 of `README.md`, 4 of `schema-guide.md`, and reported the file as *"EDIT — Update AI prompt guidelines and JSON examples to Markdown"*. In fact **12 `<b>`/`<code>` occurrences remained** across the schema examples and the full template, none labelled as prohibited — in the one file whose entire purpose is to be pasted into other AI agents. `README.md` still advertised *"support for HTML tags like `<b>bold text</b>`"*.

**Fix.** All 12 examples converted. Added the explicit prohibition with its one-line reason (the renderer escapes `<`, so a tag reaches the learner as literal text), and a "Write this / Never write this" cheat sheet pointing at `docs/MARKDOWN_SPEC.md`. README gained the Obsidian paste-as-is section the directive asked for.

Verification: all 97 strings in the 13 JSON examples across the three docs were parsed and rendered; none produces an escaped tag. The 17 remaining `<…>` matches in those files are all inside the "Never write this" column or the prohibition rule itself — which is what A16 permits.

### 3.5 Smaller defects, all fixed

| Defect | Was | Now |
| :--- | :--- | :--- |
| `%%` stripped inside code (Step 2 req 2) | `let a = 1; %%x%%` → `let a = 1; ` | comment stripping skips code spans |
| Emphasis nested one way only (2.1) | `**bold *italic* inside**` → `*<em>bold with </em>italic…` | lazy delimiters with `(?=\S)`/`(?<=\S)`; nests both ways |
| Arithmetic became emphasis | — | `2 * 3 and 4 * 5` stays literal, as in Obsidian |
| Escaped backtick ignored (2.1) | `` \` `` opened a code span | inline code is scanned, not regex-matched, so escapes are seen |
| Placeholders were forgeable | author text `__MD_CODE_TOKEN_0__` was **deleted** | placeholders are NUL-delimited and NUL is stripped from input |
| Cloze placeholder was forgeable | `__CLOZE_GAP_SENTINEL_0__` in prose could disturb gap substitution | same NUL scheme; `parseCloze` remains sole authority |
| Heading clamp not separately testable (2.3.2) | private `calculateHeadingDelta` | exported `headingDelta(levels)` / `clampHeadingLevel` |
| Callout rules unscoped (5a) | 13 rules matched `.md-callout` app-wide | scoped under `.md-content`; guarded by test |
| `mark` vs `.search-highlight` conflict (5c) | both yellow, nesting unaddressed | search hit inside a highlight drops its fill and becomes a ring |
| `--text-color` referenced but never defined | silent no-op | removed |
| Lists/tables absorbed into a preceding paragraph | `Intro\n- one` → one `<p>` | `startsBlock` ends the paragraph |

`.search-highlight` was tokenised in the process, which let its `[data-theme="light"]` override collapse into the token pair — consistent with the theme attribute living on `<html>` (commit `0a60c2b`).

---

## 4. Conflicts and judgement calls

- **`__init__` bolds.** The underscore rule blocks intra-word emphasis (`snake_case_name`), so a standalone `__init__` still renders bold. This matches Obsidian, which the directive makes the authority (P1), so it was left alone rather than "fixed" into a divergence. An author who means the identifier writes `` `__init__` ``. Recorded in `docs/MARKDOWN_SPEC.md` §3.6.
- **`%%` inside code.** Directive 2.3.3 says strip `%%` comments; Step 2 requirement 2 says code content is emitted verbatim. These conflict. Resolved in favour of code being inviolable — a `%%` in a snippet is sample text, and deleting part of a code example is the worse failure. Documented in §3.3 of the spec.
- **Round 1 shipped as one commit** despite the directive's "commit in coherent slices". Round 2 is split by concern (tokens/contrast, renderer, docs, tests) as the directive intends.
- **Emphasis is per-line**, so it does not span a soft break. Pre-existing behaviour, left as is; Obsidian is more permissive here. Noted rather than changed, as it affects no shipped content.

---

## 5. Verification

### 5.1 `npm test`

```
1..118
# tests 118
# suites 0
# pass 118
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1850.9105
```

Per file: `markdown.test.mjs` 26, `question-editor.test.mjs` 21, `question-rules.test.mjs` 17, `samples.test.mjs` 17, `cloze.test.mjs` 15, `markdown-css.test.mjs` 9, `grading.test.mjs` 7, `i18n.test.mjs` 4, `service-worker.test.mjs` 2. Round 1 stood at 93; Round 2 added 25, each named for the defect it prevents.

The new CSS guards were confirmed to have teeth by reintroducing the original defects — a `:root`-only `--code-text`, a hex fallback, an unscoped `.md-callout` — and observing exactly three targeted failures before reverting.

### 5.2 `npm run build`

```
vite v5.4.21 building for production...
transforming...
✓ 27 modules transformed.
rendering chunks...
[plugin vite:singlefile]
[plugin vite:singlefile] Inlining: index-CMzp4mu_.js
[plugin vite:singlefile] Inlining: style-CGdsjgio.css
computing gzip size...
dist/index.html  484.55 kB │ gzip: 123.95 kB
✓ built in 531ms
```

Single-file offline bundle intact (P5).

### 5.3 Whole-corpus render

Every author string in all 7 shipped JSON files rendered through `renderMarkdown`, `renderInlineMarkdown` and `plainText`:

```
files: 7  questions: 34  strings rendered: 120
types: single_choice 6, reading 6, multiple_choice 5, flashcard 5,
       true_false 3, short_answer 3, fill_in_the_blank 3, text 2, text_input 1
render errors: none
HTML leaks: none
cloze gap/blank mismatches: none
```

Constructs exercised by real content: heading, callout, highlight, bold, italic, list, quote, fenced code, inline code, table. For every `fill_in_the_blank` question the rendered gap count and order equal `parseCloze(...).blanks` exactly (A9).

### 5.4 Contrast, computed

Worst foreground/surface pair over the composited surface: **light 4.52:1, dark 5.22:1**, against a 4.5:1 threshold, across code, highlight and all 13 callout titles in both themes. Asserted in `tests/markdown-css.test.mjs`.

### 5.5 Not verified

Stated plainly rather than claimed:

- **No browser walkthrough was performed.** The directive's Step 9 asks for one question of every type in both themes, observed in a running app. I did not run one, and no screenshots exist. What replaces it is partial and mechanical: the corpus render (5.3) proves every shipped string parses and renders without error or HTML leakage, and the contrast maths (5.4) settles the specific "is it legible in both themes" question that Round 1 got wrong by eye. Layout, spacing, focus order and scroll behaviour under a real engine remain unobserved.
- **Round 1's own Step 9 claim was unsupported.** Its report asserted the suite and build were green — true, and re-confirmed — but presented no per-type/per-theme observation, and the dark-mode defect in 3.1 would have been caught by the walkthrough it claimed.
- **`task`, `link`, `wikilink`, `strike` and `hr` appear in no shipped content.** They are covered by unit tests, so the renderer is verified; their CSS is not exercised by real content. Step 7's requirement (one callout, one highlight, one task *or* table) is met via table. Adding a task list and a nested list to `data/reading_feature_guide.json` would close this and is the obvious next content change.
- **Deployment.** Recorded in section 6 at push time; live behaviour after deploy is not verified here.

---

## 6. CSS retirement ledger

| Selector | Old location | Disposition | Evidence nothing else needs it |
| :--- | :--- | :--- | :--- |
| `code` | `style.css:1182` (global) | moved into `.md-content code` | `grep -rn "^code\s*{" src/` → 0; guarded by test |
| `pre` | `style.css:1192` (global) | moved into `.md-content pre` | `grep -rn "^pre\s*{" src/` → 0; guarded by test |
| `pre code` | `style.css:1203` (global) | moved into `.md-content pre code` | guarded by test |
| `[data-theme="light"] code/pre/pre code` | `style.css:1214–1229` | deleted; replaced by the `--code-*` token pair | tokens now carry both themes |
| `.stats-item-text pre\|pre code\|code` | `style.css:3291–3320` | deleted as duplicate | `stats-module.js:226` builds its text with `escapeHTML(plainText(...))`, so it emits no code elements to style |
| `[data-theme="light"] .search-highlight` | `style.css:3244` (post-R1) | folded into `--search-highlight-bg/-ring` | only consumers are `markdown.js:780` and `utils.js:103`, both class-only |
| `.md-callout*` (13 rules, unscoped) | `markdown.css` 196–233 | rescoped under `.md-content` | only producer is `markdown.js:524`, always inside the wrapper |

Hard-coded `#38bdf8` / `#0f172a` / `#e2e8f0` from the retired block are now tokens. No hex remains in `markdown.css` (A12), asserted by test.

`.question-text` conflict resolved as the directive required: the prompt keeps `font-size: 1.15rem; font-weight: 600`, and `.question-text .md-content` resets to `font-weight: 400; font-size: inherit`, so rendered headings and lists use their own scale rather than inheriting prompt emphasis.

---

## 7. Round 2 commits

Recorded at push time; see `git log`.
