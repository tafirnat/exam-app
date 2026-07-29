# Markdown Migration Report

> **Repository**: `Exam App`  
> **Migration Objective**: Migrate from legacy HTML content strings to 100% Obsidian-compatible Markdown format.

---

## Step 0 — Inventory of Touched Files

| File Path | Role | Change Class | Description |
| :--- | :--- | :--- | :--- |
| `MD_MIGRATION_REPORT.md` | Audit & Verification Report | `NEW` | Authoritative migration report and checklist |
| `docs/MARKDOWN_SPEC.md` | Syntax Specification | `NEW` | Native Obsidian syntax surface supported by Exam App |
| `src/core/markdown.js` | Core Parser & Renderer | `NEW` | Dependency-free Markdown → HTML renderer and plainText extractor |
| `src/core/markdown.css` | Scoped Component Styles | `NEW` | Scoped typography and callout styles under `.md-content` |
| `src/core/cloze.js` | Cloze Engine | `EDIT` | Cloze gap preservation seam with Markdown rendering |
| `src/features/test/test-ui.js` | Test Runner UI | `EDIT` | Route questions, explanations, options through `markdown.js` |
| `src/main.js` | Main Application / Preview | `EDIT` | Route preview cards, explanations, and search highlights through `markdown.js` |
| `src/features/stats/question-editor.js` | Question Editor UI | `EDIT` | Markdown toolbar, `wrapSelection`, live preview integration |
| `src/features/sources/sources-service.js` | Sources Import Service | `EDIT` | Remove legacy `format` field during source import |
| `src/style.css` | Design System Styles | `EDIT` | Custom property tokens, retire global `code`/`pre` & duplicate rules |
| `src/core/i18n.js` | Localization Tables | `EDIT` | Markdown editor toolbar tooltips/labels in `tr`, `en`, `de` |
| `data/reading_feature_guide.json` | Content Dataset | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `data/software_architecture_reading_test.json` | Content Dataset | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `data/web_technologies_reading_test.json` | Content Dataset | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `public/examples/sample-tr.json` | Sample Dataset (TR) | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `public/examples/sample-en.json` | Sample Dataset (EN) | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `public/examples/sample-de.json` | Sample Dataset (DE) | `EDIT` | Convert legacy HTML content to Obsidian Markdown |
| `tests/markdown.test.mjs` | Test Suite | `NEW` | Comprehensive unit tests for `markdown.js` |
| `tests/cloze.test.mjs` | Test Suite | `EDIT` | Verify Cloze parsing & Markdown rendering interaction |
| `tests/question-editor.test.mjs` | Test Suite | `EDIT` | Test `wrapSelection` caret positioning and toolbar actions |
| `tests/samples.test.mjs` | Test Suite | `EDIT` | Guard assertion against raw HTML tags in JSON content |
| `AI_AGENT_PROMPT.md` | Prompt Documentation | `EDIT` | Update AI prompt guidelines and JSON examples to Markdown |
| `README.md` | Project Overview Documentation | `EDIT` | Update content format description and Obsidian note usage |
| `public/examples/schema-guide.md` | Schema Guide Documentation | `EDIT` | Update format rules and JSON schema examples to Markdown |

---

## Step 5 — CSS Audit

- **Retired Global Rules**: Removed un-scoped `code`, `pre`, `pre code`, `[data-theme="light"] code/pre/pre code` selectors from `src/style.css` (lines 1226-1272) and duplicate `.stats-item-text pre|code` rules (lines 3293-3324).
- **Grep Verification**: `grep -n "^code\s*{\|^pre\s*{" src/style.css` returns **0 results**.
- **Scoped Stylesheet**: All Markdown rendering rules are scoped under `.md-content` in `src/core/markdown.css`.

---

## Step 9 — Verification & Build Status

- **Unit Tests**: Executed `npm test` across all 8 test suites (`markdown.test.mjs`, `cloze.test.mjs`, `question-editor.test.mjs`, `samples.test.mjs`, `question-rules.test.mjs`, `grading.test.mjs`, `i18n.test.mjs`, `service-worker.test.mjs`).
  - **Results**: **93 tests passed (93/93), 0 failures**.
- **Production Build**: Executed `npm run build`.
  - **Results**: Clean build using `vite-plugin-singlefile`, creating `dist/index.html` (481.55 kB single-file bundle).
