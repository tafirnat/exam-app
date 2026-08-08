import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* The eleven synced settings were written into the Gist payload for years with
   no reader at either end: nothing applied them on the way in, so a language or
   a timer changed on one device reached the Gist and stopped there. Nothing
   *could* have applied them either - the values carried no stamps, so the merge
   had nothing to rank the two sides by, and both available rules are broken.
   "Remote wins" kills the change on the device that made it at the next pull;
   "local wins" means it never reaches anyone. That is the trap the continuity
   config was in before (14), so these settings now use the same shape.

   The values themselves stay ordinary AppState fields under their own storage
   keys. What is new is one stamp per key and the two paths that move them. */

let AppState, initState, saveSyncedSettings, applySyncedSettings, getSettingsSnapshot,
    saveTtsSettings, SYNCED_SETTINGS, mergeSyncData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({
        AppState, initState, saveSyncedSettings, applySyncedSettings,
        getSettingsSnapshot, saveTtsSettings, SYNCED_SETTINGS
    } = await import('../src/core/state.js'));
    ({ mergeSyncData } = await import('../src/core/github-sync.js'));
});

beforeEach(() => {
    localStorage.clear();
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedQuickPresetIds = [];
});

/** A sync payload carrying nothing but the settings, which is all these weigh. */
function payload(settings) {
    return {
        sources: [], folders: [], quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        stats: {}, recentTests: [], studyActivity: {}, continuityConfig: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        settings
    };
}

/** Settings whose keys carry the stamps given, e.g. { language: [500, 'dev-a'] }. */
function stamped(values, stamps = {}) {
    const revisions = {};
    Object.entries(stamps).forEach(([key, [at, by]]) => { revisions[key] = { at, by }; });
    return { ...values, revisions };
}

// ── Stamping ────────────────────────────────────────────────────────────────

test('only the setting that actually changed gets a stamp', () => {
    initState({ force: true });
    AppState.deviceId = 'dev-a';

    AppState.ttsSpeed = 1.5;
    saveTtsSettings();

    const revisions = AppState.settingsRevisions;
    assert.ok(revisions.ttsSpeed.at > 0, 'the edited key is stamped');
    assert.equal(revisions.ttsSpeed.by, 'dev-a', 'and carries its writer');
    // saveTtsSettings() writes three keys; only one of them moved.
    assert.equal(revisions.ttsEnabled, undefined);
    assert.equal(revisions.language, undefined);
    assert.equal(revisions.timerCountdownLimit, undefined);
});

test('the settings as loaded are a baseline, not eleven edits', () => {
    // A device upgrading has all eleven on disk and no stamps anywhere. If
    // loading counted as editing, the first device to save after the upgrade
    // would claim every key and decide the other two devices' settings.
    localStorage.setItem('focus_app_lang', 'de');
    localStorage.setItem('focus_app_tts_speed', '1.25');

    initState({ force: true });
    AppState.deviceId = 'dev-a';
    AppState.timerCountdownLimit = 30;
    saveSyncedSettings();

    const revisions = AppState.settingsRevisions;
    assert.ok(revisions.timerCountdownLimit.at > 0);
    assert.equal(revisions.language, undefined, 'loaded, not edited');
    assert.equal(revisions.ttsSpeed, undefined, 'loaded, not edited');
});

test('the snapshot carries every synced setting', () => {
    initState({ force: true });
    const snapshot = getSettingsSnapshot();
    SYNCED_SETTINGS.forEach(key => {
        assert.ok(key in snapshot, `${key} is missing from the payload`);
    });
    // The AI provider list is deliberately not in it: a device's own set of
    // external tools is not a preference that should follow the user.
    assert.equal('aiProviders' in snapshot, false);
});

// ── Merging ─────────────────────────────────────────────────────────────────

test('the newer stamp wins, whichever device runs the merge', () => {
    const newer = stamped({ language: 'tr' }, { language: [900, 'dev-a'] });
    const older = stamped({ language: 'de' }, { language: [500, 'dev-b'] });

    // Same answer from both ends, which is the point: the value settles on the
    // stamp, not on who happened to sync last.
    assert.equal(mergeSyncData(payload(newer), payload(older)).settings.language, 'tr');
    assert.equal(mergeSyncData(payload(older), payload(newer)).settings.language, 'tr');
});

test('a change gets off the device that made it', () => {
    // The half a stampless merge could never do: local holding the newer value
    // has to be reported as something to push, or it stays here for ever.
    const local = stamped({ ttsSpeed: 1.5 }, { ttsSpeed: [900, 'dev-a'] });
    const remote = stamped({ ttsSpeed: 0.5 }, { ttsSpeed: [500, 'dev-b'] });

    const merged = mergeSyncData(payload(local), payload(remote));

    assert.equal(merged.settings.ttsSpeed, 1.5);
    assert.equal(merged.hasLocalChanges, true);
});

test('switching a toggle off travels like any other change', () => {
    /* `false`, `0` and `''` are values somebody chose, not absent ones. A merge
       that reads them as empty would make every setting a one-way switch. */
    const local = stamped({ ttsEnabled: false }, { ttsEnabled: [900, 'dev-a'] });
    const remote = stamped({ ttsEnabled: true }, { ttsEnabled: [500, 'dev-b'] });

    assert.equal(mergeSyncData(payload(local), payload(remote)).settings.ttsEnabled, false);

    const clearedPrompt = stamped({ customAIPrompt: '' }, { customAIPrompt: [900, 'dev-a'] });
    const oldPrompt = stamped({ customAIPrompt: 'summarise' }, { customAIPrompt: [500, 'dev-b'] });

    assert.equal(mergeSyncData(payload(clearedPrompt), payload(oldPrompt)).settings.customAIPrompt, '');
});

// ── Applying ────────────────────────────────────────────────────────────────

test('an applied setting reaches the key its own reader uses', () => {
    initState({ force: true });

    applySyncedSettings(
        { language: 'de', ttsSpeed: 1.25, timerCountdownLimit: 30 },
        {
            language: { at: 900, by: 'dev-b' },
            ttsSpeed: { at: 900, by: 'dev-b' },
            timerCountdownLimit: { at: 900, by: 'dev-b' }
        }
    );

    // Written where the settings screen and the boot read already look, so a
    // pulled value is indistinguishable from one set on this device.
    assert.equal(localStorage.getItem('focus_app_lang'), 'de');
    assert.equal(localStorage.getItem('focus_app_tts_speed'), '1.25');
    assert.equal(localStorage.getItem('focus_app_timer_limit'), '30');

    initState({ force: true });
    assert.equal(AppState.language, 'de');
    assert.equal(AppState.ttsSpeed, 1.25);
    assert.equal(AppState.timerCountdownLimit, 30);
});

test('a setting nobody has ever set is left alone', () => {
    /* Every device carries all eleven whether their values mean anything or not.
       Applying unstamped ones would let the first device to push after the
       upgrade decide the language and the timer for the other two - a setting
       changing by itself is the one behaviour this must not have. */
    initState({ force: true });
    AppState.language = 'tr';

    const changed = applySyncedSettings({ language: 'de', ttsSpeed: 2 }, {});

    assert.equal(changed, false);
    assert.equal(AppState.language, 'tr');
    assert.equal(localStorage.getItem('focus_app_lang'), null);
});

test('an applied setting is not treated as a local edit afterwards', () => {
    // Re-stamping on the way in would date the pulled value to now, so this
    // device would out-rank the one it came from and push it straight back.
    initState({ force: true });
    AppState.deviceId = 'dev-a';

    applySyncedSettings({ language: 'de' }, { language: { at: 500, by: 'dev-b' } });
    assert.deepEqual(AppState.settingsRevisions.language, { at: 500, by: 'dev-b' });

    // An unrelated later edit must not drag the pulled key's stamp forward.
    AppState.ttsSpeed = 2;
    saveSyncedSettings();

    assert.deepEqual(AppState.settingsRevisions.language, { at: 500, by: 'dev-b' });
    assert.equal(AppState.settingsRevisions.ttsSpeed.by, 'dev-a');
});

test('a progress reset does not touch the settings', () => {
    // A reset is about progress. The language, the timer and the AI prompt are
    // not progress, and clearProgressData() leaves them alone locally too.
    const local = stamped({ language: 'tr' }, { language: [900, 'dev-a'] });
    const remote = stamped({ language: 'de' }, { language: [500, 'dev-b'] });

    const merged = mergeSyncData(
        { ...payload(local), lastProgressResetTimestamp: 0 },
        { ...payload(remote), lastProgressResetTimestamp: 10000, lastUpdated: 12000 }
    );

    assert.equal(merged.settings.language, 'tr');
});
