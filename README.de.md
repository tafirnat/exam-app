# 🎓 Exam App - Minimalistische Lern- & Active-Recall-Plattform

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Deploy to GitHub Pages](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

Eine professionelle, modulare, datenschutzorientierte und hochleistungsfähige Prüfungs-Webanwendung, entwickelt für Active Recall, Spaced Repetition (abgestufte Wiederholung) und Markdown-basiertes Lernen.

---

## 🌐 Sprachen / Languages / Diller

> ℹ️ **Hinweis**: Die **englische Version** ([`README.md`](./README.md)) ist stets die **primäre Originalquelle**.
>
> 🌐 **In anderen Sprachen lesen:**
> - 🇬🇧 **[English README](./README.md)** *(Originalquelle)*
> - 🇹🇷 **[Türkçe README](./README.tr.md)**

---

## 🌐 Live-Demo

Erleben Sie die Anwendung live: **[https://exam.rifatarslan.dev/](https://exam.rifatarslan.dev/)**

---

## 📌 Was ist die Exam App & Warum wurde sie entwickelt?

### Das Problem
Herkömmliche Prüfungsvorbereitungs- und Karteikarten-Apps sperren Ihre Lerndaten oft hinter proprietären Servern ein, verlangen monatliche Abonnements, bieten keine native Markdown-Unterstützung (oder beschädigen die Formatierung) und erzwingen eine ständige Internetverbindung. Lernende, die ihr Wissen in Tools wie [Obsidian](https://obsidian.md/) verwalten, haben oft Schwierigkeiten, ihre persönlichen Notizen und Fragensammlungen ohne Kompromisse beim Datenschutz in ein interaktives, ablenkungsfreies Lerntool zu verwandeln.

### Der Zweck
Die **Exam App** wurde entwickelt, um diese Probleme zu lösen. Sie ist eine vollkommen kostenlose, quelloffene, serverlose und primär offline-fähige (offline-first) Webanwendung, die es Benutzern ermöglicht, individuelle Prüfungen und Karteikarten mithilfe von Standard-JSON-Datensätzen im reichhaltigen **Obsidian Markdown**-Format zu erstellen, zu üben und zu verfolgen.

### Kernphilosophie
- 🔒 **100 % Datenschutz & Null Backend-Kosten ($0)**: Keine zentralen Server, keine Registrierung von Benutzerkonten erforderlich. Ihr Lernfortschritt und Ihre Datensätze bleiben auf Ihrem lokalen Gerät oder werden sicher mit Ihrem privaten GitHub Gist synchronisiert.
- 🧠 **Wissenschaftliche Lern-Engine**: Nutzt den **FSRS v4.5 (Free Spaced Repetition Scheduler)** Algorithmus, um die Wiederholungsintervalle basierend auf Gedächtnisstabilität und Abrufbarkeit zu optimieren.
- 📝 **Obsidian-nativ**: Fügen Sie Notizen direkt aus Ihrem Obsidian-Vault in Fragenkarten ein—Überschriften, Hervorhebungen (`> [!tip]`), Codeblöcke, Tabellen, Aufgabenlisten und Farbmarkierungen werden nativ gerendert.
- 📱 **Offline-First & Mobile-Ready**: Vollständig ohne Internetverbindung funktionsfähig. Kann als PWA (Progressive Web App) auf Smartphones und Desktops installiert werden.

---

## 🧩 Unterstützte Fragetypen & Lernmodi

Die Exam App unterstützt **7 kanonische Fragetypen**, die in 4 Strukturfamilien unterteilt sind, um sich allen Lernmaterialien anzupassen:

### 1. 🔘 Einzelauswahl (`single_choice`)
Standard-Multiple-Choice-Format mit genau einer richtigen Option. Ideal für gezielte Konzeptprüfungen.

### 2. ☑️ Mehrfachauswahl (`multiple_choice`)
Fragen, die zwei oder mehr richtige Auswahlen erfordern. Stellt das tiefe Verständnis komplexer Themen sicher.

### 3. ☯️ Richtig / Falsch (`true_false`)
Binäre Aussageprüfung mit vordefinierten Richtig/Falsch-Optionen. Hervorragend für schnelle Abruf-Checks.

### 4. ✍️ Kurzantwort (`short_answer` / `text_input`)
Freitext-Eingabe, bei der die Lernenden die exakte Antwort eintippen. Unterstützt mehrere akzeptierte Antwortvarianten und optionale Groß-/Kleinschreibung.

### 5. 📝 Lückentext (`fill_in_the_blank`)
Sätze mit fehlenden Schlüsselwörtern, die über doppelte geschweifte Klammern (`{{Lücke}}` oder `{{Kanonisch|Alternativ}}`) eingebettet sind. Lernende füllen die Lücken direkt im Haupttext aus.

### 6. 🎴 Karteikarte / Flashcard (`flashcard`)
Klassische Vorder-/Rückseiten-Karteikarten für Active Recall. Lernende drehen die Karte um, um die Antwort zu sehen, und bewerten ihr Behalten selbst.

### 7. 📖 Lese- / Lernmaterial (`reading`)
Reichhaltige Markdown-Textblöcke und Zusammenfassungskarten zur Überprüfung von Kernkonzepten vor oder während Prüfungen ohne automatischen Bewertungsdruck. *(Ehemaliger Name: `topic_review`)*.

---

## 🔥 Hauptmerkmale & Funktionen

- 🧠 **FSRS v4.5 Spaced Repetition**: Priorisiert wissenschaftlich "überfällige" Fragen ($R < 0.9$). Berechnet Wiederholungsintervalle adaptiv basierend auf dem Feedback der Lernenden (*Schwer* vs. *Einfach*).
- 📁 **Ordner- & Archivverwaltung**: Organisieren Sie Fragenquellen in benutzerdefinierten Ordnerhierarchien. Archivieren Sie einzelne Quellen oder ganze Ordner aus aktiven Lernsets, ohne den Testverlauf zu verlieren. Archivierte Elemente werden separat synchronisiert (`exam_app_archive.json`), um die tägliche Synchronisation leicht zu halten.
- 🔊 **Erweiterte Text-to-Speech (TTS)**: Liest Fragen und Lesekarten mithilfe nativer Sprachsynthese laut vor. Unterstützt einstellbare Wiedergabegeschwindigkeit (x0,7 bis x1,3), automatische Wiedergabe bei Navigation und schwebende Wiedergabesteuerungen.
- 🌐 **Mehrsprachige Benutzeroberfläche & KI-Übersetzung**: Vollständige native Benutzeroberfläche auf **Englisch**, **Türkisch** und **Deutsch**. Enthält eine integrierte Google-Übersetzungsunterstützung zur Übersetzung von Inhalten in über 10 Sprachen.
- 🤖 **Benutzerdefinierter KI-Anbieter-Hub**: Ein-Klick-Integration zum Senden von Fragenkontexten oder eigenen Prompt-Vorlagen an KI-Dienste (ChatGPT, Claude, Gemini, DeepSeek, Kimi etc.) in Ihrer aktiven UI-Sprache.
- 📤 **Flexible Datenteilung**: Kopieren Sie rohe JSON-Datensätze in die Zwischenablage, teilen Sie diese nativ über Web Share / Dateiexport, mit kontextbezogener Längenführung für große Dateien.
- 🎨 **Visuelle Exzellenz**: Eleganter Dunkelmodus, Glassmorphism-UI-Komponenten, sanfte Mikro-Animationen und kontrastgarantierte Ordner-Farbpaletten.

---

## ⚙️ Wie ist es aufgebaut? Technische Architektur

Nachdem Sie wissen, **was** die Exam App tut und **warum** sie existiert, erfahren Sie hier, **wie** sie unter der Haube entwickelt wurde:

### 🛠️ Tech-Stack & Philosophie
- **Vanilla Modern JS & HTML5**: Die Kernlogik basiert auf modularen ES-Modulen für ultraschnellen Start und Ausführung.
- **Benutzerdefiniertes CSS ohne Tailwind**: Maßgeschneidertes Design-System mit CSS-Variablen für feine Glassmorphism-Visuelles ohne Framework-Overhead.
- **Vite & Single-File-Bundler**: Nutzt `vite-plugin-singlefile`, um eine 100 % eigenständige, einzelne `index.html`-Ausgabe zu erzeugen, die sämtliches JavaScript, CSS und Assets enthält.
- **Client-seitige Speicherung & Synchronisation**: Nutzt den `localStorage` des Browsers für den Offline-Status und die GitHub Gist REST API für die geräteübergreifende Synchronisation.

---

## ☁️ Geräteübergreifende Synchronisation (GitHub Gist)

Synchronisieren Sie alle Ihre Fragensammlungen, Testfortschritte, Statistiken, Sterne, Notizen und Einstellungen geräteübergreifend ohne Server von Drittanbietern:

1. **GitHub-Token erstellen:**
   - Rufen Sie die [GitHub-Token-Einstellungen](https://github.com/settings/tokens?type=beta) auf.
   - Erstellen Sie ein Fine-Grained-Token mit den Berechtigungen **Gists: Read and Write**.
2. **In der App verbinden:**
   - Öffnen Sie die Exam App, klicken Sie auf das **GitHub ↗**-Symbol im Header, fügen Sie Ihr Token ein und klicken Sie auf **Verbinden & Synchronisieren**.
3. **Automatische Hintergrund-Synchronisation:**
   - Die App erstellt automatisch ein geheimes Gist (`exam_app_backup.json`) und synchronisiert den Fortschritt im Hintergrund.
   - Archivierte Elemente werden in eine sekundäre Datei (`exam_app_archive.json`) innerhalb desselben Gists ausgelagert.

### 🔗 Zugehöriges Obsidian-Plugin
Wenn Sie Fragen in Obsidian entwerfen, nutzen Sie das Begleit-Plugin **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)**, um Ihren Obsidian-Vault direkt über Gist mit der Exam App zu synchronisieren.

---

## 📊 Datenstruktur & JSON-Schema

Die Exam App parst Prüfungen mithilfe eines sauberen, menschenlesbaren JSON-Schemas, das aus `exam_metadata` und einem `questions`-Array besteht.

### Beispiel JSON
```json
{
  "exam_metadata": {
    "title": "Computernetzwerke 101",
    "id": "exam_net_101",
    "category": "Informatik",
    "description": "Grundlegende Netzwerkprotokolle und -konzepte."
  },
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": 2.0,
      "tags": ["web", "protokolle"],
      "content": { "text": "Welcher HTTP-Statuscode bedeutet **Nicht gefunden (Not Found)**?" },
      "options": [
        { "id": 1, "text": "200 OK" },
        { "id": 2, "text": "404 Not Found" },
        { "id": 3, "text": "500 Internal Server Error" }
      ],
      "answer": {
        "correct_ids": [2],
        "explanation": "Der Statuscode `404 Not Found` zeigt an, dass der Server die angeforderte Ressource nicht finden kann."
      }
    }
  ]
}
```

*Für vollständige Schema-Spezifikationen und Prompt-Anweisungen für externe KI-Modelle siehe **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und **[schema-guide.md](./public/examples/schema-guide.md)**.*

---

## 🤖 Erstellen von Fragensets mit KI

Sie können jedes Lehrbuch, jeden Artikel oder jede Vorlesungsnotiz mithilfe von KI in Exam App JSON-Datensätze umwandeln:
1. Öffnen Sie **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und kopieren Sie die Anweisungen.
2. Fügen Sie den Prompt zusammen mit Ihrem Lernmaterial in ChatGPT, Claude, Gemini oder DeepSeek ein.
3. Importieren Sie das generierte JSON direkt in die Exam App.

---

## 📥 Erste Schritte & Entwicklung

### Voraussetzungen
- Node.js (v18 oder höher)
- npm

### Installation
```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Lokale Entwicklung
```bash
npm run dev
```

### Einzeldatei-Produktions-Build
```bash
npm run build
```
Die kompilierte, eigenständige statische Datei wird unter `dist/index.html` generiert.

---

## 🚀 CI/CD & Automatische Bereitstellung

Dieses Repository nutzt **GitHub Actions** für automatischen Build und Bereitstellung:
- **Workflow**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Verhalten**: Jeder Commit auf den `main`-Branch löst einen Vite Single-File-Build aus und stellt die resultierende `dist/index.html` automatisch auf **GitHub Pages** (`gh-pages`-Branch) bereit.

---

## 🤖 Entwicklungstransparenz & Danksagung

Diese Anwendung wurde unter Einsatz fortschrittlicher KI-Codierungsassistenten (**Antigravity** & **Claude**) konzipiert und entwickelt. Obwohl alle Komponenten gründlich getestet und optimiert wurden, sind Feedback und Problemberichte stets willkommen!

---

## 📄 Lizenz

Verteilt unter der **MIT-Lizenz**. Siehe [LICENSE](LICENSE) für Details.

---
Mit ❤️ entwickelt von [tafirnat](https://github.com/tafirnat)
