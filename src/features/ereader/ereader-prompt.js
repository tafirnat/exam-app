/**
 * The prompt a user hands to an outside AI together with a PDF, EPUB, note or
 * topic; the AI answers with the e-Reader JSON that ereader-schema.js reads.
 *
 * Single source: EREADER_AI_PROMPT.md at the repo root is generated from this
 * constant (npm run build:ereader-prompt) and tests/ereader-prompt.test.mjs
 * fails when the two drift apart.
 */
export const EREADER_AI_PROMPT = `# 📖 AI Directive: Converting a Source into an Exam App e-Reader Book

> **Purpose**: Give this prompt to an AI (ChatGPT, Claude, Gemini, …) together with a source — a PDF, an EPUB, an Obsidian note, or just a topic. The AI returns a JSON file that the **e-Reader** in [Exam App](https://github.com/tafirnat/exam-app) can open. Long sources are produced in **parts**; the app joins the parts into one book.

---

## 🎯 Your role

You are a **faithful transcriber**. Your job is to move the text of the source into the JSON below **completely and word for word**. You are not a summariser, an editor or a translator.

---

## ⛔ Output rules

1. **One line, then JSON.** Before the JSON, write exactly one line stating the size of the source and the range you will deliver in this answer (see [Capacity line](#-capacity-line)). After that line, output **only** a single \`\`\`json … \`\`\` code block. No other text before or after.
2. **Valid JSON.** No trailing commas, no comments, every quote and backslash inside strings escaped, newlines inside strings written as \`\\n\`.
3. **No invented keys.** Use exactly the keys in the schema below.
4. **No HTML, ever.** The app shows HTML tags as literal text. Use Markdown.

---

## 🧱 Schema

\`\`\`json
{
  "ereader": {
    "schema": 1,
    "book_key": "itil-4-foundation-axelos-de",
    "title": "ITIL® 4 Foundation",
    "author": "AXELOS",
    "language": "de",
    "source_type": "pdf",
    "part": {
      "unit": "page",
      "from": 1,
      "to": 48,
      "total": 200,
      "next_from": 49,
      "is_last": false
    }
  },
  "sections": [
    {
      "id": "s-1",
      "title": "1. Einführung",
      "level": 1,
      "page_start": 3,
      "text": "Paragraph one …\\n\\nParagraph two …"
    }
  ]
}
\`\`\`

| Key | Rule |
| :--- | :--- |
| \`schema\` | Always \`1\`. |
| \`book_key\` | Lowercase slug of title + author + language, words joined by \`-\`. **If the user gave you a \`book_key\`, copy it exactly.** |
| \`title\`, \`author\` | As printed in the source. Unknown author → \`""\`. |
| \`language\` | ISO 639-1 code of the **source text** (\`de\`, \`en\`, \`tr\`, …). The app reads the book aloud and translates it from this language, so it must be the language the text is actually written in. |
| \`source_type\` | \`pdf\`, \`epub\`, \`obsidian\` or \`topic\`. |
| \`part.unit\` | \`page\` when the source has page numbers, otherwise \`section\` (then \`from\`/\`to\`/\`total\` count top-level chapters). |
| \`part.from\` / \`part.to\` | First and last page (or chapter) **fully** contained in this answer. |
| \`part.total\` | Total pages (or chapters) of the whole source. |
| \`part.next_from\` | First page (or chapter) **not** yet delivered; \`null\` in the last part. |
| \`part.is_last\` | \`true\` only when this part reaches the end of the source. |
| \`sections\` | A **flat** list in reading order. Hierarchy is expressed by \`level\` (1 = chapter, 2 = sub-chapter, …, up to 6). One entry per heading of the source. |
| \`id\` | Unique inside the whole book: \`s-<page>-<n>\` (e.g. \`s-12-1\`), or \`s-<n>\` for sources without pages. |
| \`title\` | The heading exactly as printed, including its numbering. Text before the first heading gets its own entry with \`title: ""\`. |
| \`page_start\` | Page on which the heading appears (omit when \`unit\` is \`section\`). |
| \`text\` | Everything under the heading up to the next heading, as Obsidian Markdown. |

---

## ✍️ Fidelity rules — the most important part

1. **Word for word.** Copy every sentence of the source. Do not summarise, shorten, paraphrase, merge paragraphs or "clean up" wording.
2. **Keep the source language.** Never translate.
3. **Nothing invented.** If a passage cannot be read (scanned image, damaged page), do not guess. Write in its place:
   \`> [!warning] Unreadable\` / \`> Page 34: scanned image, text not extractable.\`
4. **Skip only page furniture**: running headers and footers, page numbers, and the table of contents pages (the app builds its own contents from \`sections\`).
5. **Running out of space? Deliver fewer pages, never less text per page.** See the chunking protocol.

---

## 🧩 Markdown inside \`text\`

Obsidian Markdown only — the full list is in \`docs/MARKDOWN_SPEC.md\` of the Exam App repository.

| Source element | Write |
| :--- | :--- |
| Paragraph | Plain text; paragraphs separated by one empty line (\`\\n\\n\`) |
| Bold / italic | \`**bold**\`, \`*italic*\` |
| List | \`- item\`, \`1. item\`, nested by indentation |
| Table | Markdown pipe table with a \`\\| --- \\|\` row |
| Box: key concept / definition | \`> [!abstract] Title\` then \`> body\` |
| Box: tip / note | \`> [!tip] Title\` … |
| Box: warning / caution | \`> [!warning] Title\` … |
| Box: example / case study | \`> [!example] Title\` … |
| Quotation | \`> text\` |
| Code / command | fenced code block |
| Footnotes | collected at the end of the section's \`text\` as a numbered list under \`**Notes**\` |

Do **not** repeat the section's own heading inside \`text\` — the app draws it from \`title\`. Every heading of the source — sub-headings included — becomes its **own section** with the right \`level\`, never a \`#\` line inside \`text\`: the app builds its contents, folding, bookmarks, read-aloud and translation section by section from these entries.

---

## 🖼️ Images

**Never put an image itself into the book** — no image URLs, no files, no \`data:\` / base64. Every figure, diagram, chart, photo, screenshot or illustration of the source becomes an **image placeholder** at the exact spot where it appears in the source. The reader adds the picture later in the app (from their own device or by URL); the placeholder's text is what lets them find the right figure in the source, so it must identify the figure precisely.

Format — one line on its own, with an empty line before and after:

\`![<caption> | <what the image shows> | p. <page>](placeholder:fig-<chapter>-<n>)\`

| Part | Rule |
| :--- | :--- |
| \`<caption>\` | The caption **exactly as printed** (e.g. \`Figure 2.1 The service value system\`). No printed caption → a short title you write, starting with \`Image:\` (e.g. \`Image: Incident workflow\`). |
| \`<what the image shows>\` | **One sentence** describing the visible content so the figure can be recognised: kind of image + main elements, labels or values (e.g. \`Diagram: five linked boxes — guiding principles, governance, value chain, practices, improvement\`). Describe, do not interpret or add information that is not visible. |
| \`p. <page>\` | Page where the image appears. Omit this part (and the separator before it) when the source has no pages. |
| id | \`fig-<chapter>-<n>\`: chapter number + running number inside the chapter (\`fig-2-1\`, \`fig-2-2\`, …). Unique in the whole book; never reuse an id from an earlier part. |

Rules:

- Separate the parts with \` | \` (space, pipe, space). Never use square brackets \`[\` \`]\` or line breaks inside the alt text — write a bracketed part of a caption with round brackets instead.
- One placeholder per image. An image made of several panels (a, b, c) is one image; describe the panels in the description.
- Text that is printed **inside** an image (labels, a table rendered as a picture) is not transcribed into the body; mention the key labels in the description. A real table of the source stays a Markdown table, not an image.
- Logos, decorative lines and page ornaments are not images — skip them.

Example:

\`\`\`text
![Figure 2.1 The service value system | Diagram: opportunity and demand flow into five linked components and come out as value | p. 34](placeholder:fig-2-1)
\`\`\`

---

## ✂️ Chunking protocol

Long sources do not fit into one answer. Deliver them in parts.

1. **Capacity line.** The single line before the JSON:
   \`Source: ~200 pages. This answer contains pages 1–48 in full (estimated 5 parts).\`
2. **Cut at a heading.** End the part at the last section that is **complete**. Never stop in the middle of a section.
3. **Fill the part fields.** \`from\`, \`to\`, \`total\`, \`next_from\`, \`is_last\` as in the schema.
4. **Never compress to make it fit.** If you notice you cannot fit the range you announced, deliver fewer sections and adjust \`to\` and \`next_from\` — do not shorten text.

### Continuation request

The app gives the user a ready-made message for the next part, in this form:

\`\`\`text
Continue the e-Reader book.
book_key: itil-4-foundation-axelos-de
title: ITIL® 4 Foundation
language: de
unit: page
from: 49
total: 200
\`\`\`

When you receive it: use **exactly** that \`book_key\`, \`title\` and \`language\`, start at \`from\`, and follow every rule above. Section ids must not repeat ids from earlier parts — the page-based pattern \`s-<page>-<n>\` guarantees that.

---

## 📚 By source type

- **PDF** — use the printed page numbers; if the PDF has none, count physical pages from 1.
- **EPUB** — usually no page numbers: \`unit: "section"\`, \`from\`/\`to\` count top-level chapters. Images → placeholders (without \`p.\`). If your interface cannot open EPUB files, ask the user for a PDF or plain-text export.
- **Obsidian note** — every heading is a section. \`![[image.png]]\` embeds become placeholders (use the file name as caption); \`[[wikilinks]]\` stay as they are.
- **Topic (no source file)** — \`source_type: "topic"\`, \`unit: "section"\`. First plan the chapters, then write them part by part. Here the fidelity rule becomes an **accuracy** rule: state only what is established, and mark uncertain claims with \`> [!warning]\`. Replace the capacity line with: \`Topic: <topic>. Planned chapters: 8. This answer contains chapters 1–3.\`

---

## ✅ Before you answer

- [ ] Exactly one capacity line, then one JSON code block, nothing else
- [ ] \`language\` is the language of the text itself; every heading is its own section, no \`#\` lines inside \`text\`
- [ ] JSON parses; only schema keys used
- [ ] Every section of the announced range is present, text complete and untranslated
- [ ] The part ends at a complete section; \`to\`, \`next_from\`, \`is_last\` match
- [ ] Every image of the source is a \`placeholder:fig-…\` line with caption | description | page — no image URLs
- [ ] No HTML, no \`data:\` images, no summaries
`;
