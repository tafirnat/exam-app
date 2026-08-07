# AI Exam Generation Guide (JSON Schema)

This guide provides the necessary technical details for an AI to generate valid JSON files compatible with the Exam App.
For a complete, copy-pasteable system prompt directive tailored for AI models (ChatGPT, Claude, Gemini, DeepSeek), see **[AI_AGENT_PROMPT.md](../../AI_AGENT_PROMPT.md)**.

## Root Structure
The JSON must be a single object containing two main keys:
- `exam_metadata`: (Object) Information about the test source.
- `questions`: (Array) List of question objects.

---

## 1. Exam Metadata (`exam_metadata`)
| Key | Type | Description |
| :--- | :--- | :--- |
| `title` | String | The name of the exam shown in the UI. |
| `id` | String | A unique hybrid identifier for conflict-free sync in format `exam_[slug]_[timestamp/hash]` (e.g., `exam_topic_name_1785739334`). |
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
- **Usage**: Provides context or reasoning for the correct answer. Fully supports rendering Obsidian Markdown (e.g. **bold**, *italic*, `code`, [links](url), callouts, tables, etc.) in the UI.

---

## 3. Question Types

Eight types, in four families. The type decides which fields the question must
carry — the app refuses to save, and reports on import, anything that
contradicts its own type.

### Choice — `single_choice`, `multiple_choice`, `true_false`
- `options`: array of objects with a numeric `id` and `text`. At least two.
- `answer.correct_ids`: array of the ids that are correct.
  - `single_choice` — exactly one.
  - `multiple_choice` — at least two. One correct answer means you wanted
    `single_choice`.
  - `true_false` — exactly two options (conventionally `id: 1` true, `id: 2`
    false) and exactly one correct. A third option is rejected.

### Short answer — `short_answer`
The reader types the answer.
- `answer.accepted_texts`: array of strings that count as correct.
- `answer.caseSensitive`: (Boolean, optional) exact case required when `true`.
  Otherwise case and surrounding whitespace are ignored.

> `text`, `text_input` and `open_ended` were earlier names for this type. Files
> using them still import — they are rewritten to `short_answer` on the way in —
> but write new files with the current name.

### Fill in the blank — `fill_in_the_blank`
The answers live inside the sentence, in double braces. There is no
`accepted_texts` list.

```json
{
  "id": "q_ports",
  "type": "fill_in_the_blank",
  "content": { "text": "HTTP uses port {{80}} and DNS uses port {{53|Port 53}}." }
}
```

- Each `{{...}}` becomes one numbered blank, in reading order.
- A pipe lists alternatives. The first is the canonical answer shown in
  feedback; the rest are only accepted on input.
- Every blank must be answered correctly for the question to count.

### Flashcard — `flashcard`
- `content.text`: the front.
- `answer.back`: the back.
- Nothing is graded. The reader self-rates, and that rating drives scheduling.

### Reading — `reading`
Prose cards with no answer and no options. `content.text` is rendered as Obsidian Markdown,
so headings (`#`), lists (`-`), `code`, ```pre```, tables, callouts, and wikilinks work. Use `explanation` for
a note shown alongside. (The legacy spelling `topic_review` is converted to `reading` on import).

---

## 4. Media & Formatting
- **Images**: Use `content.media` array.
  - `type`: "image"
  - `url`: Full URL to the image.
  - `position`: "above" (default) or "below" the question text.
- **Rich Text**: The `text` fields support Obsidian-compatible Markdown (e.g., **bold**, *italic*, `code`, ==highlight==, tables, callouts).

## Example Template
```json
{
  "exam_metadata": {
    "title": "Topic Name",
    "id": "exam_topic_name_1785739334"
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
