const fs = require('fs');
let code = fs.readFileSync('src/core/i18n.js', 'utf8');

const keysTR = `
        home_screen_settings_title: "Pano Bileşenleri",
        toggle_focus_slide: "Odak Serisi",
        toggle_nugget_slide: "Hızlı İpuçları (Insights)",
        toggle_motivation_slide: "Günlük Motivasyon",
        nugget_empty: "Aktif kaynaklarınızdan derlenen ipuçları burada gösterilir. Eklemek için + butonuna tıklayın.",
        nugget_empty_warn: "İpucu notu boş olamaz!",
        nugget_edit_title: "Yeni İpucu Ekle",
        nugget_edit_title_edit: "İpucunu Düzenle",`;

const keysDE = `
        home_screen_settings_title: "Dashboard-Widgets",
        toggle_focus_slide: "Fokus-Serie",
        toggle_nugget_slide: "Kurze Einblicke (Insights)",
        toggle_motivation_slide: "Tägliche Motivation",
        nugget_empty: "Einblicke aus Ihren aktiven Quellen werden hier angezeigt. Tippen Sie auf +, um hinzuzufügen.",
        nugget_empty_warn: "Die Notiz darf nicht leer sein!",
        nugget_edit_title: "Neuer Einblick",
        nugget_edit_title_edit: "Einblick bearbeiten",`;

const keysEN = `
        home_screen_settings_title: "Dashboard Widgets",
        toggle_focus_slide: "Focus Series",
        toggle_nugget_slide: "Quick Insights",
        toggle_motivation_slide: "Daily Motivation",
        nugget_empty: "Insights from your active sources will appear here. Tap + to add.",
        nugget_empty_warn: "Insight note cannot be empty!",
        nugget_edit_title: "New Insight",
        nugget_edit_title_edit: "Edit Insight",`;

code = code.replace(/(tr: \{[\s\S]*?)(heatmap_questions_in_progress: [^,]*,?)/, '$1$2' + keysTR);
code = code.replace(/(de: \{[\s\S]*?)(heatmap_questions_in_progress: [^,]*,?)/, '$1$2' + keysDE);
code = code.replace(/(en: \{[\s\S]*?)(heatmap_questions_in_progress: [^,]*,?)/, '$1$2' + keysEN);

fs.writeFileSync('src/core/i18n.js', code);
console.log('Successfully injected i18n keys!');
