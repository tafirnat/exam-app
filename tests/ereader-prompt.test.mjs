import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EREADER_AI_PROMPT } from '../src/features/ereader/ereader-prompt.js';

test('EREADER_AI_PROMPT.md on disk is exactly the module text (run npm run build:ereader-prompt)', () => {
    const onDisk = readFileSync(new URL('../EREADER_AI_PROMPT.md', import.meta.url), 'utf8');
    assert.equal(onDisk, EREADER_AI_PROMPT);
});

test('the prompt describes the schema the importer reads', () => {
    assert.ok(EREADER_AI_PROMPT.length > 1000, 'prompt must not be empty or truncated');
    for (const key of ['"ereader"', '"schema"', '"book_key"', '"title"', '"sections"', '"part"', '"text"']) {
        assert.ok(EREADER_AI_PROMPT.includes(key), `prompt must mention ${key}`);
    }
});
