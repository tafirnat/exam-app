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

/** Rewrites `remaining` from the ledger. The ledger is the state; this is a view. */
export function recomputeRemaining(tokens) {
    const total = count(tokens.total);
    tokens.remaining = Math.max(0, Math.min(total, total - spendLedger(tokens).length));
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
    if (count(tokens.total) - ledger.length <= 0) return false;

    ledger.push(name);
    recomputeRemaining(tokens);
    return true;
}

/**
 * Hands a token back, which is what earning a tier does.
 *
 * Drops the oldest entry rather than adding to a count, so the ledger stays the
 * only place a spend is recorded. Legacy entries go first: they are the least
 * specific thing in there, and forgetting one costs nothing a named spend
 * would not also have cost.
 */
export function grantToken(tokens) {
    const ledger = spendLedger(tokens);
    if (ledger.length > 0) ledger.shift();
    return recomputeRemaining(tokens);
}

/**
 * Merges two devices' token records.
 *
 * The scalars - capacity, which tiers have been earned - come from whichever
 * side the config merge picked on its stamp, exactly as before. The ledger is
 * the union of both, so a spend cannot be lost by having been made on the
 * device that happened to write second, and `remaining` is recomputed from it.
 *
 * One case stays imperfect on purpose: if two devices charge the same freeze to
 * *different* tracks - one had a global token, the other only a cross-use joker
 * - the union holds two spends for one frozen day. Bounded, rare, and the
 * alternative is a lock this storage cannot offer.
 */
export function mergeFreezeTokens(local, remote, localWins) {
    const l = local && typeof local === 'object' ? { ...local } : null;
    const r = remote && typeof remote === 'object' ? { ...remote } : null;
    if (!l) return r;
    if (!r) return l;

    const winner = { ...(localWins ? l : r) };
    winner.spentOn = Array.from(new Set([...spendLedger(l), ...spendLedger(r)]));
    return recomputeRemaining(winner);
}
