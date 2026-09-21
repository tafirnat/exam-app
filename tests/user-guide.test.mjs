import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, initState, openGuide, closeGuide;
let GUIDE_SECTIONS, GUIDE_LANGUAGES, GUIDE_TITLE, GUIDE_INTRO, CONTACT_EMAIL, guideLang;
let renderGuideMarkdown, guideFileName;
let APP_VERSION, translations;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

before(async () => {
    const dom = new JSDOM(read('../index.html'), { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    initState = stateMod.initState;
    initState();

    ({ GUIDE_SECTIONS, GUIDE_LANGUAGES, GUIDE_TITLE, GUIDE_INTRO, CONTACT_EMAIL, guideLang } =
        await import('../src/features/help/guide-content.js'));
    ({ openGuide, closeGuide } = await import('../src/features/help/guide-ui.js'));
    ({ renderGuideMarkdown, guideFileName } = await import('../scripts/build-user-guide.mjs'));
    ({ APP_VERSION } = await import('../src/core/version.js'));
    ({ translations } = await import('../src/core/i18n.js'));
});

beforeEach(() => {
    AppState.language = 'tr';
    closeGuide();
});

// ── the content is complete ─────────────────────────────────────────────────

test('every section is written in all three languages', () => {
    const missing = [];
    GUIDE_SECTIONS.forEach(s => {
        GUIDE_LANGUAGES.forEach(lang => {
            if (!s.title?.[lang]?.trim()) missing.push(`${s.id}.title.${lang}`);
            if (!s.body?.[lang]?.trim()) missing.push(`${s.id}.body.${lang}`);
        });
    });
    assert.deepEqual(missing, []);
});

test('section ids are unique - they are anchors', () => {
    const ids = GUIDE_SECTIONS.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('the guide covers what the user asked it to cover', () => {
    // Named one by one because "there are seventeen sections" is an assertion
    // about a number, not about whether the guide answers anything.
    ['add-sources', 'manage-sources', 'sync', 'streaks', 'stats',
     'question-details', 'settings', 'about'].forEach(id => {
        assert.ok(GUIDE_SECTIONS.some(s => s.id === id), `no section covers "${id}"`);
    });
});

test('merging, exporting and suspending are each explained somewhere', () => {
    // The screen names are what a reader searches for; a guide that never uses
    // them cannot be found by the person who needs it.
    const tr = GUIDE_SECTIONS.map(s => s.body.tr).join('\n').toLowerCase();
    ['birleştir', 'dışa aktar', 'arşivle', 'askıya al', 'takılan', 'jeton', 'gist']
        .forEach(word => assert.ok(tr.includes(word), `the Turkish guide never mentions "${word}"`));
});

test('the contact address and the version are in the guide', () => {
    const about = GUIDE_SECTIONS.find(s => s.id === 'about');
    GUIDE_LANGUAGES.forEach(lang => {
        assert.ok(about.body[lang].includes(CONTACT_EMAIL), `${lang} is missing the contact address`);
        assert.ok(about.body[lang].includes(APP_VERSION), `${lang} is missing the version`);
    });
});

test('the version is declared once, not twice', () => {
    // Two copies of a version string drift the first time one of them is bumped.
    const pkg = JSON.parse(read('../package.json'));
    assert.equal(pkg.version, APP_VERSION, 'package.json and version.js disagree');
});

test('an unsupported language falls back to English rather than blank', () => {
    assert.equal(guideLang('fr'), 'en');
    assert.equal(guideLang(undefined), 'en');
    assert.equal(guideLang('de'), 'de');
});

// ── the guide renders in the app ────────────────────────────────────────────

test('opening the guide shows the contents, one link per section', () => {
    openGuide();
    assert.ok(document.getElementById('guideOverlay').classList.contains('active'));
    const links = document.querySelectorAll('#guideToc [data-guide-jump]');
    assert.equal(links.length, GUIDE_SECTIONS.length);
});

test('nothing is open, and no section body is parsed, until one is asked for', () => {
    // The guide is tens of kilobytes of Markdown. Parsing all of it on open is
    // work nobody asked for, so a body stays empty until its section opens.
    openGuide();
    assert.equal(document.querySelectorAll('.guide-item.is-open').length, 0);
    const filled = [...document.querySelectorAll('.guide-body')].filter(b => b.innerHTML.trim() !== '');
    assert.equal(filled.length, 0, 'a closed section had already been rendered');
});

test('a contents link opens its section and fills it', () => {
    openGuide();
    document.querySelector('[data-guide-jump="sync"]').click();
    const item = document.getElementById('guideItem-sync');
    assert.ok(item.classList.contains('is-open'));
    assert.ok(document.getElementById('guideBody-sync').innerHTML.includes('Gist'));
});

test('only one section is open at a time', () => {
    openGuide();
    document.querySelector('[data-guide-jump="sync"]').click();
    document.querySelector('[data-guide-jump="streaks"]').click();
    const open = [...document.querySelectorAll('.guide-item.is-open')].map(el => el.id);
    assert.deepEqual(open, ['guideItem-streaks']);
});

test('tapping an open heading closes it again', () => {
    openGuide();
    document.getElementById('guideHead-stats').click();
    assert.ok(document.getElementById('guideItem-stats').classList.contains('is-open'));
    document.getElementById('guideHead-stats').click();
    assert.ok(!document.getElementById('guideItem-stats').classList.contains('is-open'));
});

test('the guide can be opened straight at a section', () => {
    openGuide('streaks');
    assert.ok(document.getElementById('guideItem-streaks').classList.contains('is-open'));
});

test('the guide follows the interface language', () => {
    AppState.language = 'de';
    openGuide();
    assert.equal(document.getElementById('guideTitle').textContent, GUIDE_TITLE.de);
    assert.match(document.querySelector('#guideToc .guide-toc-link').textContent, /Erste Schritte/);
    assert.equal(document.getElementById('guideIntro').textContent, GUIDE_INTRO.de);
});

test('a language change re-renders the bodies, not just the headings', () => {
    // The parsed bodies are cached. Keeping them across a language change would
    // put the previous language's text under the new language's heading.
    AppState.language = 'tr';
    openGuide('sync');
    const tr = document.getElementById('guideBody-sync').innerHTML;
    closeGuide();
    AppState.language = 'en';
    openGuide('sync');
    const en = document.getElementById('guideBody-sync').innerHTML;
    assert.notEqual(tr, en, 'the German-language reader was shown Turkish prose');
    assert.ok(en.includes('Personal Access Token'));
});

test('the parsed-body memo is keyed by language, not just by section', () => {
    // This is what makes a language change safe without an explicit cache
    // flush: German can never be served the Turkish parse. A memo keyed on the
    // section id alone would hand back whichever language was read first.
    const src = read('../src/features/help/guide-ui.js');
    const fn = src.slice(src.indexOf('function sectionHTML'), src.indexOf('function openSection'));
    assert.match(fn, /\$\{lang\}/, 'the cache key does not carry the language');

    AppState.language = 'tr';
    openGuide('stats');
    const tr = document.getElementById('guideBody-stats').innerHTML;
    closeGuide();
    AppState.language = 'de';
    openGuide('stats');
    const de = document.getElementById('guideBody-stats').innerHTML;
    closeGuide();
    AppState.language = 'tr';
    openGuide('stats');
    assert.equal(document.getElementById('guideBody-stats').innerHTML, tr,
        'going back to the first language re-parsed or returned the wrong text');
    assert.notEqual(tr, de);
});

test('the contact address is a mailto link the reader can actually press', () => {
    openGuide();
    const link = document.querySelector('#guideContact a');
    assert.ok(link, 'the contact address is not a link');
    assert.equal(link.getAttribute('href'), `mailto:${CONTACT_EMAIL}`);
});

test('the version is on screen', () => {
    openGuide();
    assert.equal(document.getElementById('guideVersion').textContent, `v${APP_VERSION}`);
});

test('the menu entry opens the guide, and the tour keeps its own entry', () => {
    const html = read('../index.html');
    assert.ok(/id="menuOpenGuide"/.test(html), 'nothing in the menu opens the guide');
    assert.ok(/id="menuStartOnboarding"/.test(html), 'the interactive tour lost its entry');
    const main = read('../src/main.js');
    assert.ok(/setClick\('menuOpenGuide'[\s\S]{0,120}openGuide\(\)/.test(main),
        'the menu entry is not wired to openGuide');
});

test('the overlay clears the default and stays below customModalOverlay', () => {
    /* Both bars are read from the stylesheet rather than written down. The
       second `.modal-overlay` rule in style.css raises the default to 10010,
       which is what an overlay with no inline z-index gets - the quick-group
       modal was measured opening underneath one of those. CLAUDE.md rule 6
       sets the upper bar: #customModalOverlay has to stay on top. */
    const css = read('../src/style.css');
    const defaults = [...css.matchAll(/\.modal-overlay[^{]*\{[^}]*?z-index:\s*(\d+)/g)].map(m => Number(m[1]));
    const effectiveDefault = defaults[defaults.length - 1];

    const src = read('../index.html');
    const z = /id="guideOverlay"[^>]*z-index:\s*(\d+)/.exec(src);
    assert.ok(z);
    const n = Number(z[1]);
    assert.ok(n > effectiveDefault, `${n} does not clear the .modal-overlay default of ${effectiveDefault}`);

    const confirm = /id="customModalOverlay"[^>]*z-index:\s*(\d+)/.exec(src);
    assert.ok(n < Number(confirm[1]));
});

test('the guide uses the app markdown renderer rather than a second one', () => {
    const src = read('../src/features/help/guide-ui.js');
    assert.ok(/renderMarkdown\(/.test(src));
});

// ── the generated files on disk ─────────────────────────────────────────────

test('the checked-in Markdown matches what the source generates', () => {
    // These files are what an AI asked "how does this app work" reads. Two
    // hand-kept copies would drift within a month, so the copy on disk is
    // generated and this case is what stops it going stale.
    GUIDE_LANGUAGES.forEach(lang => {
        const onDisk = read(`../docs/${guideFileName(lang)}`).replace(/\r\n/g, '\n');
        assert.equal(
            onDisk, renderGuideMarkdown(lang),
            `docs/${guideFileName(lang)} is out of date - run: npm run build:guide`
        );
    });
});

test('the generated file carries every section and the contents list', () => {
    const md = renderGuideMarkdown('en');
    GUIDE_SECTIONS.forEach(s => {
        assert.ok(md.includes(`## ${s.title.en}`), `${s.id} has no heading in the Markdown`);
    });
    assert.ok(md.includes('## Contents'));
    assert.ok(md.includes(CONTACT_EMAIL));
});

test('the generated file says it is generated', () => {
    // Otherwise the first person to improve a sentence edits the copy that gets
    // overwritten.
    GUIDE_LANGUAGES.forEach(lang => {
        assert.match(renderGuideMarkdown(lang), /build:guide/);
    });
});

test('npm run build:guide exists', () => {
    const pkg = JSON.parse(read('../package.json'));
    assert.ok(pkg.scripts['build:guide'], 'the generator has no script to run it');
});

// ── i18n around the guide ───────────────────────────────────────────────────

test('the menu labels are translated in all three languages', () => {
    ['onboarding_menu_title', 'onboarding_tour_menu_title', 'guide_contact_label']
        .forEach(key => {
            ['tr', 'en', 'de'].forEach(lang => {
                assert.ok(translations[lang][key], `${lang}.${key} is missing`);
            });
        });
});
