/**
 * The storage warning ladder.
 *
 * localStorage has a hard ceiling and no way to ask how close you are to it.
 * Until now the app only found out by hitting it: persist() caught the
 * QuotaExceededError and told the user their work had not been saved - true,
 * useful, and far too late. This module puts two rungs in front of that wall,
 * while there is still room to act.
 *
 * Two rules shape everything below.
 *
 * No percentages. "%73,4 dolu" is precision the browser does not actually
 * offer: the ceiling is unpublished and differs between browsers, so the number
 * is a guess wearing a decimal point. "About 900 more questions fit" is the same
 * measurement said in a unit the user owns.
 *
 * No warning without an action. A dialog that says "storage is filling up" and
 * offers OK teaches the user to dismiss dialogs. This one lists the sources they
 * have not touched in the longest time and does the work in place.
 */

import { AppState } from '../../core/state.js';
import { measureStorageUsage, readString, persist } from '../../core/storage.js';
import { t } from '../../core/i18n.js';
import { showConfirm, showToast } from '../../core/utils.js';
import { canUseRemoteArchive, getSyncHealth, SyncFailure } from '../../core/github-sync.js';
import { archiveSource, archiveRow, iconButton, ICONS, showArchiveModal } from './archive.js';
import { downloadSourceJSON, purgeSource } from './sources-ui.js';

export const QuotaLevel = Object.freeze({
    /** Worth mentioning once a day. Nothing is broken yet. */
    SUGGEST: 'suggest',
    /** Worth mentioning every session. The next big write may be the one that fails. */
    CRITICAL: 'critical'
});

const SUGGEST_RATIO = 0.60;

/* Why 85 and not 95: a localStorage write is atomic, so rewriting the 1.1 MB
   question library needs 1.1 MB free at that moment, on top of the copy already
   stored. The practical wall is therefore "quota minus the largest single
   value", which for a full library lands around here. */
const CRITICAL_RATIO = 0.85;

const NOTICE_DATE_KEY = 'focus_app_quota_notice_date';
const SOURCES_KEY = 'focus_app_sources';
const STATS_KEY = 'focus_app_stats_local';

/** How many sources the dialog offers. Three is a choice; ten is a chore. */
const CANDIDATE_COUNT = 3;

/* A library with no questions in it yet gives no average to work from. This is
   a plausible mid-size question with a handful of options, used only to keep the
   estimate finite until real data exists. */
const FALLBACK_QUESTION_BYTES = 600;

let shownThisSession = false;

// ── Measuring ───────────────────────────────────────────────────────────────

/** @returns {string|null} the rung this device is on, or null when it is fine. */
export function evaluateStorageLevel(usage = measureStorageUsage()) {
    if (usage.ratio >= CRITICAL_RATIO) return QuotaLevel.CRITICAL;
    if (usage.ratio >= SUGGEST_RATIO) return QuotaLevel.SUGGEST;
    return null;
}

/**
 * What one question costs on this device, averaged over the real library rather
 * than assumed: question length varies wildly between a vocabulary drill and a
 * reading-comprehension set, and the point of the estimate is to be about right
 * for *this* user.
 *
 * Both the library and the stats file grow per question, so both count.
 */
function averageQuestionBytes() {
    let questions = 0;
    (AppState.sources || []).forEach(s => {
        questions += (s.questions || []).length;
    });
    if (questions === 0) return FALLBACK_QUESTION_BYTES;

    const libraryBytes = readString(SOURCES_KEY, '').length * 2;
    const statsBytes = readString(STATS_KEY, '').length * 2;
    const average = (libraryBytes + statsBytes) / questions;
    return average > 0 ? average : FALLBACK_QUESTION_BYTES;
}

/** Rounds down to something that does not pretend to be exact. */
function roundedDown(n) {
    if (n >= 1000) return Math.floor(n / 100) * 100;
    if (n >= 100) return Math.floor(n / 50) * 50;
    if (n >= 20) return Math.floor(n / 10) * 10;
    return Math.floor(n);
}

/**
 * Roughly how many more questions fit.
 *
 * The headroom subtracted is the largest single stored value: adding a question
 * means rewriting the whole library, and that write peaks with the old copy
 * still resident, so the ceiling for stored bytes is quota minus one library.
 * Counting that as free space would be counting space that cannot be used.
 *
 * A library that has grown to more than half of everything stored therefore
 * reads as zero remaining even at the suggestion rung. That is not a rounding
 * artefact - it is the actual state, and it is why the wording for zero is
 * shared by both rungs rather than shouting.
 */
export function estimateRemainingQuestions(usage = measureStorageUsage()) {
    const free = usage.quotaBytes - usage.usedBytes - usage.largestValueBytes;
    if (free <= 0) return 0;
    return roundedDown(free / averageQuestionBytes());
}

// ── Picking what to offer ───────────────────────────────────────────────────

/**
 * When this source was last actually studied.
 *
 * `lastUsed` alone would be misleading: it is written when a source is switched
 * on, so a source left enabled for six months and never opened still looks
 * fresh. The honest signal is the newest review date among its own questions;
 * lastUsed and updatedAt are fallbacks for a source that has never been studied.
 */
export function lastStudiedAt(source) {
    let newest = 0;
    (source.questions || []).forEach(q => {
        /* Looked up by the whole composite key. Splitting a stat key on "_" to
           recover the source id breaks the moment one source id is a prefix of
           another, and stats then get attributed to the wrong source. */
        const stat = AppState.stats[`${source.id}_${q.id}`];
        if (!stat || !stat.lastReview) return;
        const at = new Date(stat.lastReview).getTime();
        if (Number.isFinite(at) && at > newest) newest = at;
    });
    if (newest > 0) return newest;
    return source.lastUsed || source.updatedAt || source.createdAt || 0;
}

/** Roughly what this source costs on disk. */
export function sourceBytes(source) {
    try {
        return JSON.stringify(source).length * 2;
    } catch {
        return 0;
    }
}

/**
 * The sources worth offering: coldest first.
 *
 * The source currently in focus is left out on purpose - proposing that the user
 * delete the thing they are studying is how a dialog loses its credibility.
 */
export function coldestSources(limit = CANDIDATE_COUNT) {
    return (AppState.sources || [])
        .filter(s => s && !s.archived && s.id !== AppState.currentSourceKey)
        .map(s => ({ source: s, studiedAt: lastStudiedAt(s), bytes: sourceBytes(s) }))
        .sort((a, b) => a.studiedAt - b.studiedAt)
        .slice(0, limit);
}

/**
 * True when archiving would actually free space on this device.
 *
 * Archiving is not a flag: the questions are uploaded to the Gist and only then
 * dropped from the device (archive.js keeps that order so a failed upload can
 * never lose data). Without a working GitHub connection the questions stay put -
 * so offering "archive" as a fix for full storage would be offering a button
 * that frees nothing.
 */
export function archivingFreesSpace() {
    if (!canUseRemoteArchive()) return false;
    return getSyncHealth().kind !== SyncFailure.AUTH;
}

// ── When to speak ───────────────────────────────────────────────────────────

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Something else already owns the screen - a dialog, or the onboarding tour. */
function screenIsBusy() {
    if (typeof document === 'undefined') return false;
    // Every open dialog except this one: leaving itself in the query makes the
    // check self-blocking, so the notice could never be shown a second time.
    if (document.querySelector('.modal-overlay.active:not(#storageNoticeOverlay)')) return true;
    if (document.querySelector('.onboarding-backdrop')) return true;
    const testView = document.getElementById('testView');
    // Never mid-test: this dialog asks the user to make a decision about their
    // library, which is the one thing they are not there to do.
    return !!(testView && testView.style.display !== 'none' && testView.style.display !== '');
}

// ── The dialog ──────────────────────────────────────────────────────────────

function formatStudied(studiedAt) {
    if (!studiedAt) return t('quota_never_studied');
    const days = Math.floor((Date.now() - studiedAt) / 86400000);
    if (days < 1) return t('quota_studied_today');
    try {
        const rtf = new Intl.RelativeTimeFormat(AppState.language || 'tr', { numeric: 'auto' });
        if (days < 30) return rtf.format(-days, 'day');
        if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
        return rtf.format(-Math.floor(days / 365), 'year');
    } catch {
        return new Date(studiedAt).toLocaleDateString();
    }
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}

function overlay() { return document.getElementById('storageNoticeOverlay'); }

export function closeStorageNotice() {
    const el = overlay();
    if (el) el.classList.remove('active');
}

/**
 * Redraws the list in place after an action, and closes the dialog once there is
 * nothing left to warn about - the reward for acting should be the dialog going
 * away, not another look at it.
 */
function refreshStorageNotice(level) {
    const usage = measureStorageUsage();
    if (!evaluateStorageLevel(usage)) {
        closeStorageNotice();
        showToast(t('quota_freed'));
        return;
    }
    renderStorageNotice(level, usage);
}

function renderStorageNotice(level, usage = measureStorageUsage()) {
    const subtitleEl = document.getElementById('storageNoticeSubtitle');
    const titleEl = document.getElementById('storageNoticeTitle');
    const listEl = document.getElementById('storageNoticeList');
    const hintEl = document.getElementById('storageNoticeHint');
    const emptyEl = document.getElementById('storageNoticeEmpty');
    if (!listEl) return;

    const remaining = estimateRemainingQuestions(usage);

    if (titleEl) {
        titleEl.innerText = level === QuotaLevel.CRITICAL
            ? t('quota_title_critical')
            : t('quota_title_suggest');
    }
    if (subtitleEl) {
        subtitleEl.innerText = remaining > 0
            ? t('quota_body', { count: remaining })
            : t('quota_body_full');
    }

    const canArchive = archivingFreesSpace();
    if (hintEl) {
        // Said plainly rather than by hiding a button silently: the user who
        // expects an archive action deserves to know why it is not there.
        hintEl.innerText = canArchive ? '' : t('quota_archive_unavailable');
        hintEl.style.display = canArchive ? 'none' : 'block';
    }

    listEl.innerHTML = '';
    const candidates = coldestSources();
    if (emptyEl) emptyEl.style.display = candidates.length === 0 ? 'block' : 'none';

    candidates.forEach(({ source, studiedAt, bytes }) => {
        const count = (source.questions || []).length;
        const actions = [];

        if (canArchive) {
            actions.push(iconButton(t('quota_action_archive'), ICONS.archive, async () => {
                // No second confirm: pressing this button in this dialog is the
                // decision, and archiving is reversible.
                await archiveSource(source.id, { confirm: false });
                refreshStorageNotice(level);
            }));
        }

        actions.push(iconButton(t('quota_action_download_delete'), ICONS.download, async () => {
            await downloadSourceJSON(source);
            if (!await showConfirm(t('quota_download_delete_confirm', { name: source.name }), t('quota_title_suggest'))) return;
            purgeSource(source.id);
            showToast(t('quota_removed', { name: source.name }));
            refreshStorageNotice(level);
        }));

        actions.push(iconButton(t('delete'), ICONS.trash, async () => {
            // Deletion is the one action here with no way back, so it keeps its
            // confirm even though the dialog itself was a deliberate choice.
            if (!await showConfirm(t('quota_delete_confirm', { name: source.name }), t('quota_title_suggest'))) return;
            purgeSource(source.id);
            showToast(t('quota_removed', { name: source.name }));
            refreshStorageNotice(level);
        }, true));

        listEl.appendChild(archiveRow({
            title: source.name,
            subtitle: `${t('questions_count', { count })} · ${formatBytes(bytes)} · ${formatStudied(studiedAt)}`,
            actions
        }));
    });
}

/**
 * Shows the ladder if this device is on it, this session has not shown it yet,
 * and the screen is free. Call it from the home view - anywhere else and the
 * dialog interrupts something.
 *
 * @param {{force?: boolean}} [options] `force` skips the frequency gate, for the
 *        menu entry that opens this on purpose.
 * @returns {boolean} whether the dialog was shown.
 */
export function maybeShowStorageNotice(options = {}) {
    const el = overlay();
    if (!el) return false;

    const usage = measureStorageUsage();
    const level = evaluateStorageLevel(usage);

    if (!options.force) {
        if (!level) return false;
        if (shownThisSession) return false;
        if (screenIsBusy()) return false;
        /* The suggestion rung is a nudge, not news: once a day is enough for
           something that is not yet a problem. The critical rung ignores the
           date and speaks in every session. */
        if (level === QuotaLevel.SUGGEST && readString(NOTICE_DATE_KEY, '') === todayKey()) return false;
    }

    const shownLevel = level || QuotaLevel.SUGGEST;
    renderStorageNotice(shownLevel, usage);
    el.classList.add('active');

    shownThisSession = true;
    if (shownLevel === QuotaLevel.SUGGEST) persist(NOTICE_DATE_KEY, todayKey());
    return true;
}

export function initStorageNoticeUI() {
    const el = overlay();
    if (!el) return;

    const dismiss = document.getElementById('storageNoticeDismissBtn');
    if (dismiss) dismiss.onclick = closeStorageNotice;

    const close = document.getElementById('storageNoticeCloseBtn');
    if (close) close.onclick = closeStorageNotice;

    const archive = document.getElementById('storageNoticeArchiveBtn');
    if (archive) {
        archive.onclick = () => {
            closeStorageNotice();
            showArchiveModal();
        };
    }
}

/** Test seam: a suite that changes the stored data wants the gate reopened. */
export function _resetStorageNotice() {
    shownThisSession = false;
}
