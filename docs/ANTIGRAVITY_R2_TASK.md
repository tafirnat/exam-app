# Antigravity task — e-Reader Round 2 (R2) verification against the reference

## Hard rules

1. Work ONLY on branch `claude/sweet-darwin-9ax5zn`. **Never merge, rebase or push to `main`.** The app on
   `main` is live; this branch is not ready.
2. The reference book `C:\Users\Student\Desktop\GFN\Schulungsmaterial\ITIL\ITIL® 4 Foundation\index.html`
   is copyrighted. **Never copy it, or any text, image or sentence from it, into the repo.** Write down only
   structure and behaviour (element names, CSS values, event handling, API format).
3. No step may break the tests: before every commit run `npm test` (all green) and `npm run build`.
4. One commit per fix, message `fix(ereader): R2-xx <what>`. Push only to this branch.

## Step 0 — setup

```
git fetch origin
git switch claude/sweet-darwin-9ax5zn
git pull --ff-only origin claude/sweet-darwin-9ax5zn
npm ci
npm test        # expected: 1238 pass, 0 fail
npm run dev     # open the app in the browser
```

Import a real book into the e-Reader (the ITIL book's JSON, if you have it; it stays on your disk only).

## Step 1 — answer the 4 open questions from the reference

Open the reference `index.html` in the browser, study it with DevTools, and write the answers under
"Questions for Antigravity" in `docs/EREADER_R2_ISSUES.md` (behaviour/structure only, no book text):

1. **Search (R2-01):** the focused search's markup and CSS — backdrop colour/blur, panel width and top
   position, result row layout, which keyboard shortcuts it shows and where.
2. **Up button (R2-02):** position, size, icon; from which scroll position it appears; how it picks the target
   heading; what Ctrl+click does; how it behaves on mobile.
3. **Paragraph actions (R2-10):** where `.p-actions-group` sits (end of paragraph? margin?), when it is
   visible (hover / tap / always); for "Öz & Temel Mantık" and "Kavram & Terimler" the exact prompt they send
   (the prompt template, not the result), which endpoint they call, and how results are cached (memory?
   localStorage? key format?).
4. **Local AI (R2-12):** the proxy's URL and port, how it is started (command / file), request format
   (`/v1/chat/completions`? Ollama `/api/chat`?), how the model is chosen, and how CORS is handled.

## Step 2 — check each item on the branch against the reference

For every item R2-01 … R2-12 in `docs/EREADER_R2_ISSUES.md`: test it in the running app (desktop width and
the phone width in DevTools), compare it with the reference, and write a line under the item:

```
Check (Antigravity): OK | DIFFERENT: <what differs, concretely> | BROKEN: <steps to reproduce>
```

Pay special attention to:
- R2-02: scroll smoothly through a long real book — does the text jump? Does the reading position come
  back after leaving and reopening the book?
- R2-03: contents with the real book's h1/h2/h3.
- R2-10: are the icons, the order, the box and the box buttons the same as the reference?
- R2-12: does a real local model (Ollama / LM Studio / the reference's proxy) answer from the app, via
  "Test connection" and via a paragraph's summary button?

## Step 3 — fix what differs

- Fix the `DIFFERENT` / `BROKEN` findings one at a time on this branch, adjusting to the reference's
  behaviour (without copying its content). Add a test for each fix, as the existing tests in `tests/ereader-*.test.mjs` do.
- R2-10 prompts: if the reference's prompts are better, adapt `buildPrompt()` in
  `src/features/ereader/ereader-paragraph-actions.js` (the structure, no book text).
- R2-12: if the reference uses a different proxy/format, extend `src/core/ai-client.js` (keep the existing
  OpenAI-compatible path) and add a preset for it in `src/features/ai/ai-connect-ui.js`.

## Step 4 — report back

When done, update `docs/EREADER_R2_ISSUES.md` (answers + check lines), commit and push to this branch, and
give the user a short list: which items are OK, which were fixed (commit hash), what is still open.
**Do not merge to `main`** — the user decides that after testing it themselves.

## Where the code is

| Item | Files |
|---|---|
| R2-01, R2-02, R2-03, R2-09 | `src/features/ereader/ereader-reader-ui.js`, `ereader.css`, `index.html` |
| R2-04 | `index.html` (side menu), `src/main.js` |
| R2-05, R2-07 | `src/features/ereader/ereader.css`, `ereader-shell.js`, `index.html` |
| R2-06 | `src/features/stats/filter-bar-fit.js`, `src/style.css` |
| R2-08 | `index.html` (`#ereaderSettingsMenuSection`), `ereader-shell.js` |
| R2-10 | `src/features/ereader/ereader-paragraph-actions.js`, `ereader-tts.js`, `src/core/ai-client.js` |
| R2-11 | `src/features/ereader/ereader-library-manage.js`, `ereader-folders.js`, `ereader-library-ui.js`, `ereader-store.js` |
| R2-12 | `src/features/ai/ai-connect-ui.js`, `ai-connect.css`, `src/core/ai-client.js`, CSP in `index.html` |
