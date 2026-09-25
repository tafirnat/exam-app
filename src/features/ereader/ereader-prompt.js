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
| \`language\` | ISO 639-1 code of the **source text** (\`de\`, \`en\`, \`tr\`, …). |
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

Do **not** repeat the section's own heading inside \`text\` — the app draws it from \`title\`.

---

## 🖼️ Images

The app never stores image files. For every figure in the source:

- If the figure has a **public absolute \`https://\` URL** in the source (web pages, some EPUBs), write it: \`![Figure 2.1 The service value system](https://…)\`
- Otherwise write a placeholder with the caption printed in the source:
  \`![Figure 2.1 The service value system](placeholder:fig-2-1)\` — id pattern \`fig-<chapter>-<n>\`, unique in the book.
- Put each image on **its own line**. Do not describe the image in words, do not invent a caption, never embed \`data:\` / base64 images.

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
- **EPUB** — usually no page numbers: \`unit: "section"\`, \`from\`/\`to\` count top-level chapters. EPUB images are files inside the archive, not URLs → placeholders. If your interface cannot open EPUB files, ask the user for a PDF or plain-text export.
- **Obsidian note** — every heading is a section. \`![[image.png]]\` embeds become placeholders; \`[[wikilinks]]\` stay as they are.
- **Topic (no source file)** — \`source_type: "topic"\`, \`unit: "section"\`. First plan the chapters, then write them part by part. Here the fidelity rule becomes an **accuracy** rule: state only what is established, and mark uncertain claims with \`> [!warning]\`. Replace the capacity line with: \`Topic: <topic>. Planned chapters: 8. This answer contains chapters 1–3.\`

---

## ✅ Before you answer

- [ ] Exactly one capacity line, then one JSON code block, nothing else
- [ ] JSON parses; only schema keys used
- [ ] Every section of the announced range is present, text complete and untranslated
- [ ] The part ends at a complete section; \`to\`, \`next_from\`, \`is_last\` match
- [ ] Images are \`https://\` URLs or \`placeholder:\` ids, each on its own line
- [ ] No HTML, no \`data:\` images, no summaries
`;
