# Focus App | Advanced Learning Platform

[![Live Demo](https://img.shields.io/badge/demo-live-green?style=for-the-badge&logo=github)](https://tafirnat.github.io/exam-app/)

A professional, modular, and high-performance examination application designed for seamless learning. Built with modern web technologies and a focus on visual excellence.

## 🌐 Live Demo

Experience the application live: **[https://tafirnat.github.io/exam-app/](https://tafirnat.github.io/exam-app/)**

---

## 🚀 Features

- **Modular Architecture**: Clean, separate logic for state management, UI rendering, and test engines.
- **Dynamic Internationalization**: Native support for **Turkish**, **English**, and **German** with automatic system language detection.
- **Smart Test Engine**: Question selection based on coefficients (weights) to prioritize areas that need improvement.
- **Multilingual Translations**: Integrated Google Translate API supporting over 10 target languages for questions and options.
- **AI-Ready**: Built-in prompts to easily copy questions to your favorite AI (ChatGPT, Claude, etc.) for detailed explanations.
- **Premium UI/UX**: Modern dark mode, glassmorphism elements, and smooth micro-animations.
- **Single-File Distribution**: Optimized build process that generates a perfectly standalone `index.html` file for easy hosting Anywhere.
- **Custom Data Sources**: Load your exams from local JSON files or remote URLs.

## 🛠️ Tech Stack

- **Vite**: Ultra-fast build tool and dev server.
- **Tailwind-free CSS**: Custom, high-performance vanilla CSS for maximum control.
- **ES Modules**: Modern JavaScript for better maintainability.
- **vite-plugin-singlefile**: To bundle everything into one portable file.

## 📥 Getting Started

### Installation

```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app/modular-exam-app
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
        "explanation": "Explanation of the solution."
      }
    }
  ]
}
```
*Full template available in [examples/standard-exam.json](./examples/standard-exam.json).*

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Developed with ❤️ by [tafirnat](https://github.com/tafirnat)
