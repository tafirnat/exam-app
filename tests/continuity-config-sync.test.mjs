import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* The continuity config used to sync as one blob under "remote wins whenever it
   has anything". That rule could not carry a change off the device that made it:
   the push path merges before it writes, so it folded remote's blob back over
   the very change it was pushing, and the next pull reverted the change locally
   too. Picking a focus source, earning a freeze token, spending one - each of
   them died where it happened, and three devices kept recomputing streaks from
   three configs that never converged.

   Every top-level key is now its own record with its own stamp. These cases pin
   that down: the stamping, the per-key pick, and the two boundaries that decide
   whether the change survives an upgrade or a reset. */

let AppState, initState, saveContinuityConfig, mergeSyncData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState, initState, saveContinuityConfig } = await import('../src/core/state.js'));
    ({ mergeSyncData } = await import('../src/core/github-sync.js'));
});

/** A sync payload carrying nothing but the config, which is all these cases weigh. */
function payload(continuityConfig, extra = {}) {
    return {
        sources: [], folders: [], quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        stats: {}, recentTests: [], studyActivity: {}, totalStats: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        continuityConfig,
        ...extra
    };
}

/** A config whose keys carry the stamps given, e.g. { focusSources: [500, 'dev-a'] }. */
function stamped(values, stamps = {}) {
    const revisions = {};
    Object.entries(stamps).forEach(([key, [at, by]]) => {
        revisions[key] = { at, by };
    });
    return { ...values, revisions };
}

const tokens = (remaining) => ({
    total: 2, remaining, tier1Earned: true, tier2Earned: true, initialized: true
});

beforeEach(() => {
    localStorage.clear();
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedQuickPresetIds = [];
});

// ── Stamping ────────────────────────────────────────────────────────────────

test('only the key that actually changed gets a new stamp', () => {
    initState({ force: true });
    AppState.deviceId = 'dev-a';

    AppState.continuityConfig.focusSources = ['anatomy'];
    saveContinuityConfig();

    const revisions = AppState.continuityConfig.revisions;
    assert.ok(revisions.focusSources.at > 0, 'the edited key is stamped');
    assert.equal(revisions.focusSources.by, 'dev-a', 'and carries its writer');
    // Stamping untouched keys would hand this device authority over values it
    // never edited, which is how a blob merge loses the other device's work.
    assert.equal(revisions.freezeTokens, undefined);
    assert.equal(revisions.notificationSettings, undefined);
});

test('the config as loaded is a baseline, not an edit', () => {
    // A device upgrading has a full config on disk and no stamps anywhere. If
    // loading counted as editing, the first device to save after the upgrade
    // would claim every key and out-rank everyone else's real changes.
    localStorage.setItem('focus_app_continuity_config', JSON.stringify({
        focusSources: ['anatomy'],
        freezeTokens: tokens(1)
    }));

    initState({ force: true });
    AppState.deviceId = 'dev-a';
    AppState.continuityConfig.streakRunOrder = 'grouped';
    saveContinuityConfig();

    const revisions = AppState.continuityConfig.revisions;
    assert.ok(revisions.streakRunOrder.at > 0);
    assert.equal(revisions.focusSources, undefined, 'loaded, not edited');
    assert.equal(revisions.freezeTokens, undefined, 'loaded, not edited');
});

test('the apply path adopts the stamps it was given rather than re-dating them', () => {
    initState({ force: true });
    AppState.deviceId = 'dev-a';

    // What a pull hands over: values that won on another device, with the
    // stamps they won with.
    AppState.continuityConfig = stamped(
        { focusSources: ['physio'] },
        { focusSources: [500, 'dev-b'] }
    );
    saveContinuityConfig({ stamp: false });

    assert.deepEqual(AppState.continuityConfig.revisions.focusSources, { at: 500, by: 'dev-b' });
});

test('a pulled value is not treated as a local edit on the next save', () => {
    initState({ force: true });
    AppState.deviceId = 'dev-a';

    AppState.continuityConfig = stamped(
        { focusSources: ['physio'], freezeTokens: tokens(1) },
        { focusSources: [500, 'dev-b'] }
    );
    saveContinuityConfig({ stamp: false });

    // An unrelated later edit must not drag the pulled key's stamp forward with
    // it - that would push dev-b's own value back at dev-b under dev-a's name.
    AppState.continuityConfig.streakRunOrder = 'mixed';
    saveContinuityConfig();

    assert.deepEqual(AppState.continuityConfig.revisions.focusSources, { at: 500, by: 'dev-b' });
    assert.ok(AppState.continuityConfig.revisions.streakRunOrder.at > 0);
});

// ── The per-key pick ────────────────────────────────────────────────────────

test('a locally stamped change reaches the remote instead of being folded away', () => {
    const local = stamped(
        { focusSources: ['anatomy', 'physio'], freezeTokens: tokens(1) },
        { focusSources: [2000, 'dev-b'] }
    );
    const remote = stamped({ focusSources: [], freezeTokens: tokens(1) }, {});

    const merged = mergeSyncData(payload(local), payload(remote));

    assert.deepEqual(merged.continuityConfig.focusSources, ['anatomy', 'physio']);
    // Without this the pull keeps the right value on this device and leaves the
    // remote - and therefore every other device - on the old one.
    assert.equal(merged.hasLocalChanges, true);
});

test('each key is decided on its own stamp, so two devices keep both changes', () => {
    // The whole point of dropping the blob: dev-a picked focus sources, dev-b
    // set the run order, and neither edit knows about the other.
    const local = stamped(
        { focusSources: ['anatomy'], streakRunOrder: 'mixed' },
        { focusSources: [3000, 'dev-a'], streakRunOrder: [1000, 'dev-a'] }
    );
    const remote = stamped(
        { focusSources: [], streakRunOrder: 'grouped' },
        { focusSources: [1000, 'dev-b'], streakRunOrder: [3000, 'dev-b'] }
    );

    const merged = mergeSyncData(payload(local), payload(remote)).continuityConfig;

    assert.deepEqual(merged.focusSources, ['anatomy'], 'newer local key survives');
    assert.equal(merged.streakRunOrder, 'grouped', 'newer remote key survives');
});

test('a spent freeze token propagates - the decrement a max merge could never carry', () => {
    const local = stamped({ freezeTokens: tokens(0) }, { freezeTokens: [2000, 'dev-a'] });
    const remote = stamped({ freezeTokens: tokens(1) }, { freezeTokens: [1000, 'dev-b'] });

    const merged = mergeSyncData(payload(local), payload(remote));

    assert.equal(merged.continuityConfig.freezeTokens.remaining, 0);
    assert.equal(merged.hasLocalChanges, true);
});

test('the winning value carries its stamp forward, so the next device compares fairly', () => {
    const local = stamped({ focusSources: ['anatomy'] }, { focusSources: [2000, 'dev-a'] });
    const remote = stamped({ focusSources: [] }, { focusSources: [1000, 'dev-b'] });

    const merged = mergeSyncData(payload(local), payload(remote)).continuityConfig;

    // Re-stamping to "now" here would make the merge result out-rank a genuinely
    // newer edit sitting on a third device.
    assert.deepEqual(merged.revisions.focusSources, { at: 2000, by: 'dev-a' });
});

test('identical stamps resolve the same way on both devices', () => {
    const a = stamped({ focusSources: ['anatomy'] }, { focusSources: [2000, 'dev-a'] });
    const b = stamped({ focusSources: ['physio'] }, { focusSources: [2000, 'dev-b'] });

    const fromA = mergeSyncData(payload(a), payload(b)).continuityConfig;
    const fromB = mergeSyncData(payload(b), payload(a)).continuityConfig;

    // Any rule works as long as both devices reach the same one; a rule that
    // depended on which side was "local" would leave them disagreeing forever.
    assert.deepEqual(fromA.focusSources, fromB.focusSources);
});

test('a key neither side ever stamped keeps its content when the other side has none', () => {
    // Both devices are mid-upgrade: no stamps anywhere. A real value has to beat
    // an absent one, or the upgrade silently clears the user's selection.
    const local = stamped({ focusSources: ['anatomy'], focusPools: [] }, {});
    const remote = stamped({ focusSources: [], focusPools: [] }, {});

    const merged = mergeSyncData(payload(local), payload(remote));

    assert.deepEqual(merged.continuityConfig.focusSources, ['anatomy']);
    assert.equal(merged.hasLocalChanges, true);
});

test('a stamped key beats an unstamped one whatever the content', () => {
    const local = stamped({ focusSources: [] }, { focusSources: [1000, 'dev-a'] });
    const remote = stamped({ focusSources: ['stale'] }, {});

    const merged = mergeSyncData(payload(local), payload(remote)).continuityConfig;

    // Deselecting every focus source is a real edit; an unstamped record is at
    // best an older copy of the same thing.
    assert.deepEqual(merged.focusSources, []);
});

test('a key only one side has ever heard of survives the merge', () => {
    const local = stamped({ focusSources: [] }, {});
    const remote = stamped({ notificationSettings: { enabled: true } }, { notificationSettings: [900, 'dev-b'] });

    const merged = mergeSyncData(payload(local), payload(remote)).continuityConfig;

    // Keys are read off both objects rather than a fixed list, so a field added
    // in a later build merges without anyone registering it.
    assert.deepEqual(merged.notificationSettings, { enabled: true });
    assert.deepEqual(merged.focusSources, []);
});

// ── The reset boundary ──────────────────────────────────────────────────────

test('a newer progress reset still takes the whole config, stamps and all', () => {
    const local = stamped({ freezeTokens: tokens(1), focusSources: [] }, {});
    const remote = stamped(
        { freezeTokens: tokens(0), focusSources: ['anatomy'] },
        { freezeTokens: [9000, 'dev-b'], focusSources: [9000, 'dev-b'] }
    );

    const merged = mergeSyncData(
        payload(local, { lastProgressResetTimestamp: 10000 }),
        payload(remote, { lastProgressResetTimestamp: 0 })
    );

    // Letting individual keys survive a reset by out-stamping it would undo the
    // reset one field at a time.
    assert.equal(merged.continuityConfig.freezeTokens.remaining, 1);
    assert.deepEqual(merged.continuityConfig.focusSources, []);
    assert.equal(merged.hasLocalChanges, true);
});

test('the remote wins the whole config when its progress reset is the newer one', () => {
    const local = stamped({ focusSources: ['anatomy'] }, { focusSources: [9000, 'dev-a'] });
    const remote = stamped({ focusSources: [] }, {});

    const merged = mergeSyncData(
        payload(local, { lastProgressResetTimestamp: 0 }),
        payload(remote, { lastProgressResetTimestamp: 10000 })
    );

    assert.deepEqual(merged.continuityConfig.focusSources, []);
});
