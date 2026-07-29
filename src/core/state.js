import { detectLanguage, detectTranslationTarget } from './i18n.js';

/**
 * Safely reads and parses a JSON item from localStorage.
 * Returns fallback value if item is missing or corrupted.
 */
export function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null || item === undefined) return fallback;
        return JSON.parse(item);
    } catch (e) {
        console.warn(`[AppState] Corrupted JSON in localStorage key "${key}", falling back.`, e);
        return fallback;
    }
}

export const DEFAULT_AI_PROVIDERS = [
    { id: 'google', name: 'Google AI (Search)', url: 'https://www.google.com/search?q={PROMPT}&udm=50', domain: 'google.com' },
    { id: 'chatgpt', name: 'ChatGPT (GPT-4o)', url: 'https://chatgpt.com/?prompt={PROMPT}&model=gpt-4o&hints=search', domain: 'chatgpt.com' },
    { id: 'perplexity', name: 'Perplexity AI', url: 'https://www.perplexity.ai/search?focus=internet&copilot=true&q={PROMPT}', domain: 'perplexity.ai' },
    { id: 'claude', name: 'Claude (Anthropic)', url: 'https://claude.ai/new?q={PROMPT}', domain: 'claude.ai' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/?q={PROMPT}', domain: 'deepseek.com' }
];

export function getDefaultSampleSources() {
    return [
        {
            id: 'reading_feature_guide',
            name: 'Reading & Topic Review Feature Guide',
            folderId: 'default-folder',
            questionCount: 3,
            lastUsed: Date.now(),
            active: true,
            order: 0,
            questions: [
                {
                    id: 'read_001',
                    type: 'reading',
                    category: 'Feature Overview',
                    tags: ['guide', 'reading-mode', 'overview'],
                    starred: true,
                    flagged: false,
                    content: {
                        text: '<h3>📖 Reading & Topic Review Content in Exam App</h3><p>The <strong>Reading Content</strong> feature enables structured, HTML-formatted study passages, cheat sheets, and topic summaries directly inside Exam App. Unlike traditional question-and-answer items, reading cards provide an immersive, distraction-free environment for initial learning and rapid revision.</p><h4>Key Characteristics:</h4><ul><li><strong>HTML & Rich Formatting:</strong> Seamlessly renders headings, bold emphasis, bullet points, blockquotes, and inline code elements.</li><li><strong>Seamless Feature Compatibility:</strong> Fully supports native <em>Text-to-Speech (TTS)</em>, <em>Google Translation</em>, <em>Text Highlighting</em>, and <em>Personal Note Taking</em>.</li><li><strong>Spaced Repetition (FSRS):</strong> Evaluated using confidence ratings (e.g., <em>Hard / Good / Easy</em>) to automatically schedule future topic reviews based on retention stability.</li><li><strong>Auto-Hiding Navigation:</strong> On mobile devices, scrolling down smoothly hides the bottom navigation bar to maximize vertical reading space.</li></ul><blockquote><p><mark>Note:</mark> Reading cards can be used as standalone study modules or mixed directly into existing exam question banks.</p></blockquote>'
                    },
                    answer: {
                        explanation: 'This card provides an overview of the Reading Content feature. You can star or flag this card for quick access during revision.'
                    }
                },
                {
                    id: 'read_002',
                    type: 'reading',
                    category: 'Best Practices',
                    tags: ['use-cases', 'json-schema', 'code-blocks'],
                    starred: false,
                    flagged: true,
                    content: {
                        text: '<h3>💡 Suitable Use Cases & Schema Structure</h3><p>Reading cards are ideal for technical concepts, legal/medical summaries, system architecture overviews, and formula cheat sheets that require contextual reading before test-taking.</p><h4>When to Use Reading Cards:</h4><ul><li><strong>Core Concept Revision:</strong> High-level topic summaries before answering practice exams.</li><li><strong>Technical Code Walkthroughs:</strong> Explaining code snippets, syntax rules, and algorithm steps.</li><li><strong>Formula & Reference Sheets:</strong> Quick lookup tables and key definitions.</li></ul><h4>Example JSON Schema Structure:</h4><pre><code class="language-json">{\n  "id": "topic_101",\n  "type": "reading",\n  "category": "System Architecture",\n  "tags": ["networking", "tcp-ip"],\n  "starred": true,\n  "content": {\n    "text": "&lt;h3&gt;TCP/IP Model Overview&lt;/h3&gt;&lt;p&gt;The TCP/IP suite consists of four abstraction layers...&lt;/p&gt;"\n  },\n  "answer": {\n    "explanation": "Key reference sheet for OSI vs TCP/IP layer comparisons."\n  }\n}</code></pre><p>This structure ensures 100% compatibility with the <em>Obsidian ExamApp Sync</em> plugin and GitHub Gist cross-device backups.</p>'
                    },
                    answer: {
                        explanation: 'Example of a technical reading card containing code blocks and JSON schema usage guidance.'
                    }
                },
                {
                    id: 'quiz_001',
                    type: 'single_choice',
                    category: 'Knowledge Check',
                    tags: ['verification', 'mixed-mode'],
                    starred: false,
                    flagged: false,
                    content: {
                        text: 'How do Reading Cards integrate with Exam App\'s Spaced Repetition (FSRS) engine?'
                    },
                    options: [
                        { id: 1, text: 'They are excluded from FSRS completely.' },
                        { id: 2, text: 'They use confidence buttons (Hard / Good / Easy) to schedule future review intervals based on retention stability.' },
                        { id: 3, text: 'They automatically mark all topics as learned on first view.' },
                        { id: 4, text: 'They require typing the entire passage from memory.' }
                    ],
                    answer: {
                        correct_ids: [2],
                        explanation: 'Reading Cards utilize FSRS confidence feedback (Hard/Good/Easy) to determine retrievability and schedule future reviews optimal for long-term memory retention.'
                    }
                }
            ]
        },
        {
            id: 'example_questions',
            name: 'Sample Quiz (Beispiel Test)',
            folderId: null,
            questionCount: 3,
            lastUsed: Date.now(),
            active: true,
            order: 0,
            questions: [
                {
                    id: 'q1',
                    type: 'single_choice',
                    category: 'Allgemein',
                    tags: ['genel-bilgi', 'coğrafya'],
                    content: { text: 'Was ist die Hauptstadt von Deutschland?' },
                    options: [
                        { id: 1, text: 'Berlin' },
                        { id: 2, text: 'München' },
                        { id: 3, text: 'Hamburg' },
                        { id: 4, text: 'Frankfurt' }
                    ],
                    answer: {
                        correct_ids: [1],
                        explanation: 'Berlin ist seit 1990 die Hauptstadt Deutschlands.'
                    }
                },
                {
                    id: 'q2',
                    type: 'multiple_choice',
                    category: 'Geographie',
                    tags: ['coğrafya', 'avrupa'],
                    content: { text: 'Welche dieser Länder liegen in Europa?' },
                    options: [
                        { id: 1, text: 'Frankreich' },
                        { id: 2, text: 'Japan' },
                        { id: 3, text: 'Spanien' },
                        { id: 4, text: 'Brasilien' }
                    ],
                    answer: {
                        correct_ids: [1, 3],
                        explanation: 'Frankreich und Spanien liegen in Europa.'
                    }
                },
                {
                    id: 'q3',
                    type: 'text_input',
                    category: 'Mathe',
                    tags: ['matematik', 'temel'],
                    content: { text: 'Wieviel ist 5 + 5?' },
                    answer: {
                        accepted_texts: ['10', 'zehn'],
                        caseSensitive: false,
                        explanation: '5 + 5 = 10'
                    }
                }
            ]
        }
    ];
}

export const AppState = {
    rawQuestions: [],
    currentTest: [],
    currentIndex: 0,
    userAnswers: {},
    isAnswerChecked: {},
    shuffledOptionsMap: {},
    stats: safeJSONParse('focus_app_stats_local', {}),
    folders: (() => {
        let folders = safeJSONParse('focus_app_folders', null);
        if (folders === null || (Array.isArray(folders) && folders.length === 0)) {
            // Create a default folder for sample templates
            folders = [
                { id: 'default-folder', name: 'Sample Folder', color: '#0098fe', description: 'Varsayılan örnek klasör', order: 0 }
            ];
            try { localStorage.setItem('focus_app_folders', JSON.stringify(folders)); } catch(e){}
        }
        return Array.isArray(folders) ? folders : [];
    })(),
    sources: (() => {
        let sources = safeJSONParse('focus_app_sources', null);
        if (sources === null || (Array.isArray(sources) && sources.length === 0)) {
            sources = getDefaultSampleSources();
            try { localStorage.setItem('focus_app_sources', JSON.stringify(sources)); } catch(e){}
        }
        return Array.isArray(sources) ? sources.filter(s => s && s.questions && Array.isArray(s.questions)) : [];
    })(),
    totalStats: safeJSONParse('focus_app_stats_global', {}),
    currentSourceKey: localStorage.getItem('focus_app_current_source') || null,
    examTitle: 'Exam App',
    language: detectLanguage(),
    translationTarget: detectTranslationTarget(),
    translationEnabled: safeJSONParse('focus_app_translation_enabled', true),
    recentTests: safeJSONParse('focus_app_recent_tests', []).slice(0, 10),
    testTracking: null,
    previewQuestion: null,
    searchKeyword: '',
    lastStatsScrollPos: 0,
    activeStatsFilter: 'all',
    activeStatsSortField: 'original', // 'original', 'coeff', 'success', 'wrong'
    activeStatsSortDir: 'asc', // 'asc', 'desc'
    customAIPrompt: localStorage.getItem('focus_app_custom_ai_prompt') || '',
    aiProviders: safeJSONParse('focus_app_ai_providers', DEFAULT_AI_PROVIDERS),
    ttsEnabled: safeJSONParse('focus_app_tts_enabled', false),
    ttsAutoplay: safeJSONParse('focus_app_tts_autoplay', false),
    ttsSpeed: parseFloat(localStorage.getItem('focus_app_tts_speed') ?? '0.5'),
    timerStopwatchEnabled: safeJSONParse('focus_app_timer_stopwatch', false),
    timerCountdownEnabled: safeJSONParse('focus_app_timer_countdown', false),
    timerCountdownLimit: parseInt(localStorage.getItem('focus_app_timer_limit') || '59', 10),
    timerAutoCheckEnabled: safeJSONParse('focus_app_timer_auto_check', true), // Default to true
    currentTtsVoice: null, // Randomly selected at test start
    viewHistory: [], // Stack to track last 10 visited screens
    navigationSourceView: null, // View to return to from Tag Mode
    activeTagFilter: null, // Currently active tag Filter for stats view
    questionMap: {}, // composite key (sourceId_questionId) → question object
    githubToken: localStorage.getItem('focus_app_github_token') || null,
    githubGistId: localStorage.getItem('focus_app_github_gist_id') || null,
    githubUser: safeJSONParse('focus_app_github_user', null),
    lastGithubUser: localStorage.getItem('focus_app_last_github_user') || null,
    lastSyncTime: parseInt(localStorage.getItem('focus_app_last_sync') || '0', 10),
    deletedSourceIds: safeJSONParse('focus_app_deleted_sources', []),
    deletedFolderIds: safeJSONParse('focus_app_deleted_folders', []),
    githubGistUrl: localStorage.getItem('focus_app_github_gist_url') || null
};

/**
 * Sources the user still works with: everything except the archive.
 * Archived sources stay in AppState.sources (so sync keeps merging them by id),
 * so every list, counter and question pool has to filter them out explicitly.
 */
export function liveSources() {
    return AppState.sources.filter(s => !s.archived);
}

export function archivedSources() {
    return AppState.sources.filter(s => s.archived);
}

export function liveFolders() {
    return (AppState.folders || []).filter(f => !f.archived);
}

/**
 * Stamps a record as locally modified. `updatedAt` is the primary tiebreaker in
 * mergeSyncData - without it an archived stub would lose against the remote copy
 * that still carries questions.
 */
export function touch(record) {
    if (record) record.updatedAt = Date.now();
    return record;
}

export function clearLocalStudyData() {
    AppState.folders = [
        { id: 'default-folder', name: 'Sample Folder', color: '#0098fe', description: 'Varsayılan örnek klasör', order: 0 }
    ];
    AppState.sources = getDefaultSampleSources();
    AppState.stats = {};
    AppState.totalStats = {};
    AppState.recentTests = [];
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.currentSourceKey = null;

    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
    localStorage.removeItem('focus_app_stats_local');
    localStorage.removeItem('focus_app_stats_global');
    localStorage.removeItem('focus_app_recent_tests');
    localStorage.removeItem('focus_app_deleted_sources');
    localStorage.removeItem('focus_app_deleted_folders');
    localStorage.removeItem('focus_app_current_source');
    localStorage.removeItem('focus_app_active_test');

    clearActiveTest();
}

export function trackDeletedSource(id) {
    if (!id) return;
    if (!AppState.deletedSourceIds.includes(id)) {
        AppState.deletedSourceIds.push(id);
        localStorage.setItem('focus_app_deleted_sources', JSON.stringify(AppState.deletedSourceIds));
    }
}

export function trackDeletedFolder(id) {
    if (!id) return;
    if (!AppState.deletedFolderIds.includes(id)) {
        AppState.deletedFolderIds.push(id);
        localStorage.setItem('focus_app_deleted_folders', JSON.stringify(AppState.deletedFolderIds));
    }
}

export function saveStats() {
    localStorage.setItem('focus_app_stats_local', JSON.stringify(AppState.stats));
    import('./github-sync.js').then(m => m.scheduleSync(1500)).catch(() => {});
}

export function saveCustomAIPrompt() {
    localStorage.setItem('focus_app_custom_ai_prompt', AppState.customAIPrompt);
}


export function saveAiProviders() {
    localStorage.setItem('focus_app_ai_providers', JSON.stringify(AppState.aiProviders));
}

export function saveTtsSettings() {
    localStorage.setItem('focus_app_tts_enabled', JSON.stringify(AppState.ttsEnabled));
    localStorage.setItem('focus_app_tts_autoplay', JSON.stringify(AppState.ttsAutoplay));
    localStorage.setItem('focus_app_tts_speed', AppState.ttsSpeed.toString());
}

export function saveTimerSettings() {
    localStorage.setItem('focus_app_timer_stopwatch', JSON.stringify(AppState.timerStopwatchEnabled));
    localStorage.setItem('focus_app_timer_countdown', JSON.stringify(AppState.timerCountdownEnabled));
    localStorage.setItem('focus_app_timer_limit', AppState.timerCountdownLimit.toString());
    localStorage.setItem('focus_app_timer_auto_check', JSON.stringify(AppState.timerAutoCheckEnabled));
}

export function saveSources() {
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveFolders() {
    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    localStorage.setItem('focus_app_current_source', key || '');
}

export function saveRecentTests() {
    localStorage.setItem('focus_app_recent_tests', JSON.stringify(AppState.recentTests));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

let _saveActiveTestTimer = null;
export function saveActiveTest() {
    clearTimeout(_saveActiveTestTimer);
    _saveActiveTestTimer = setTimeout(() => {
        const activeData = {
            currentTest: AppState.currentTest,
            currentIndex: AppState.currentIndex,
            userAnswers: AppState.userAnswers,
            isAnswerChecked: AppState.isAnswerChecked,
            shuffledOptionsMap: AppState.shuffledOptionsMap,
            testTracking: AppState.testTracking,
        };
        localStorage.setItem('focus_app_active_test', JSON.stringify(activeData));
    }, 300);
}

export function clearActiveTest() {
    localStorage.removeItem('focus_app_active_test');
}
