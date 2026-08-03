import test from 'node:test';
import assert from 'node:assert/strict';
import {
    spendName, spendLedger, recomputeRemaining, chargeSpend, grantToken, mergeFreezeTokens
} from '../src/core/freeze-tokens.js';

/* `remaining` was a counter each device decremented on its own, merged
   last-writer-wins like every other config field. A counter is the one shape
   that cannot survive that: two devices freezing two different missed days both
   go 2 -> 1, the merge keeps one of those, and the frozen-day count stops
   matching the token count. Measured on three devices before this: three days
   frozen, one token deducted.

   So the tokens store what they paid for and the count is derived. A spend is
   named for the day and track it bought, which makes it idempotent; merging is
   a union, which cannot lose one. */

const tokens = (extra = {}) => ({
    total: 2, remaining: 2, tier1Earned: true, tier2Earned: true, initialized: true,
    spentOn: [], ...extra
});

test('a freeze is named for what it bought', () => {
    assert.equal(spendName('global', '2026-08-01'), 'global:2026-08-01');
    assert.notEqual(spendName('focus', '2026-08-01'), spendName('global', '2026-08-01'));
});

test('spending is recorded and the count follows it', () => {
    const t = tokens();

    assert.equal(chargeSpend(t, spendName('global', '2026-08-01')), true);

    assert.deepEqual(t.spentOn, ['global:2026-08-01']);
    assert.equal(t.remaining, 1);
});

test('the same freeze charged twice costs once', () => {
    // Which is what makes a second device freezing the same day free.
    const t = tokens();
    const name = spendName('global', '2026-08-01');

    assert.equal(chargeSpend(t, name), true);
    assert.equal(chargeSpend(t, name), false);

    assert.equal(t.remaining, 1);
    assert.equal(t.spentOn.length, 1);
});

test('an empty account cannot spend', () => {
    const t = tokens({ total: 1 });
    assert.equal(chargeSpend(t, spendName('global', '2026-08-01')), true);

    assert.equal(chargeSpend(t, spendName('global', '2026-07-30')), false);
    assert.equal(t.remaining, 0);
});

test('earning a tier hands one back', () => {
    const t = tokens();
    chargeSpend(t, spendName('global', '2026-08-01'));
    chargeSpend(t, spendName('global', '2026-07-30'));
    assert.equal(t.remaining, 0);

    grantToken(t);

    assert.equal(t.remaining, 1);
    assert.deepEqual(t.spentOn, ['global:2026-07-30'], 'the oldest spend is the one forgotten');
});

// ── Merging ─────────────────────────────────────────────────────────────────

test('two devices freezing different days keep both spends', () => {
    // The measured defect, in one case: a max or a last-writer-wins here keeps
    // one decrement and the account stops matching the frozen days.
    const a = tokens({ spentOn: ['global:2026-08-01'], remaining: 1 });
    const b = tokens({ spentOn: ['global:2026-07-30'], remaining: 1 });

    const merged = mergeFreezeTokens(a, b, true);

    assert.deepEqual(merged.spentOn.sort(), ['global:2026-07-30', 'global:2026-08-01']);
    assert.equal(merged.remaining, 0);
});

test('two devices freezing the same day spend once', () => {
    const a = tokens({ spentOn: ['global:2026-08-01'], remaining: 1 });
    const b = tokens({ spentOn: ['global:2026-08-01'], remaining: 1 });

    assert.equal(mergeFreezeTokens(a, b, true).remaining, 1);
});

test('the merge lands the same way whichever device runs it', () => {
    const a = tokens({ spentOn: ['global:2026-08-01'], remaining: 1 });
    const b = tokens({ spentOn: ['focus:2026-07-30'], remaining: 1 });

    const fromA = mergeFreezeTokens(a, b, true);
    const fromB = mergeFreezeTokens(b, a, false);

    assert.deepEqual(fromA.spentOn.sort(), fromB.spentOn.sort());
    assert.equal(fromA.remaining, fromB.remaining);
});

test('merging again changes nothing', () => {
    let merged = mergeFreezeTokens(
        tokens({ spentOn: ['global:2026-08-01'], remaining: 1 }),
        tokens({ spentOn: ['global:2026-07-30'], remaining: 1 }),
        true);

    for (let i = 0; i < 5; i++) merged = mergeFreezeTokens(merged, merged, true);

    assert.equal(merged.spentOn.length, 2);
    assert.equal(merged.remaining, 0);
});

test('the scalars still follow the stamp', () => {
    const a = tokens({ total: 1, tier2Earned: false, spentOn: [] });
    const b = tokens({ total: 2, tier2Earned: true, spentOn: [] });

    assert.equal(mergeFreezeTokens(a, b, false).tier2Earned, true, 'remote won the stamp');
    assert.equal(mergeFreezeTokens(a, b, true).tier2Earned, false, 'local won the stamp');
});

test('over-spending across devices settles at zero rather than going negative', () => {
    // Three devices each had two and each spent one while offline. The days are
    // a fait accompli; the account has to stay a number a UI can show.
    let merged = mergeFreezeTokens(
        tokens({ spentOn: ['global:2026-08-01'] }),
        tokens({ spentOn: ['global:2026-07-30'] }), true);
    merged = mergeFreezeTokens(merged, tokens({ spentOn: ['global:2026-07-28'] }), true);

    assert.equal(merged.spentOn.length, 3);
    assert.equal(merged.remaining, 0);
});

// ── Records from before the ledger ──────────────────────────────────────────

test('a record without a ledger gets one built from its own count', () => {
    const legacy = { total: 2, remaining: 0, tier1Earned: true, tier2Earned: true, initialized: true };

    assert.equal(spendLedger(legacy).length, 2);
    assert.equal(recomputeRemaining(legacy).remaining, 0, 'and the count it had is preserved');
});

test('an untouched legacy record keeps every token it had', () => {
    const legacy = { total: 2, remaining: 2, tier1Earned: true, tier2Earned: true, initialized: true };

    assert.deepEqual(spendLedger(legacy), []);
    assert.equal(recomputeRemaining(legacy).remaining, 2);
});

test('two devices synthesise the same legacy entries, so they do not double up', () => {
    /* Both sides name their carried-over spends identically, so the union keeps
       the larger of the two counts - which is what the old merge did with the
       counter - rather than adding one device's history to the other's. */
    const a = { total: 2, remaining: 1, tier1Earned: true, tier2Earned: true, initialized: true };
    const b = { total: 2, remaining: 1, tier1Earned: true, tier2Earned: true, initialized: true };

    assert.equal(mergeFreezeTokens(a, b, true).remaining, 1);
});

test('a legacy record and a named spend add up', () => {
    const legacy = { total: 2, remaining: 1, tier1Earned: true, tier2Earned: true, initialized: true };
    const modern = tokens({ spentOn: ['global:2026-08-01'], remaining: 1 });

    const merged = mergeFreezeTokens(legacy, modern, true);

    assert.equal(merged.spentOn.length, 2);
    assert.equal(merged.remaining, 0);
});
