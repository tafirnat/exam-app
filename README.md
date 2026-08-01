# 🎓 Exam App - Minimalist Learning & Active Recall Platform

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Deploy to GitHub Pages](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

A professional, modular, privacy-first, and high-performance examination web application designed for active recall, spaced repetition, and markdown-based study.

---

## 🌐 Languages / Diller / Sprachen

> ℹ️ **Note**: The **English** version (`README.md`) is the **primary original source**.
>
> 🌐 **Read in other languages:**
> - 🇹🇷 **[Türkçe README](./README.tr.md)**
> - 🇩🇪 **[Deutsch README](./README.de.md)**

---

## 🌐 Live Demo

Experience the application live: **[https://exam.rifatarslan.dev/](https://exam.rifatarslan.dev/)**

---

## 📌 What is Exam App & Why Was It Built?

### The Problem
Traditional exam preparation tools and flashcard apps often lock your study data behind proprietary servers, require monthly subscriptions, lack native Markdown support (or mangle formatting), and force online connectivity. Students and self-learners who manage their knowledge in tools like [Obsidian](https://obsidian.md/) often struggle to turn their personal notes and question banks into an interactive, distraction-free study tool without compromising privacy.

### The Purpose
**Exam App** was built to solve these issues. It is a completely free, open-source, serverless, offline-first web application that empowers users to create, practice, and track custom exams and flashcards using standard JSON datasets formatted in rich **Obsidian Markdown**.

### Core Philosophy
- 🔒 **100% Data Privacy & Zero Backend ($0 Cost)**: No central servers, no user accounts to register. Your study progress and datasets remain on your local device or sync securely to your private GitHub Gist.
- 🧠 **Scientific Learning Engine**: Employs the **FSRS v4.5 (Free Spaced Repetition Scheduler)** algorithm to optimize review intervals based on memory stability and retrievability.
- 📝 **Obsidian Native Content**: Paste notes directly from your Obsidian vault into question cards—headings, callouts (`> [!tip]`), code blocks, pipe tables, task lists, and highlights render natively.
- 📱 **Offline-First & Mobile Ready**: Fully operational without internet. Can be installed as a PWA (Progressive Web App) on smartphones and desktops.

---

## 🧩 Supported Question Types & Study Modes

Exam App supports **7 canonical question types** categorized into 4 family structures to accommodate all study material:

### 1. 🔘 Single Choice (`single_choice`)
Standard multiple-choice format with exactly one correct option. Ideal for targeted concept testing.

### 2. ☑️ Multiple Choice (`multiple_choice`)
Questions requiring two or more correct selections. Ensures deep comprehension of complex topics.

### 3. ☯️ True / False (`true_false`)
Binary statement verification with predefined True/False choices. Great for rapid-fire recall checks.

### 4. ✍️ Short Answer (`short_answer` / `text_input`)
Free-form text input where learners type the exact answer. Supports multiple accepted answer variations and optional case-sensitivity.

### 5. 📝 Fill in the Blank (`fill_in_the_blank`)
Sentences with missing keywords embedded via double braces (`{{blank}}` or `{{canonical|alternative}}`). Learners fill in blanks directly within the body text.

### 6. 🎴 Flashcard (`flashcard`)
Classic front/back flashcards for active recall. Learners flip the card to reveal the answer and self-rate their retention.

### 7. 📖 Reading / Study Material (`reading`)
Rich markdown prose blocks and summary cards for reviewing key concepts before or during exams without auto-grading pressure. *(Legacy alias: `topic_review`)*.

---

## 🔥 Key Features & Capabilities

- 🧠 **FSRS v4.5 Spaced Repetition**: Scientifically prioritizes "Overdue" questions ($R < 0.9$). Adaptively calculates review intervals based on learner feedback (*Hard* vs *Easy*).
- ⚡ **One-Tap Daily Review**: Start the day's session straight from the streak card, without hunting through sources first. The run is assembled per question and independent of which sources are switched on — a question is scheduled by what FSRS knows about *it*, not by the file it came from. Choose between two layouts: **pure FSRS order** (most urgent question first, sources ignored) or **grouped by source and folder** (still starts from the most urgent question, but keeps its source and folder-mates together so related material is studied in context).
- 📁 **Folder & Archive Management**: Organize question sources into custom folder hierarchies. Archive individual sources or entire folders out of active study sets without losing test history. Archived items sync separately (`exam_app_archive.json`) to keep routine sync light.
- ❄️ **Archiving Freezes the FSRS Clock**: Time spent in the archive is not counted against a question's schedule. A source parked with three days left on a review comes back with those three days still intact, instead of returning with its entire backlog overdue at once — so restoring a large archive never buries the daily target.
- 🔊 **Advanced Text-to-Speech (TTS)**: Reads questions and reading cards aloud using native speech synthesis. Supports adjustable playback speed (x0.7 to x1.3), autoplay on navigation, and floating playback controls.
- 🌐 **Multilingual Interface & AI Translation**: Full native UI in **English**, **Turkish**, and **German**. Includes integrated Google Translate support for translating content into over 10 languages.
- 🤖 **Custom AI Provider Hub**: One-click integration to send question contexts or custom prompt templates to AI services (ChatGPT, Claude, Gemini, DeepSeek, Kimi, etc.) in your active UI language.
- 📤 **Flexible Data Sharing**: Copy raw JSON datasets to clipboard, share natively via Web Share / File export, with context-aware length guidance for large files.
- 🎨 **Visual Excellence**: Sleek dark mode, glassmorphism UI components, smooth micro-animations, and contrast-guaranteed folder color palettes.

---

## ⚙️ How Is It Built? Technical Architecture

Now that you know **what** Exam App does and **why** it exists, here is **how** it was crafted under the hood:

### 🛠️ Tech Stack & Philosophy
- **Vanilla Modern JS & HTML5**: Core logic is built with modular ES Modules for ultra-fast startup and execution.
- **Custom Tailwind-Free CSS**: Tailored design system with CSS custom properties (variables) for fine-tuned glassmorphic visuals without framework overhead.
- **Vite & Single-File Bundler**: Uses `vite-plugin-singlefile` to generate a 100% standalone, single `index.html` output containing all JavaScript, CSS, and assets.
- **Client-Side Storage & Sync**: Relies on browser `localStorage` for offline state and GitHub Gist REST API for cross-device synchronization.

---

## ☁️ Cross-Device Sync (GitHub Gist)

Sync all your question banks, test progress, statistics, stars, notes, and preferences across devices without third-party servers:

1. **Generate GitHub Token:**
   - Go to [GitHub Token Settings](https://github.com/settings/tokens?type=beta).
   - Create a Fine-grained token with **Gists: Read and Write** permissions.
2. **Connect in App:**
   - Open Exam App, click the **GitHub ↗** icon in the header, paste your token, and click **Connect & Sync**.
3. **Automated Background Sync:**
   - The app automatically creates a secret Gist (`exam_app_backup.json`) and syncs progress in the background.
   - Archived items are offloaded to a secondary file (`exam_app_archive.json`) inside the same Gist.

### 🔗 Companion Obsidian Plugin
If you draft questions in Obsidian, use the companion plugin **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)** to sync your Obsidian Vault directly with Exam App via Gist.

---

## 📊 Data Structure & JSON Schema

Exam App parses exams using a clean, human-readable JSON schema consisting of `exam_metadata` and a `questions` array.

### Example JSON
```json
{
  "exam_metadata": {
    "title": "Computer Networking 101",
    "id": "exam_net_101",
    "category": "Computer Science",
    "description": "Foundational networking protocols and concepts."
  },
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": 2.0,
      "tags": ["web", "protocols"],
      "content": { "text": "Which HTTP status code signifies **Not Found**?" },
      "options": [
        { "id": 1, "text": "200 OK" },
        { "id": 2, "text": "404 Not Found" },
        { "id": 3, "text": "500 Internal Server Error" }
      ],
      "answer": {
        "correct_ids": [2],
        "explanation": "The `404 Not Found` status code indicates the server cannot locate the requested resource."
      }
    }
  ]
}
```

*For complete schema specifications and prompt instructions for external AI models, see **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** and **[schema-guide.md](./public/examples/schema-guide.md)**.*

---

## 🤖 Generating Question Sets with AI

You can turn any textbook, article, or lecture note into Exam App JSON datasets using AI:
1. Open **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** and copy its instructions.
2. Paste the prompt along with your study material into ChatGPT, Claude, Gemini, or DeepSeek.
3. Import the generated JSON directly into Exam App.

---

## 📥 Getting Started & Development

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation
```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Local Development
```bash
npm run dev
```

### Build Single-File Production App
```bash
npm run build
```
The compiled, standalone static file will be generated at `dist/index.html`.

---

## 🚀 CI/CD & Automated Deployment

This repository uses **GitHub Actions** for automated building and deployment:
- **Workflow**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Behavior**: Every commit pushed to `main` triggers a Vite single-file build and automatically deploys the resulting `dist/index.html` to **GitHub Pages** (`gh-pages` branch).

---

## 🤖 Development Transparency & Credits

This application was designed and developed by leveraging advanced AI coding assistants (**Antigravity** & **Claude**). While rigorous testing and optimization have been performed across all components, feedback and issue reports are always welcome!

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

---
Developed with ❤️ by [tafirnat](https://github.com/tafirnat)
