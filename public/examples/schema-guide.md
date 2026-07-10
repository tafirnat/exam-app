# AI Exam Generation Guide (JSON Schema)

This guide provides the necessary technical details for an AI to generate valid JSON files compatible with the Exam App.

## Root Structure
The JSON must be a single object containing two main keys:
- `exam_metadata`: (Object) Information about the test source.
- `questions`: (Array) List of question objects.

---

## 1. Exam Metadata (`exam_metadata`)
| Key | Type | Description |
| :--- | :--- | :--- |
| `title` | String | The name of the exam shown in the UI. |
| `id` | String | A unique identifier for the source (e.g., `ref_template_001`). |
| `description` | String | (Optional) Short summary of the exam content. |
| `category` | String | (Optional) Folder-like grouping for management. |

---

## 2. Global Strategy Keys

### `difficulty` (Range: 1 to 5)
This is a **critical** key for the application's learning algorithm.
- **Value**: Floating point or Integer (1.0 to 5.0).
- **Meaning**:
  - `1.0 - 1.9`: **Very Easy / Basic**. Fundamental concepts, trivial recall.
  - `2.0 - 2.9`: **Easy / Normal**. Standard knowledge, single-step logic.
  - `3.0 - 3.9`: **Medium / Intermediate**. Requires application of concepts.
  - `4.0 - 4.9`: **Hard / Advanced**. Complex logic, corner cases.
  - `5.0`: **Expert**. Mastery level, highly technical or nuanced.
- **Usage**: The app uses this as the *initial difficulty level* for the FSRS (Free Spaced Repetition Scheduler) algorithm. Higher values mean the question is scheduled more frequently until learned.

### `tags` (Array of Strings)
- **Usage**: Descriptive keywords (e.g., `["math", "algebra", "hard"]`).
- **Current Status**: Stored in data, available for future filtering/search logic.

### `explanation` (String)
- **Location**: Must be placed inside the `answer` object.
- **Usage**: Provides context or reasoning for the correct answer. Fully supports rendering HTML tags (e.g. `<b>`, `<i>`, `<code>`, `<a href="..." target="_blank">` hyperlinks, etc.) in the UI.

---

## 3. Question Types

### Single Choice (`single_choice`)
Standard radio-button selection.
- `type`: "single_choice"
- `options`: Array of objects with `id` and `text`.
- `answer.correct_ids`: Array containing exactly one ID.

### Multiple Choice (`multiple_choice`)
Checkbox selection (multi-select).
- `type`: "multiple_choice"
- `answer.correct_ids`: Array containing one or more IDs.

### True / False (`true_false`)
- `type`: "true_false"
- `options`: Usually `id: 1` for True, `id: 2` for False.

### Text Input (`text_input`)
Open-ended text entry.
- `type`: "text_input"
- `answer.accepted_texts`: Array of strings considered correct.
- `answer.caseSensitive`: (Boolean) If `true`, requires exact match.

---

## 4. Media & Formatting
- **Images**: Use `content.media` array.
  - `type`: "image"
  - `url`: Full URL to the image.
  - `position`: "above" (default) or "below" the question text.
- **Rich Text**: The `text` fields support basic HTML (e.g., `<b>`, `<i>`, `<code>`, `<pre>`).

## Example Template
```json
{
  "exam_metadata": {
    "title": "Topic Name",
    "id": "unique_id_001"
  },
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": 2.5,
      "tags": ["topic-a"],
      "content": { "text": "Question text here?" },
      "options": [
        { "id": 1, "text": "Option A" },
        { "id": 2, "text": "Option B" }
      ],
      "answer": {
        "correct_ids": [1],
        "explanation": "Why Option A is correct."
      }
    }
  ]
}
```
