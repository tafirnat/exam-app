# R2 — Claude's plan (the part that needs no reference book)

Branch: `claude/sweet-darwin-9ax5zn` only. `main` is live and is not touched.
Antigravity works on the same branch (docs/ANTIGRAVITY_R2_TASK.md): it compares against the reference
book. Claude does everything that can be decided without the reference. To avoid conflicts Claude
does **not** change the look/behaviour details the reference decides:

- R2-01 search overlay look, R2-02 up-button look/targeting, R2-10 action group look and the
  summary/vocab prompt texts, R2-12 proxy format/presets.

Before every push: `git pull --no-rebase origin claude/sweet-darwin-9ax5zn`, `npm test`, `npm run build`,
never force-push.

## Phase A — correctness of what R2 changed (self-audit)

- [x] A1 Library organisation must not re-upload whole books. Folder / order / archive live on the book
      today, so dragging 20 books writes and syncs 20 full books. Move them into a light library map
      (`{bookId: {folderId, order, archived, at}}` + the folder list) kept in the synced index file,
      merged per entry by time. Books and their sync stay untouched by reordering.
- [x] A2 Old saved positions: an offset saved by the chapter reader (chapter fraction) is read as a
      section fraction. Harmless jump, but make the restore land at the section start when the saved
      record predates the continuous reader.
- [x] A3 Reader robustness on a big book (1000+ sections, images): open time, scroll without jumps,
      TOC build time, search, font change, sync redraw while reading. Measure in the browser, fix
      what is slow or jumps.
      Result (1200 sections, 3 MB, lists/tables): open 143 ms, 3–7 sections mounted, ~1.5–2k DOM
      nodes; 120 wheel steps down and 60 up on desktop and phone: 0 visible jumps; images loading
      late above the reader: max 0.1 px shift; font change ~200 ms; search ~300 ms.
- [x] A4 Reader + menus interplay: a tap that closes the side menu must not also open a paragraph's
      actions or an image dialog; Esc order (search → dialog → menu → fullscreen).
- [x] A5 Paragraph actions: stop speech when the book changes / view is left / another book opens;
      translation language change refreshes the button titles; the box survives font change and
      sync redraw.
- [x] A6 Library: empty folder, deleting the open book, archive while a book is open, bulk actions on a
      folder that is collapsed, selection cleared on view change.
- [x] A7 R2-06 flash title must not stick when leaving the stats view during the flash; refit on
      language change.
- [x] A8 Code review pass over the whole R2 diff (bugs only) and fix every finding.

## Phase B — finish and polish

- [x] B1 Mobile pass (390×780) and desktop pass (1280×800), light and dark theme, for every screen R2
      touched; fix overlaps, clipped text, tap targets under 32px.
- [x] B2 Keyboard and screen reader: contents tree (arrow keys, aria-expanded), dialogs focus, the
      bulk bar, the Aa+ button state.
- [x] B3 i18n: singular/plural wording ("1 books"), every new string in TR/EN/DE, no hard-coded text.
- [x] B4 User guide (docs/USER_GUIDE.*.md and in-app guide): replace chapter pages, A−/A+, "My books"
      menu entry with the R2 behaviour (continuous reading, up button, Aa+, save, contents tree,
      settings, paragraph actions, folders/archive, Connect AI).
- [x] B5 Remove what R2 made dead: unused i18n keys, CSS for removed elements, unused exports.

## Phase C — hand-over

- [ ] C1 Full test run + build, a final screenshot set of every R2 screen (kept out of the repo).
- [ ] C2 When Antigravity reports: read its check lines and commits, verify each against the code and
      in the browser, fix what it left, report to the user item by item.
- [ ] C3 `main` stays untouched until the user says so.
