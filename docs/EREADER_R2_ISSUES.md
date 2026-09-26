# e-Reader & Test — Round 2 Issues (R2-01 … R2-12)

User-reported problems after the F1–F10 + D1–D4 e-Reader work. Each item is
fixed in its own commit, in order. Status: `open` → `done` (commit hash).

> The ITIL source book used as the behavioural reference lives only on the
> user's disk. It is copyrighted: **never commit it or any text from it.**
> Only structure/behaviour notes may be written here.

---

## R2-01 — Search button: header, top-right, focused overlay

- The search button sits in the header, top-right.
- Clicking it opens a **focused search** (overlay/spotlight: dimmed page, input
  on top, results under it) as in the reference, instead of an inline bar.
- Keyboard-shortcut hints are shown **only on desktop**; mobile stays clean.

Status: done

## R2-02 — No chapter paging; one continuous scroll with windowed DOM

- Remove chapter paging (`#ereaderChapterNav`, prev/next, "n / m"). It was never
  asked for.
- The whole book scrolls in one view. To keep the DOM small, sections are
  mounted/unmounted in windows around the viewport (same idea as the question
  list), with placeholders keeping the scroll height.
- Add a floating **Top / Up** button: click → nearest section heading above the
  reading line; **Ctrl+click** (⌘ on macOS) → start of the book. On mobile it may
  go only to the chapter (top-level heading) above.

Status: open

## R2-03 — Contents (Inhalt) behaviour and look

- Clicking a contents entry does **not** close the side menu (the user may be
  looking for a section). The menu closes when the reading area is clicked.
- No dark background on items; plain look. The active entry gets a soft,
  theme-coloured (light) highlight. Thin soft separators between entries
  (like `#section-timer`).
- Tree: h1 / h2 / h3. Initially only h1 visible. Clicking an h1 expands its
  children (if any) **and** scrolls to that heading.

Status: open

## R2-04 — Side menu header removed

- Remove the `menu_title` ("MENÜ") heading and `#menuCloseBtn`. The menu closes
  by clicking outside; the row only wastes space.

Status: open

## R2-05 — Library view vertically centred

- `#ereaderLibraryView` is vertically centred when it fits in the viewport;
  when taller it starts at the top as now.

Status: open

## R2-06 — Test stats filter overflows its card

- `.stats-filter-container.has-border` overflows the parent card even on a
  laptop; labels wrap to a second line.
- If there is not enough width, use the mobile behaviour (icons only, the
  active one shows its label) — decided by the real available width, not by a
  fixed breakpoint.
- On mobile the active item's label still overflows (except "All"): there, all
  items are icon-only; the clicked item's name is shown for a moment in
  `#headerTitle` (smaller font, soft colour) and then the header title returns.
- `#statsSortBar` is fine — unchanged.

Status: open

## R2-07 — Duplicate back button / title inside cards; e-Reader header title

- `#sourcesView`: `#sourcesBackBtn` and the card title duplicate the main
  header → remove them from the card (and the same duplication elsewhere).
  Back handling (history / Esc / header back) keeps working.
- e-Reader: the main header always reads **e-Reader** (library and book).
- `#ereaderLibraryView`: the icon and the heading are aligned with the heading
  line, not pushed by the book-count line.

Status: open

## R2-08 — e-Reader side menu: only Settings + Contents

- The e-Reader side menu shows exactly two entries: **Contents** and
  **Settings** (gear icon). Nothing else (no "My books" button, no
  `#ereaderReadingMenuSection` as it is).
- Contents is open by default. Settings must be chosen explicitly.
- `#menuEreaderReset` (affects all books) appears only while Settings is the
  active entry — never in contents / reading mode.

Status: open

## R2-09 — Header tools: Aa+ font cycle and a save icon

- `#ereaderHeaderTools` gets an **Aa+** icon: each press cycles the reading
  text size through 3 steps — smaller → normal (Exam App default) → larger →
  smaller … Only the reading area changes; no extra bar or panel.
- A save icon is present in the header tools as well.

Status: open

## R2-10 — Paragraph actions like the reference (TTS, summary, vocab, translate)

- Per paragraph, one action group (`.p-actions-group`): TTS (book language),
  summary / core idea, vocabulary & terms, translate.
- The result of any action opens **in one box directly under the paragraph**
  (`.p-translation-box`, `data-view-mode` = translate | summary | vocab), not in
  separate places. Box header actions: Copy, Retry, Hide.
- Design and behaviour follow the reference markup given by the user.

Status: open

## R2-11 — Book management like the sources card

- `#ereaderLibraryCard` gets the source management of `#sourcesCard`:
  folders, moving between folders, ordering, multi-select inside a folder and
  bulk edit.
- Per book, the actions button (like `title="Quellenaktionen"`) offers:
  edit metadata, download, share, print, delete, archive, reset (progress).
- Buttons behave like their counterparts in the test sources.

Status: open

## R2-12 — "Connect AI" entry under the AI menu section

- Under `data-section="ai"` (test side menu) add a new button: connect an AI
  service (API or local).
- Opens a modal. **Local AI**: configure a local model through a proxy / an
  OpenAI-compatible endpoint, as the reference does. **Cloud**: "coming soon".
- The existing AI section (web use without API) stays as it is.

Status: open

---

## Questions for Antigravity (reference inspection)

These need the local reference file; answers go into this file, **without**
copying book text.

1. R2-01: the reference search overlay — markup/CSS of the focused search
   (backdrop, width, position, result row layout) and which shortcuts it shows.
2. R2-02: the reference "up" button — position, icon, when it appears, how the
   target heading is chosen, behaviour on mobile.
3. R2-10: how the summary and vocabulary prompts are built, which endpoint is
   called, and how results are cached per paragraph.
4. R2-12: the local AI proxy — URL/port, request format (OpenAI
   `/v1/chat/completions`? Ollama `/api/chat`?), model selection, how the proxy
   is started, CORS handling.
