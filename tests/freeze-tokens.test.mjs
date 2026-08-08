import test from 'node:test';
import assert from 'node:assert/strict';
import {
    spendName, grantName, spendLedger, recomputeRemaining, chargeSpend, grantToken, mergeFreezeTokens
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

// ── Earning ─────────────────────────────────────────────────────────────────

/* Earning used to *delete* the oldest spend, and deletion is the one edit a
   union cannot carry: the push path merges against the remote before writing,
   the remote still holds the entry, and it comes straight back. Measured: a
   device that spent its one token and then earned it back pushed remaining 0 and
   pulled remaining 0, while tier1Earned latched true so the tier could never pay
   out again - with sync on, the blue snowflake was spend-once-keep-forever.

   So a grant is a named entry of its own, and it forgives one spend older than
   itself. */

test('earning a tier hands one back', () => {
    const t = tokens();
    chargeSpend(t, spendName('global', '2026-07-30'));
    chargeSpend(t, spendName('global', '2026-08-01'));
    assert.equal(t.remaining, 0);

    grantToken(t, grantName('tier1', '2026-08-08'));

    assert.equal(t.remaining, 1);
    assert.deepEqual(t.spentOn, ['global:2026-07-30', 'global:2026-08-01'],
        'and the spends stay on the record - forgiven, not erased');
});

test('an earned token survives the merge that follows it', () => {
    /* The whole point of naming the grant. Both sides already hold the spend,
       so a merge that only unions spends hands the freeze back and the earning
       is silently undone. */
    const spent = { total: 1, remaining: 0, tier1Earned: false, tier2Earned: false, initialized: true, spentOn: ['global:2026-07-20'], grants: [] };
    const device = JSON.parse(JSON.stringify(spent));
    const remote = JSON.parse(JSON.stringify(spent));

    device.tier1Earned = true;
    grantToken(device, grantName('tier1', '2026-08-08'));
    assert.equal(device.remaining, 1);

    const pushed = mergeFreezeTokens(device, remote, true);

    assert.equal(pushed.remaining, 1, 'the grant outlives the union that restores the spend');
    assert.equal(mergeFreezeTokens(pushed, pushed, true).remaining, 1, 'and re-merging keeps it');
});

test('earning while nothing is outstanding cannot be banked', () => {
    /* A grant forgives a spend *older* than itself, so a credit earned today
       does not quietly pay for a freeze made next week. Without that clause the
       additive count leaves remaining at 1 through a spend that should empty it. */
    const t = tokens({ total: 1 });
    grantToken(t, grantName('tier1', '2026-08-08'));
    assert.equal(t.remaining, 1, 'already full, so the grant changes nothing yet');

    chargeSpend(t, spendName('global', '2026-08-20'));

    assert.equal(t.remaining, 0, 'and it does not pay for the freeze that came after it');
});

test('the same tier earned on two devices the same day is one grant', () => {
    const a = tokens({ total: 1, spentOn: ['global:2026-07-20'] });
    const b = tokens({ total: 1, spentOn: ['global:2026-07-20'] });
    grantToken(a, grantName('tier1', '2026-08-08'));
    grantToken(b, grantName('tier1', '2026-08-08'));

    const merged = mergeFreezeTokens(a, b, true);

    assert.deepEqual(merged.grants, ['tier1:2026-08-08']);
    assert.equal(merged.remaining, 1, 'one spend forgiven, not two');
});

test('grants merge as a union, so neither device loses one', () => {
    const a = tokens({ spentOn: ['global:2026-07-20', 'global:2026-07-21'], grants: ['tier1:2026-08-01'] });
    const b = tokens({ spentOn: ['global:2026-07-20', 'global:2026-07-21'], grants: ['tier2:2026-08-02'] });

    const merged = mergeFreezeTokens(a, b, true);

    assert.deepEqual(merged.grants, ['tier1:2026-08-01', 'tier2:2026-08-02']);
    assert.equal(merged.remaining, 2, 'both spends forgiven');
});

test('a record from before grants existed reads exactly as it used to', () => {
    // Its grants were applied by deleting spends, so its spend ledger is short
    // already; an empty grant ledger has to leave that arithmetic alone.
    const old = { total: 2, remaining: 1, tier1Earned: true, tier2Earned: true, initialized: true, spentOn: ['global:2026-07-20'] };

    assert.equal(recomputeRemaining(old).remaining, 1);
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

// ── The progress-reset floor ────────────────────────────────────────────────

/* The union is unconditional, which makes it the one rule a progress reset
   cannot survive on its own: any device that has not yet seen the reset hands
   its pre-reset spends back and the refill is undone one entry at a time. The
   floor is the reset's day, because a spend names the day it bought and the sync
   merge drops those same day records by the same line. */

test('a spend for a day the reset cleared is not handed back', () => {
    const reset = tokens({ total: 1, spentOn: [], remaining: 1 });
    const missedIt = tokens({ total: 1, spentOn: ['global:2026-07-30'], remaining: 0 });

    const merged = mergeFreezeTokens(reset, missedIt, true, '2026-08-01');

    assert.deepEqual(merged.spentOn, []);
    assert.equal(merged.remaining, 1);
});

test('a spend for the reset day itself is kept, because that day survives', () => {
    /* The day record for the reset day is not dropped - work done on it after the
       reset is real - so the charge for freezing it is real too. It also cannot
       predate the reset: a day is only frozen once it is past, so a charge naming
       the reset day was necessarily made after the reset. Voiding it would leave
       the day frozen and the token refunded, which is a free freeze. */
    const merged = mergeFreezeTokens(
        tokens({ total: 1, spentOn: [] }),
        tokens({ total: 1, spentOn: ['focus:2026-08-01'] }),
        true, '2026-08-01');

    assert.deepEqual(merged.spentOn, ['focus:2026-08-01']);
    assert.equal(merged.remaining, 0);
});

test('a spend made after the reset is kept', () => {
    const merged = mergeFreezeTokens(
        tokens({ total: 1, spentOn: [] }),
        tokens({ total: 1, spentOn: ['global:2026-08-04'] }),
        true, '2026-08-01');

    assert.deepEqual(merged.spentOn, ['global:2026-08-04']);
    assert.equal(merged.remaining, 0);
});

test('the reset cuts grants on the same line as spends', () => {
    /* A grant that forgave a voided spend has nothing left to forgive. Keeping
       it while dropping the spend would leave a credit standing against a freeze
       that no longer exists - the reset's refill, counted twice. */
    const reset = tokens({ total: 2, spentOn: [], grants: [], remaining: 2 });
    const missedIt = tokens({ total: 2, spentOn: ['global:2026-07-30'], grants: ['tier1:2026-07-31'] });

    const merged = mergeFreezeTokens(reset, missedIt, true, '2026-08-01');

    assert.deepEqual(merged.spentOn, []);
    assert.deepEqual(merged.grants, []);
    assert.equal(merged.remaining, 2);
});

test('a legacy entry names no day, so the reset voids it', () => {
    // It predates the ledger, which means it cannot predate the reset any less.
    const legacy = { total: 2, remaining: 0, tier1Earned: true, tier2Earned: true, initialized: true };

    const merged = mergeFreezeTokens(tokens({ spentOn: [] }), legacy, true, '2026-08-01');

    assert.deepEqual(merged.spentOn, []);
    assert.equal(merged.remaining, 2);
});

test('without a reset the ledger is untouched', () => {
    // Every merge on a device that has never reset goes through here, so the
    // floor has to be inert when there is none.
    const merged = mergeFreezeTokens(
        tokens({ spentOn: ['global:2026-07-30'] }),
        tokens({ spentOn: ['focus:2026-07-28'] }),
        true);

    assert.deepEqual(merged.spentOn.sort(), ['focus:2026-07-28', 'global:2026-07-30']);
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
