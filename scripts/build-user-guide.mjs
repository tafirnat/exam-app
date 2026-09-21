/**
 * Writes docs/USER_GUIDE*.md from src/features/help/guide-content.js.
 *
 * The guide exists twice on purpose: in the app, where a user reads it, and on
 * disk, where an AI asked "how does this app work" reads it. Two hand-kept
 * copies would drift within a month, so the file on disk is generated and
 * tests/user-guide.test.mjs fails when it no longer matches.
 *
 *   npm run build:guide
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
    GUIDE_SECTIONS, GUIDE_TITLE, GUIDE_INTRO, GUIDE_LANGUAGES,
    CONTACT_EMAIL, SOURCE_URL
} = await import('../src/features/help/guide-content.js');

const NOTE = {
    tr: '> Bu dosya `src/features/help/guide-content.js` dosyasindan uretilmistir. Elle duzenlemeyin; `npm run build:guide` calistirin.',
    en: '> This file is generated from `src/features/help/guide-content.js`. Do not edit it by hand; run `npm run build:guide`.',
    de: '> Diese Datei wird aus `src/features/help/guide-content.js` erzeugt. Nicht von Hand bearbeiten; `npm run build:guide` ausfuhren.'
};

const TOC_HEADING = { tr: 'Icindekiler', en: 'Contents', de: 'Inhalt' };

/** A GitHub-style anchor for a heading, so the contents links actually work. */
function anchor(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
}

export function renderGuideMarkdown(lang) {
    const lines = [];
    lines.push(`# ${GUIDE_TITLE[lang]}`);
    lines.push('');
    lines.push(NOTE[lang]);
    lines.push('');
    lines.push(GUIDE_INTRO[lang]);
    lines.push('');
    lines.push(`## ${TOC_HEADING[lang]}`);
    lines.push('');
    GUIDE_SECTIONS.forEach((s, i) => {
        lines.push(`${i + 1}. [${s.title[lang]}](#${anchor(s.title[lang])})`);
    });
    lines.push('');
    GUIDE_SECTIONS.forEach(s => {
        lines.push('---');
        lines.push('');
        lines.push(`## ${s.title[lang]}`);
        lines.push('');
        lines.push(s.body[lang].trim());
        lines.push('');
    });
    lines.push('---');
    lines.push('');
    lines.push(`<${SOURCE_URL}> · ${CONTACT_EMAIL}`);
    lines.push('');
    return lines.join('\n');
}

/** en is the primary file; the other two carry their language in the name. */
export function guideFileName(lang) {
    return lang === 'en' ? 'USER_GUIDE.md' : `USER_GUIDE.${lang}.md`;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-user-guide.mjs')) {
    mkdirSync(join(ROOT, 'docs'), { recursive: true });
    GUIDE_LANGUAGES.forEach(lang => {
        const out = join(ROOT, 'docs', guideFileName(lang));
        writeFileSync(out, renderGuideMarkdown(lang), 'utf8');
        console.log(`wrote ${out}`);
    });
}
