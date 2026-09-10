import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTextForSpeech, decodeHtmlEntities, processClozeForSpeech } from '../src/core/tts-cleaner.js';

test('1. Headings add sentence pause if missing punctuation', () => {
    const raw = '# Kardiyoloji\nKalp dört odacıktan oluşur.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Kardiyoloji. Kalp dört odacıktan oluşur.');
});

test('2. Headings preserve existing punctuation', () => {
    const raw = '## Neden Kalp Krizi Geçirilir?\nAna damar tıkanıklığı.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Neden Kalp Krizi Geçirilir? Ana damar tıkanıklığı.');
});

test('3. Markdown links keep display text and drop URLs', () => {
    const raw = 'Daha fazla bilgi için [kardiyoloji rehberine](https://example.com/guide?id=123) başvurunuz.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Daha fazla bilgi için kardiyoloji rehberine başvurunuz.');
});

test('4. Standalone URLs are removed', () => {
    const raw = 'Detaylar https://example.com/long/url adresinde yer alır.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Detaylar adresinde yer alır.');
});

test('5. Obsidian Wikilinks keep alias or target', () => {
    const withAlias = 'Başkent [[Almanya|Almanya Federal Cumhuriyeti]] sınırları içindedir.';
    assert.equal(cleanTextForSpeech(withAlias), 'Başkent Almanya Federal Cumhuriyeti sınırları içindedir.');

    const targetOnly = 'Tedavi için [[Aspirin]] kullanılabilir.';
    assert.equal(cleanTextForSpeech(targetOnly), 'Tedavi için Aspirin kullanılabilir.');
});

test('6. Markdown images and Obsidian embeds are completely removed', () => {
    const raw = 'Görselde görüldüğü üzere ![Kalp Şeması](kalp.png) ve ![[damar.svg]] önemlidir.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Görselde görüldüğü üzere ve önemlidir.');
});

test('7. Inline formatting markers are stripped without affecting words', () => {
    const raw = 'Bu **önemli**, *dikkat çekici*, __kalın__, _italik_, ==vurgulu== ve ~~çizili~~ bir metindir.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Bu önemli, dikkat çekici, kalın, italik, vurgulu ve çizili bir metindir.');
});

test('8. Cloze questions - active test mode (revealAnswers = false)', () => {
    const raw = "Türkiye'nin başkenti {{Ankara}}'dır. En kalabalık şehir {{İstanbul|Konstantinopolis}}'tir.";
    const cleaned = cleanTextForSpeech(raw, { revealAnswers: false });
    assert.ok(cleaned.includes('...'));
    assert.ok(!cleaned.includes('Ankara'));
    assert.ok(!cleaned.includes('İstanbul'));
    assert.ok(!cleaned.includes('Konstantinopolis'));
});

test('9. Cloze questions - review mode (revealAnswers = true)', () => {
    const raw = "Türkiye'nin başkenti {{Ankara}}'dır.";
    const cleaned = cleanTextForSpeech(raw, { revealAnswers: true });
    assert.equal(cleaned, "Türkiye'nin başkenti Ankara'dır.");
});

test('10. Cloze questions - Anki format c1::answer::hint', () => {
    const raw = 'Die Hauptstadt von Deutschland ist {{c1::Berlin::Stadt}}.';
    const hidden = cleanTextForSpeech(raw, { revealAnswers: false });
    assert.ok(hidden.includes('...'));
    assert.ok(!hidden.includes('Berlin'));
    assert.ok(!hidden.includes('Stadt'));

    const revealed = cleanTextForSpeech(raw, { revealAnswers: true });
    assert.equal(revealed, 'Die Hauptstadt von Deutschland ist Berlin.');
});

test('11. HTML tags are stripped and block tags create sentence pauses', () => {
    const raw = '<p>Birinci paragraf</p><div>İkinci paragraf</div><span>Ekstra metin</span><br>Son satır.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Birinci paragraf. İkinci paragraf. Ekstra metin. Son satır.');
});

test('12. HTML entities are decoded naturally by language', () => {
    const trText = 'Kardiyoloji &amp; Nöroloji &nbsp; &quot;önemli&quot; &lt;alanlardır&gt;.';
    assert.equal(cleanTextForSpeech(trText, { lang: 'tr' }), 'Kardiyoloji ve Nöroloji "önemli" <alanlardır>.');

    const enText = 'Heart &amp; Brain';
    assert.equal(cleanTextForSpeech(enText, { lang: 'en' }), 'Heart and Brain');

    const deText = 'Herz &amp; Gehirn';
    assert.equal(cleanTextForSpeech(deText, { lang: 'de' }), 'Herz und Gehirn');
});

test('13. Markdown lists are formatted with pauses between items', () => {
    const raw = 'Belirtiler:\n- Göğüs ağrısı\n- Nefes darlığı\n- Çarpıntı';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Belirtiler: Göğüs ağrısı, Nefes darlığı, Çarpıntı.');
});

test('14. Markdown callouts and blockquotes are cleaned', () => {
    const raw = '> [!NOTE] Önemli Bilgi\n> İlaç düzenli kullanılmalıdır.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Önemli Bilgi. İlaç düzenli kullanılmalıdır.');
});

test('15. Markdown tables are cleanly converted without pipe characters', () => {
    const raw = `| İlaç | Doz |
|---|---|
| Aspirin | 100 mg |
| Parasetamol | 500 mg |`;
    const cleaned = cleanTextForSpeech(raw);
    assert.ok(!cleaned.includes('|'));
    assert.ok(cleaned.includes('Aspirin, 100 mg.'));
    assert.ok(cleaned.includes('Parasetamol, 500 mg.'));
});

test('16. Code blocks and inline code', () => {
    const raw = 'Kodu çalıştırınız: `const x = 10;` ve devam ediniz.';
    const cleaned = cleanTextForSpeech(raw);
    assert.equal(cleaned, 'Kodu çalıştırınız: const x = 10; ve devam ediniz.');
});

test('17. Max length limit guards against URL overflow at sentence boundary', () => {
    const sentence1 = 'Birinci cümle oldukça uzundur ve detay içerir.';
    const sentence2 = 'İkinci cümle tedavi planını açıklar.';
    const sentence3 = 'Üçüncü cümle kontrol zamanını belirtir.';
    const fullText = `${sentence1} ${sentence2} ${sentence3}`;

    const truncated = cleanTextForSpeech(fullText, { maxChars: 60 });
    assert.ok(truncated.length <= 60);
    assert.ok(truncated.endsWith('.'));
    assert.equal(truncated, sentence1);
});

test('18. Null, empty, and non-string inputs return empty string safely', () => {
    assert.equal(cleanTextForSpeech(null), '');
    assert.equal(cleanTextForSpeech(undefined), '');
    assert.equal(cleanTextForSpeech(''), '');
    assert.equal(cleanTextForSpeech(123), '');
});
