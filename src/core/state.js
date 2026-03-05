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
        let sources = JSON.parse(stored || '[]');

        const templateId = 'template-default';
        const templateExists = sources.some(s => s.id === templateId);

        if (!templateExists) {
            sources.unshift({
                id: templateId,
                name: 'Standard Exam Example',
                url: './examples/standard-exam.json',
                timestamp: Date.now()
            });
            localStorage.setItem('focus_app_sources', JSON.stringify(sources));
        }
        return sources;
    })(),
    totalStats: JSON.parse(localStorage.getItem('focus_app_stats_global') || '{}'),
    currentSourceKey: localStorage.getItem('focus_app_current_source') || null,
    examTitle: 'Focus App',
    language: detectLanguage(),
    translationTarget: detectTranslationTarget()
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
