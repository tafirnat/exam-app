import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function filterQuestionsByKeyword(questions, searchKeyword) {
    if (searchKeyword.trim() === '') return questions;
    const rawKw = searchKeyword.trim();
    if (rawKw.startsWith('#')) {
        const tagKw = rawKw.slice(1).trim().toLowerCase();
        return questions.filter(q => {
            const rawTags = q.tags || q.content?.tags || q.tag || [];
            const tags = Array.isArray(rawTags) ? rawTags : [rawTags];
            if (tagKw === '') {
                return tags.length > 0 && tags.some(t => String(t).trim() !== '');
            }
            return tags.some(t => String(t).toLowerCase().includes(tagKw));
        });
    } else {
        const kw = rawKw.toLowerCase();
        return questions.filter(q => {
            const text = (q.content?.text || q.text || '').toLowerCase();
            const optionsArr = q.content?.options || q.options || [];
            const optionsText = optionsArr.map(o => o.text || '').join(' ').toLowerCase();
            const ans = q.content?.answer || q.answer || '';
            const answerText = Array.isArray(ans) ? ans.join(' ').toLowerCase() : String(ans).toLowerCase();
            return text.includes(kw) || optionsText.includes(kw) || answerText.includes(kw);
        });
    }
}

test('# tag search returns only questions matching tag', () => {
    const questions = [
        { id: 1, text: 'Matematik problemi', tags: ['matematik', 'cebir'] },
        { id: 2, text: 'Tarih sorusu etikette matematik geçiyor', tags: ['tarih'] },
        { id: 3, text: 'Fizik sorusu', tags: ['fizik', 'matematik-2'] },
        { id: 4, text: 'Etiketsiz soru' }
    ];

    const tagResults = filterQuestionsByKeyword(questions, '#matematik');
    assert.deepEqual(tagResults.map(q => q.id), [1, 3]);

    const hashOnlyResults = filterQuestionsByKeyword(questions, '#');
    assert.deepEqual(hashOnlyResults.map(q => q.id), [1, 2, 3]);

    const textResults = filterQuestionsByKeyword(questions, 'matematik');
    assert.deepEqual(textResults.map(q => q.id), [1, 2]);
});

test('i18n search_label contains # tag format indicator', () => {
    const i18nSource = readFileSync(join(root, 'src/core/i18n.js'), 'utf8');
    assert.ok(i18nSource.includes('search_label: "Ara... (#etiket)"'));
    assert.ok(i18nSource.includes('search_label: "Search... (#tag)"'));
    assert.ok(i18nSource.includes('search_label: "Suche... (#tag)"'));
});

test('stats-module renders tag pills and conditionally hides source and ref during # search', () => {
    const statsModuleSrc = readFileSync(join(root, 'src/features/stats/stats-module.js'), 'utf8');
    assert.ok(statsModuleSrc.includes('stats-tag-pill'));
    assert.ok(statsModuleSrc.includes('!isTagSearch && safeSourceName'));
    assert.ok(statsModuleSrc.includes('!isTagSearch'));
});

test('test-ui updateFooterTags sets #statsSearchInput value and triggers search', () => {
    const testUiSrc = readFileSync(join(root, 'src/features/test/test-ui.js'), 'utf8');
    assert.ok(testUiSrc.includes("searchInput.value = '#' + tag"));
});
