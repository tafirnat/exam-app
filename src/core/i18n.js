
import { AppState } from './state.js';

export const targetLanguages = [
    { code: 'ar', name: 'العربية' },
    { code: 'de', name: 'Deutsch' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Pусский' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'zh', name: '中文' }
];

export const translations = {
    tr: {
        theme_change: "Görünümü Değiştir",
        star: "Yıldızla",
        unstar: "Yıldızı Kaldır",
        flag: "Bayrakla",
        unflag: "Bayrağı Kaldır",
        note_label: "Notunuz:",
        note_placeholder: "Notunuzu buraya yazın...",
        translate_all: "Tümünü Çevir",
        copy_ai: "Yapay Zeka Komutunu Kopyala",
        exit: "Çıkış",
        total_questions: "Toplam Soru",
        avg_coeff: "Ort. Katsayı",
        progress: "Öğrenme İlerlemesi",
        solved_count: "Çözülen: {solved} / {total}",
        question_count_label: "Soru Sayısı",
        start_test: "Testi Başlat",
        home_test_title: "Eğitim Merkezi",
        show_stats: "İstatistikler",
        export: "Dışa Aktar",
        import: "İçe Aktar",
        saved_sources: "Kayıtlı Kaynaklar",
        add_source: "Yeni Kaynak Ekle",
        load_url: "URL ile Yükle",
        load: "Yükle",
        load_file: "Dosyadan Yükle (.json)",
        question_label: "Soru",
        coeff_label: "Katsayı:",
        prev: "Önceki",
        next: "Sonraki",
        check: "Kontrol Et",
        checked: "Kontrol Edildi",
        stats_title: "Soru İstatistikleri",
        filter_all: "Tümü",
        filter_starred: "Yıldızlı",
        filter_flagged: "Bayraklı",
        filter_noted: "Notlu",
        back_to_stats: "İstatistiklere Dön",
        correct: "Doğru",
        wrong: "Yanlış",
        success_percent: "Başarı: %{percent}",
        total: "Toplam",
        lang_tr: "Türkçe",
        lang_en: "English",
        lang_de: "Deutsch",
        lang_select: "Dil Seçin",
        confirm_remove_source: "Kaynağı silmek istediğinize emin misiniz?",
        no_questions_available: "Kullanılabilir soru bulunamadı",
        test_completed: "Test tamamlandı!",
        confirm_exit: "Testten çıkmak istediğinize emin misiniz?",
        copy_ai_success: "Yapay Zeka komutu kopyalandı",
        q_count_10: "10 Soru (Akıllı)",
        q_count_15: "15 Soru (Akıllı)",
        q_count_20: "20 Soru (Akıllı)",
        q_count_40: "40 Soru (Sınav)",
        target_lang_label: "Çeviri Hedef Dili",
        correct_answer_was: "Doğru cevap:",
        filter_recent: "Son Cevaplananlar",
        filter_incorrect: "Yanlış Yapılanlar",
        test_source: "Kaynak",
        start_time: "Başlangıç",
        end_time: "Bitiş",
        no_recent_tests: "Henüz çözülmüş bir test bulunmuyor.",
        confirm_delete_history: "Bu testi bu listeden kaldırmak istediğinize emin misiniz?",
        finish_test: "Testi Bitir",
        unanswered_questions: "Boş Bırakılan Sorular",
        test_results: "Test Sonuçları",
        success_rate: "Başarı Oranı",
        avg_coeff_short: "Ort. Katsayı",
        completed_at: "Tamamlanma",
        correct_count: "Doğru Sayısı",
        wrong_count: "Yanlış Sayısı",
        ai_prompt_template: "Soru: {question}\nSeçenekler: {options}\n\nLütfen bu soruyu ve doğru çözümü ayrıntılı olarak açıklayın."
    },
    en: {
        theme_change: "Change Theme",
        star: "Star",
        unstar: "Unstar",
        flag: "Flag",
        unflag: "Unflag",
        note_label: "Your Note:",
        note_placeholder: "Enter your note here...",
        translate_all: "Translate All",
        copy_ai: "Copy AI Prompt",
        exit: "Exit",
        total_questions: "Total Questions",
        avg_coeff: "Avg. Coefficient",
        progress: "Learning Progress",
        solved_count: "Solved: {solved} / {total}",
        question_count_label: "Number of Questions",
        start_test: "Start Test",
        home_test_title: "Training Center",
        show_stats: "Statistics",
        export: "Export",
        import: "Import",
        saved_sources: "Saved Sources",
        add_source: "Add New Source",
        load_url: "Load from URL",
        load: "Load",
        load_file: "Load from File (.json)",
        question_label: "Question",
        coeff_label: "Coefficient:",
        prev: "Previous",
        next: "Next",
        check: "Check",
        checked: "Checked",
        stats_title: "Question Statistics",
        filter_all: "All",
        filter_starred: "Starred",
        filter_flagged: "Flagged",
        filter_noted: "With Note",
        back_to_stats: "Back to Statistics",
        correct: "Correct",
        wrong: "Wrong",
        success_percent: "Success: {percent}%",
        total: "Total",
        lang_tr: "Türkçe",
        lang_en: "English",
        lang_de: "Deutsch",
        lang_select: "Select Language",
        confirm_remove_source: "Are you sure you want to remove this source?",
        no_questions_available: "No questions available",
        test_completed: "Test completed!",
        confirm_exit: "Are you sure you want to exit the test?",
        copy_ai_success: "AI prompt copied to clipboard",
        q_count_10: "10 Questions (Smart)",
        q_count_15: "15 Questions (Smart)",
        q_count_20: "20 Questions (Smart)",
        q_count_40: "40 Questions (Exam)",
        target_lang_label: "Translation Target Language",
        correct_answer_was: "Correct answer:",
        filter_recent: "Recently Answered",
        filter_incorrect: "Incorrectly Answered",
        test_source: "Source",
        start_time: "Start",
        end_time: "End",
        no_recent_tests: "No tests solved yet.",
        confirm_delete_history: "Are you sure you want to remove this test from this list?",
        finish_test: "Finish Test",
        unanswered_questions: "Unanswered Questions",
        test_results: "Test Results",
        success_rate: "Success Rate",
        avg_coeff_short: "Avg. Coeff.",
        completed_at: "Completed",
        correct_count: "Correct Count",
        wrong_count: "Wrong Count",
        ai_prompt_template: "Question: {question}\nOptions: {options}\n\nPlease explain this question and the correct solution in detail."
    },
    de: {
        theme_change: "Design ändern",
        star: "Markieren",
        unstar: "Markierung aufheben",
        flag: "Flaggen",
        unflag: "Flag entfernen",
        note_label: "Ihre Notiz:",
        note_placeholder: "Ihre Notiz hier eingeben...",
        translate_all: "Alles übersetzen",
        copy_ai: "KI Prompt kopieren",
        exit: "Beenden",
        total_questions: "Fragen gesamt",
        avg_coeff: "Ø Koeffizient",
        progress: "Lernfortschritt",
        solved_count: "Gelöst: {solved} / {total}",
        question_count_label: "Anzahl der Fragen",
        start_test: "Test starten",
        home_test_title: "Trainingszentrum",
        show_stats: "Statistiken",
        export: "Exportieren",
        import: "Importieren",
        saved_sources: "Gespeicherte Quellen",
        add_source: "Neue Quelle hinzufügen",
        load_url: "Über URL laden",
        load: "Laden",
        load_file: "Aus Datei laden (.json)",
        question_label: "Frage",
        coeff_label: "Koeffizient:",
        prev: "Vorherige",
        next: "Nächste",
        check: "Prüfen",
        checked: "Geprüft",
        stats_title: "Fragenstatistik",
        filter_all: "Alle",
        filter_starred: "Markiert",
        filter_flagged: "Geflaggt",
        filter_noted: "Mit Notiz",
        back_to_stats: "Zurück zur Statistik",
        correct: "Richtig",
        wrong: "Falsch",
        success_percent: "Erfolg: {percent}%",
        total: "Gesamt",
        lang_tr: "Türkçe",
        lang_en: "English",
        lang_de: "Deutsch",
        lang_select: "Sprache wählen",
        confirm_remove_source: "Sind Sie sicher, dass Sie buese Quelle entfernen möchten?",
        no_questions_available: "Keine Fragen verfügbar",
        test_completed: "Test abgeschlossen!",
        confirm_exit: "Test wirklich abbrechen?",
        copy_ai_success: "KI Prompt kopiert",
        q_count_10: "10 Fragen (Smart)",
        q_count_15: "15 Fragen (Smart)",
        q_count_20: "20 Fragen (Smart)",
        q_count_40: "40 Fragen (Prüfung)",
        target_lang_label: "Übersetzungs-Ziellsprache",
        correct_answer_was: "Richtige Antwort:",
        filter_recent: "Zuletzt beantwortet",
        filter_incorrect: "Falsch beantwortet",
        test_source: "Quelle",
        start_time: "Start",
        end_time: "Ende",
        no_recent_tests: "Keine kürzlichen Tests vorhanden",
        confirm_delete_history: "Diesen Test aus dieser Liste entfernen?",
        finish_test: "Test beenden",
        unanswered_questions: "Unbeantwortete Fragen",
        test_results: "Testergebnisse",
        success_rate: "Erfolgsquote",
        avg_coeff_short: "Ø Koeff.",
        completed_at: "Abgeschlossen am",
        correct_count: "Anzahl Richtig",
        wrong_count: "Anzahl Falsch",
        ai_prompt_template: "Frage: {question}\nOptionen: {options}\n\nBitte erklären Sie diese Frage und die richtige Lösung im Detail."
    }
};

export function t(key, params = {}) {
    const lang = AppState.language || 'en';
    let text = translations[lang]?.[key] || translations['en'][key] || key;

    Object.keys(params).forEach(p => {
        text = text.replace(`{${p}}`, params[p]);
    });

    return text;
}

export function detectLanguage() {
    const saved = localStorage.getItem('focus_app_lang');
    if (saved && ['tr', 'en', 'de'].includes(saved)) return saved;

    // Default to English as per user request
    return 'en';
}

export function detectTranslationTarget() {
    const saved = localStorage.getItem('focus_app_target_lang');
    if (saved) return saved;
    return 'de'; // Default to German as per user request
}

export function updateStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerText = t(key);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
}
