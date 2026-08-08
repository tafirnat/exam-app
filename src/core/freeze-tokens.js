/**
 * Freeze token accounting, as something two devices can agree on.
 *
 * `remaining` was a counter that each device decremented on its own. Merging it
 * is last-writer-wins like every other config field, and a counter is the one
 * shape that cannot survive that: two devices freezing two *different* missed
 * days each go 2 -> 1, the merge keeps one of those, and the day count and the
 * token count stop matching. Measured on three devices: three days frozen, one
 * token deducted. The error runs in the generous direction - free freezes - but
 * it is still an account that does not add up.
 *
 * So the tokens no longer store a count. They store *what they paid for*, and
 * the count is derived from it. A spend is named by the day it bought and the
 * track it bought it for, which makes it idempotent: three devices freezing the
 * same day produce the same name three times and it is one spend. Merging is a
 * union, which cannot lose one.
 *
 * ── Earning is a fact too ───────────────────────────────────────────────────
 *
 * Spending was modelled that way from the start; earning was not. `grantToken()`
 * used to *delete* the oldest spend, and deletion is exactly what a union cannot
 * carry: the push path merges against the remote before it writes, the remote
 * still holds the entry, and the entry comes straight back. Measured: a device
 * that had spent its one token and then earned it back pushed `remaining: 0` and
 * pulled `remaining: 0`, while `tier1Earned` latched true so the tier could
 * never pay out again. With sync connected the blue snowflake could be spent
 * once and never re-earned.
 *
 * A grant is therefore its own named entry, and the count is what the two
 * ledgers say together. A grant forgives one spend *older than itself* - which
 * is the whole rule, and it is enough to make the arithmetic order-independent:
 *
 *   - Earning while nothing is outstanding forgives nothing, so the credit
 *     cannot be banked against a freeze the user has not made yet.
 *   - Two devices earning the same tier on the same day write the same name, so
 *     the union holds one grant.
 *   - Two devices earning it on *different* days write two, and the second
 *     finds no older unforgiven spend to pay off - `remaining` is capped at
 *     `total` regardless, so nothing inflates.
 */

/**
 * Spends carried over from before this ledger existed. Both devices synthesise
 * the same names from their own `remaining`, so the union keeps the larger of
 * the two - which is what the old merge did with the counter - while everything
 * spent from here on is named for real.
 */
const LEGACY_SPEND = '_legacy:';

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** What a freeze is called: the track it protects, on the day it protects. */
export function spendName(track, dateKey) {
    return `${track}:${dateKey}`;
}

/**
 * What a grant is called: the tier that paid out, on the day it was earned.
 *
 * Dated rather than named for the tier alone, because a tier can be earned more
 * than once - the flags reset when the streak breaks. `tier1` on its own would
 * make the second payout the same entry as the first and the union would
 * swallow it.
 */
export function grantName(tier, dateKey) {
    return `${tier}:${dateKey}`;
}

/**
 * The day an entry names, read back off it.
 *
 * A legacy entry names no day, and `_legacy:0` sorts below every real day key,
 * which is the right answer for it twice over: it predates the ledger, so it
 * predates any reset the caller is comparing against, and it is the oldest
 * thing a grant could be forgiving.
 */
function entryDay(name) {
    const at = String(name).indexOf(':');
    return at < 0 ? '' : String(name).slice(at + 1);
}

/**
 * The ledger, synthesising one from `remaining` the first time a record from an
 * older build comes through. Mutates `tokens`, because callers write into it.
 */
export function spendLedger(tokens) {
    if (Array.isArray(tokens.spentOn)) return tokens.spentOn;

    const total = count(tokens.total);
    const alreadySpent = Math.max(0, Math.min(total, total - count(tokens.remaining)));
    tokens.spentOn = Array.from({ length: alreadySpent }, (_, i) => `${LEGACY_SPEND}${i}`);
    return tokens.spentOn;
}

/**
 * The grants ledger. Records written before grants were named carry none, and
 * an empty one gives exactly the old arithmetic - those records had their
 * grants applied by deleting spends, so their spend ledger is already short.
 */
export function grantLedger(tokens) {
    if (!Array.isArray(tokens.grants)) tokens.grants = [];
    return tokens.grants;
}

/**
 * How many spends the grants have paid off.
 *
 * Each grant forgives the oldest outstanding spend made *before* it. Both sides
 * are sorted first, so the pairing is a function of the two sets alone - not of
 * the order they were written in, or of which device is doing the arithmetic.
 */
function forgivenCount(spends, grants) {
    const outstanding = spends.map(entryDay).sort();
    const earned = grants.map(entryDay).sort();

    let next = 0;
    earned.forEach(grantDay => {
        if (next < outstanding.length && outstanding[next] < grantDay) next++;
    });
    return next;
}

/** How many freezes this record can still pay for. */
export function availableTokens(tokens) {
    const total = count(tokens.total);
    const spends = spendLedger(tokens);
    const unpaid = Math.max(0, spends.length - forgivenCount(spends, grantLedger(tokens)));
    return Math.max(0, Math.min(total, total - unpaid));
}

/** Rewrites `remaining` from the ledgers. They are the state; this is a view. */
export function recomputeRemaining(tokens) {
    tokens.remaining = availableTokens(tokens);
    return tokens;
}

/**
 * Charges one freeze to this token set.
 *
 * @returns {boolean} whether anything was charged - false when the ledger
 *          already holds this exact freeze, which is what makes a second device
 *          freezing the same day cost nothing.
 */
export function chargeSpend(tokens, name) {
    const ledger = spendLedger(tokens);
    if (ledger.includes(name)) return false;
    if (availableTokens(tokens) <= 0) return false;

    ledger.push(name);
    recomputeRemaining(tokens);
    return true;
}

/**
 * Hands a token back, which is what earning a tier does.
 *
 * Recorded rather than applied, so that it survives a merge - see the header.
 * Earning while nothing is outstanding is still worth recording: the entry is
 * dated, so it will never forgive a freeze made after it.
 *
 * @returns {boolean} whether this grant was new to the ledger.
 */
export function grantToken(tokens, name) {
    const grants = grantLedger(tokens);
    if (grants.includes(name)) return false;

    grants.push(name);
    recomputeRemaining(tokens);
    return true;
}

/**
 * Merges two devices' token records.
 *
 * The scalars - capacity, which tiers have been earned - come from whichever
 * side the config merge picked on its stamp, exactly as before. Both ledgers are
 * the union of both sides, so neither a spend nor a grant can be lost by having
 * been made on the device that happened to write second, and `remaining` is
 * recomputed from the pair.
 *
 * One case stays imperfect on purpose: if two devices charge the same freeze to
 * *different* tracks - one had a global token, the other only a cross-use joker
 * - the union holds two spends for one frozen day. Bounded, rare, and the
 * alternative is a lock this storage cannot offer.
 *
 * @param {string|null} [voidBefore] The day a progress reset happened on, as a
 *        day key. A spend buys one named day, and a reset drops every day record
 *        *before* the one it happened on - so a spend naming one of those bought
 *        something that no longer exists. Without this the union is the one rule
 *        a reset cannot survive: it is unconditional, so any device that had not
 *        yet seen the reset hands its pre-reset spends straight back and the
 *        reset's refill is undone one entry at a time. Grants are cut on the
 *        same line and for the same reason - a grant that forgave a voided spend
 *        has nothing left to forgive.
 *
 *        The reset day itself is kept, matching the day record, which survives
 *        it too. A spend for that day cannot predate the reset in any case: a day
 *        is only ever frozen once it is past - freezeMissedDaysIfPossible() looks
 *        at yesterday and the day before, never today - so a charge naming the
 *        reset day was necessarily made after the reset.
 */
export function mergeFreezeTokens(local, remote, localWins, voidBefore = null) {
    const l = local && typeof local === 'object' ? { ...local } : null;
    const r = remote && typeof remote === 'object' ? { ...remote } : null;
    if (!l) return r;
    if (!r) return l;

    const winner = { ...(localWins ? l : r) };
    /* Sorted, because a ledger is a set and the union's order is otherwise
       whichever side went in first - so two devices holding the same entries
       serialise differently. `remaining` is derived either way, but
       persistIfChanged() and the config merge both compare serialised values,
       and a difference that is only an ordering reads as a change and schedules
       a push that has nothing to say. */
    const union = (left, right) => {
        const all = Array.from(new Set([...left, ...right])).sort();
        return voidBefore ? all.filter(name => entryDay(name) >= voidBefore) : all;
    };

    winner.spentOn = union(spendLedger(l), spendLedger(r));
    winner.grants = union(grantLedger(l), grantLedger(r));
    return recomputeRemaining(winner);
}
