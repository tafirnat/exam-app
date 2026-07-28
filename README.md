# 🎓 Exam App - Minimalist Learning Platform

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Deploy to GitHub Pages](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-blue.svg)
![Technologien](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

A professional, modular, and high-performance examination application designed for seamless learning. Built with modern web technologies and a focus on visual excellence.

## 🌐 Live Demo

Experience the application live: **[https://exam.rifatarslan.dev/](https://exam.rifatarslan.dev/)**

---

- **GitHub Gist Cross-Device Sync**:
  - **Zero Server Costs ($0)**: Seamlessly sync study resources (JSON question banks), question statistics, notes, stars, flags, test history, and preferences across devices using GitHub Gists.
  - **Privacy First**: Data is stored securely in a private Gist (`exam_app_backup.json`) directly on your GitHub account without third-party servers.
  - **Background Auto-Sync**: Debounced automatic sync saves your progress in the background as you solve questions.
  - **Offline-First & Auto-Sync**: Fully functional offline via `localStorage`. Automatically fetches and merges the latest cloud data when online.
  - **Smart Merge Engine**: Intelligently resolves conflicts and merges study statistics from multiple devices.
- **PWA Support**: Installable on mobile and desktop for a full-screen, app-like experience with offline support.
- **Modular Architecture**: Clean, separate logic for state management, UI rendering, and test engines.
- **FS-Algorithm (Spaced Repetition)**: 
  - Implementation of the **FSRS v4.5** algorithm for scientifically optimized study intervals.
  - Prioritizes questions based on **Retrievability (R)**, ensuring you review exactly when you are about to forget.
  - **Memory Stability (S):** Tracks how well you know each question.
- **Smart Adaptive Engine**: 
  - Intelligent question selection prioritizing "Overdue" items ($R < 0.9$).
  - **Symmetric Progression:** Starts from a 1.5 baseline, moving toward 0.1 (Easy) or 3.0 (Hard).
  - **Learned Threshold:** Autonomously marks questions as "Learned" (🎓) based on retention stability.
  - **Intuitive Feedback:** Seamless "Hard" / "Easy" mapping that harmonizes with the algorithmic interval calculation.
- **Interactive Explanations**: Native support for HTML-formatted explanation rendering (supporting bold text, line breaks, and hyperlinks) in the note area. These pre-populate automatically on question load (allowing viewing via the note icon) and display automatically upon checking the answer.
- **Dynamic Internationalization**: Native support for **Turkish**, **English**, and **German** with automatic detection.
- **Multilingual Translations**: Integrated Google Translate API supporting over 10 target languages for questions and options.
- **AI-Ready**: Built-in prompts to easily copy questions to your favorite AI (ChatGPT, Claude, etc.) for detailed explanations.
- **Premium UI/UX**: Modern dark mode, glassmorphism elements, and smooth micro-animations.
- **Single-File Distribution**: Optimized build process that generates a perfectly standalone `index.html` file for easy hosting Anywhere.
- **Custom Data Sources**: Load your exams from local JSON files or remote URLs.
- **Advanced Text-to-Speech (TTS)**:
  - **Manual Playback**: Tap the speaker icon to read questions aloud.
  - **Autoplay Mode**: Automatically reads each new question upon navigation.
  - **Speed Control**: Adjustable speed range from **x0.7 to x1.3** with a smooth, interactive slider.
  - **Premium UI**: Floating labels and a professional, minimalist control interface.
  - **Language Sync**: Automatically uses the UI language for speech synthesis.

## 🛠️ Tech Stack

- **Vite**: Ultra-fast build tool and dev server.
- **Tailwind-free CSS**: Custom, high-performance vanilla CSS for maximum control.
- **ES Modules**: Modern JavaScript for better maintainability.
- **vite-plugin-singlefile**: To bundle everything into one portable file.

## 📥 Getting Started

### Installation

```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Development

```bash
npm run dev
```

### Build (Stand-alone File)

```bash
npm run build
```
The result will be available in `dist/index.html`.

## 🚀 CI/CD & Automated Deployment

This repository includes continuous integration and deployment configured via **GitHub Actions**:
- **Workflow Path**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Automatic Deployment**: Every push to the `main` branch automatically triggers the build process via Vite and deploys the generated output (`dist/index.html`) to the `gh-pages` branch.
- **Single-File Bundle**: Uses `vite-plugin-singlefile` to ensure all assets (HTML, CSS, JS) are bundled into a portable static application served directly on GitHub Pages.


## 🔄 Setting Up Cross-Device Sync (GitHub Gist)

To sync your study progress, JSON question sources, notes, and stats across devices without any backend:

1. **Create a GitHub Token:**
   - Go to [GitHub Settings > Personal Access Tokens (Fine-grained)](https://github.com/settings/tokens?type=beta).
   - Click **Generate new token**.
   - Under **User permissions**, set **Gists** to **Read and write**. (No other permissions required).
2. **Connect in Exam App:**
   - Click the **GitHub ↗** button in the header.
   - Paste your token and click **Connect & Sync**.
3. **Enjoy Automatic Sync:**
   - Exam App creates a secret Gist (`exam_app_backup.json`) under your GitHub account.
   - Any progress, new JSON resources, or stats updated on one device will automatically sync across all your devices!

### 📡 Offline-First & Online Synchronization

- **Offline-First Storage**: All question banks, test progress, and FSRS metrics are saved locally in your browser (`localStorage`). The app remains fully functional without an active internet connection.
- **Automatic Online Sync**: When online, Exam App automatically fetches the latest data from your private GitHub Gist upon startup or reconnection.
- **Smart Data Merging**: Uses a bi-directional merging engine (`mergeSyncData`) that compares item usage timestamps, question attempt counters, and tombstone deletion markers (`deletedSourceIds`) to keep all your devices up to date without data loss.

## 📊 Data Structure (JSON)

The application reads exam data through a standard JSON structure. You can follow the schema below to create your own exams.

### Data Schema Structure

1.  **`exam_metadata` (Exam Info):** Holds general information about the exam (Title, category, date, etc.).
2.  **`questions` (Questions):** A list of all questions in the exam.
    *   `type`: `single_choice`, `multiple_choice`, `true_false`, `text_input`.
    *   `answer`: Correct option IDs (`correct_ids`) or accepted texts (`accepted_texts`).

### Example JSON

```json
{
  "exam_metadata": {
    "title": "Exam Title",
    "id": "module_101",
    "category": "Category",
    "total_questions": 4,
    "date":"2026-03-26",
    "source":"Question source info"
  },
  "questions": [
    {
      "id": 101,
      "type": "single_choice",
      "content": { "text": "Question text?" },
      "options": [
        { "id": 1, "text": "Option A" },
        { "id": 2, "text": "Option B" }
      ],
      "answer": {
        "correct_ids": [1],
        "explanation": "Explanation of the solution with support for HTML tags like <b>bold text</b> and <a href=\"https://example.com\" target=\"_blank\">hyperlinks</a>."
      }
    }
  ]
}
```
*Full template available in [public/examples/standard-exam.json](./public/examples/standard-exam.json).*

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Developed with ❤️ by [tafirnat](https://github.com/tafirnat)
