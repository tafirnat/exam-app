import { detectLanguage, detectTranslationTarget } from './i18n.js';

export const AppState = {
    rawQuestions: [],
    currentTest: [],
    currentIndex: 0,
    userAnswers: {},
    isAnswerChecked: {},
    shuffledOptionsMap: {},
    stats: JSON.parse(localStorage.getItem('focus_app_stats_local') || '{}'),
    sources: (() => {
        const stored = localStorage.getItem('focus_app_sources');
        const sources = JSON.parse(stored || '[]');
        // Cleanup: remove any sources without questions (leftovers from previous broken logic)
        return sources.filter(s => s && s.questions && Array.isArray(s.questions));
    })(),
    totalStats: JSON.parse(localStorage.getItem('focus_app_stats_global') || '{}'),
    currentSourceKey: localStorage.getItem('focus_app_current_source') || null,
    examTitle: 'Exam App',
    language: detectLanguage(),
    translationTarget: detectTranslationTarget(),
    translationEnabled: JSON.parse(localStorage.getItem('focus_app_translation_enabled') ?? 'true'),
    recentTests: JSON.parse(localStorage.getItem('focus_app_recent_tests') || '[]'),
    testTracking: null,
    previewQuestion: null,
    searchKeyword: '',
    lastStatsScrollPos: 0,
    activeStatsFilter: 'all',
    activeStatsSortField: 'original', // 'original', 'coeff', 'success', 'wrong'
    activeStatsSortDir: 'asc' // 'asc', 'desc'
};

export function saveStats() {
    localStorage.setItem('focus_app_stats_local', JSON.stringify(AppState.stats));
}

export function saveSources() {
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    localStorage.setItem('focus_app_current_source', key || '');
}

export function saveRecentTests() {
    localStorage.setItem('focus_app_recent_tests', JSON.stringify(AppState.recentTests));
}
