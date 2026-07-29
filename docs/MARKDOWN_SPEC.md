# Exam App Markdown Specification (Obsidian Compatible)

This document defines the authoritative, supported Markdown syntax surface for content in Exam App.
Exam App parses **100% native Obsidian Markdown syntax**. Obsidian is the source of truth for syntax: any note authored in an Obsidian vault can be used directly inside Exam App questions without conversion or loss.

> [!IMPORTANT]
> **No HTML support**: Raw HTML tags (`<div>`, `<b>`, `<br>`, etc.) inside content strings are **never** evaluated. All HTML special characters (`&`, `<`, `>`) are automatically escaped prior to rendering.

---

## 1. Inline Syntax Surface

| Construct | Obsidian Syntax | Emitted HTML Element | Example Input | Rendered Result Example |
| :--- | :--- | :--- | :--- | :--- |
| **Bold** | `**text**` or `__text__` | `<strong>` | `**important**` | **important** |
| *Italic* | `*text*` or `_text_` | `<em>` | `*note*` | *note* |
| ***Bold + Italic*** | `***text***` | `<strong><em>` | `***critical***` | ***critical*** |
| ~~Strikethrough~~ | `~~text~~` | `<del>` | `~~deprecated~~` | ~~deprecated~~ |
| ==Highlight== | `==text==` | `<mark>` | `==key concept==` | <mark>key concept</mark> |
| Inline Code | `` `text` `` | `<code>` | `` `npm test` `` | `npm test` |
| External Link | `[label](https://...)` | `<a target="_blank" rel="noopener noreferrer">` | `[Docs](https://obsidian.md)` | [Docs](https://obsidian.md) |
| Internal Link (Wikilink) | `[[Note]]` or `[[Note\|Alias]]` | `<span class="md-wikilink">` | `[[Architecture\|Arch Guide]]` | Arch Guide |
| Escaped Characters | `\*`, `\_`, `\=`, `\~`, `` \` ``, `\[`, `\\` | Literal character | `\*not italic\*` | \*not italic\* |

> [!NOTE]
> Intra-word underscores (e.g. `snake_case_variable`) do not trigger italics, matching Obsidian's behavior.

---

## 2. Block Syntax Surface

| Construct | Obsidian Syntax | Emitted HTML Element |
| :--- | :--- | :--- |
| **Headings** | `#` through `######` | Clamped `<h2>` through `<h6>` (see Section 3.2) |
| **Unordered List** | `- Item` or `* Item` (indented for nested lists) | `<ul><li>` |
| **Ordered List** | `1. Item` (indented for nested lists) | `<ol><li>` |
| **Task List** | `- [ ] Pending` or `- [x] Completed` | `<li class="md-task"><input type="checkbox" disabled>` |
| **Blockquote** | `> Text` | `<blockquote>` |
| **Callout** | `> [!type] Title` followed by `> ` body lines | `<div class="md-callout md-callout-<type>">` |
| **Fenced Code** | ` ```lang ` ... ` ``` ` | `<pre><code class="language-lang">` (unparsed raw text) |
| **Table** | Pipe table with a required `---` delimiter row & optional `:---:` align | `<table><thead>...<tbody>` |
| **Thematic Break** | `---` or `***` on a single line | `<hr>` |
| **Paragraph** | Text blocks separated by blank lines | `<p>` |

---

## 3. Obsidian Behaviors

### 3.1 Soft Line Breaks
Single line breaks inside paragraphs are preserved as hard line breaks, emitting `<br>` elements (matching Obsidian's default *Strict line breaks = off* setting). Blank lines create separate paragraphs.

### 3.2 Heading Hierarchy Clamping
To prevent content headings from competing with the question title:
1. The relative hierarchy inside the note is preserved.
2. The shallowest heading level in the document is shifted to land on `<h2>`.
3. Lower heading levels scale down accordingly, capping at `<h6>`.

### 3.3 Strip Comments & Frontmatter
- Inline or block comments using `%%comment text%%` are completely stripped from output.
- A `%%` pair **inside inline code or a fenced code block is not a comment** and is emitted verbatim, because code content is never reinterpreted.
- YAML frontmatter blocks bounded by leading `---` lines at the top of a note are automatically removed.

### 3.4 Callout Aliases
Callouts use `> [!type] Title` syntax. Obsidian callout type aliases are normalized to canonical visual styles:

| Canonical Type | Aliases |
| :--- | :--- |
| `note` | `note` |
| `abstract` | `abstract`, `summary`, `tldr` |
| `info` | `info` |
| `todo` | `todo` |
| `tip` | `tip`, `hint`, `important` |
| `success` | `success`, `check`, `done` |
| `question` | `question`, `help`, `faq` |
| `warning` | `warning`, `caution`, `attention` |
| `failure` | `failure`, `fail`, `missing` |
| `danger` | `danger`, `error` |
| `bug` | `bug` |
| `example` | `example` |
| `quote` | `quote`, `cite` |

Unrecognized callout types fall back safely to `note`. Foldable callout markers (`> [!note]-`) parse without error and render in expanded view.

### 3.5 Embedded Note Markers `![[embed]]`
Obsidian note embeds (`![[Note Name]]`) render as a muted placeholder `<span class="md-embed-missing">[[Note Name]]</span>`. Images continue to use the question schema's `content.media` property.

### 3.6 Emphasis Delimiters
Matching Obsidian, a delimiter only opens emphasis when it is followed by a non-space character, and only closes it when preceded by one:

- `2 * 3 and 4 * 5` stays literal — the asterisks are arithmetic, not italics.
- `**bold with *italic* inside**` nests correctly, in either order.
- `snake_case_name` is never italicised, because the underscores are intra-word.

### 3.7 Code Is Never Reinterpreted
Inside inline code and fenced code blocks, content is escaped and emitted exactly as written. That means no emphasis, no links, no callout parsing, no cloze blanks, no comment stripping, and no backslash-escape processing — `` `a\*b` `` shows `a\*b`. Conversely, outside code a backslash escape (`\*`, `\_`, `\=`, `\~`, `` \` ``, `\[`, `\\`) yields the literal character, and an escaped backtick therefore does **not** open a code span.

### 3.8 Nested Lists
Nesting is determined by indentation, not by marker type. A tab counts as four columns, so tab-indented and space-indented notes nest identically. A sub-list may switch between `-` and `1.` freely; each level takes its `<ul>`/`<ol>` from its own first item. An indented line that is not itself a list item is treated as lazy wrapping and joins the item above it.

---

## 4. Out-of-Scope Syntax Surface (Inert Literal Text)

The following constructs are intentionally out of scope for Exam App. They are safe and render verbatim as harmless literal text without throwing errors:
- LaTeX / Math (`$inline math$` and `$$block math$$`)
- Footnotes (`[^1]`)
- Inline Tags (`#tag`)
- Collapsible details / interactive HTML elements
- Any raw HTML markup (automatically escaped to plain text)
