/**
 * Writes EREADER_AI_PROMPT.md from src/features/ereader/ereader-prompt.js.
 *
 * The prompt lives twice: in the app, where "Copy AI prompt" puts it on the
 * clipboard, and on disk, where a user can link or download it. The file on
 * disk is generated and tests/ereader-prompt.test.mjs fails when it no longer
 * matches the module.
 *
 *   npm run build:ereader-prompt
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { EREADER_AI_PROMPT } = await import('../src/features/ereader/ereader-prompt.js');

writeFileSync(join(ROOT, 'EREADER_AI_PROMPT.md'), EREADER_AI_PROMPT);
console.log('EREADER_AI_PROMPT.md written');
