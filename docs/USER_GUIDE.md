# User Guide

> This file is generated from `src/features/help/guide-content.js`. Do not edit it by hand; run `npm run build:guide`.

Every part of the app: what it is for and how to use it. Tap the heading you need.

## Contents

1. [Getting started](#getting-started)
2. [Adding sources](#adding-sources)
3. [Managing, merging and exporting sources](#managing-merging-and-exporting-sources)
4. [Starting a test and quick groups](#starting-a-test-and-quick-groups)
5. [Question types](#question-types)
6. [During a test](#during-a-test)
7. [The results screen and retaking](#the-results-screen-and-retaking)
8. [Question details and editing](#question-details-and-editing)
9. [What the statistics show](#what-the-statistics-show)
10. [Charts and the progress panel](#charts-and-the-progress-panel)
11. [Streaks and freeze tokens](#streaks-and-freeze-tokens)
12. [How the review algorithm decides](#how-the-review-algorithm-decides)
13. [Syncing and backups](#syncing-and-backups)
14. [Working with an AI](#working-with-an-ai)
15. [The menu and settings](#the-menu-and-settings)
16. [e-Reader and Books](#e-reader-and-books)
17. [Common situations](#common-situations)
18. [Version and contact](#version-and-contact)

---

## Getting started

This is a spaced-repetition and exam app built around **your own** questions. Three things set it apart from most alternatives:

- **No account.** Nothing to register, nothing to log into. All your data lives in your browser's own storage.
- **Works offline.** The internet is only needed for syncing, translation and text-to-speech.
- **Your content.** There is no ready-made question library; you add the questions (most people have an AI generate them).

**The first five minutes**

1. Open **Sources** from the menu or the home screen and add a JSON file. If you have none, load the sample source.
2. Go back to the home screen and switch on the source you want to study.
3. Choose how many questions you want and start the test.
4. When the test ends you get a results screen, and from there you can see the ones you missed one more time straight away.

The rest takes care of itself: the app decides when you see each question again.

---

## Adding sources

A **source** is a set of questions about one subject: a course, a chapter, an exam topic. Keep a source narrow and coherent - statistics are computed per source, so "Anatomy" as one source is useful while "Everything" produces a meaningless average.

**Three ways to add one** (Sources screen):

- **From a file** - pick a `.json` file from your device.
- **From a URL** - paste the direct address of the JSON (a GitHub raw link, for instance).
- **By pasting** - paste the JSON text straight into the box. This is the quickest route for output you got from an AI.

**The expected format**

```json
{
  "examTitle": "Anatomy - Chapter 1",
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "text": "How many chambers does the heart have?",
      "options": [
        { "id": "a", "text": "2" },
        { "id": "b", "text": "4" }
      ],
      "correctOptionIds": ["b"],
      "explanation": "Two atria, two ventricles.",
      "difficulty": 2,
      "tags": ["heart"]
    }
  ]
}
```

`difficulty` runs 1-5 and only seeds the question's **initial** difficulty estimate; from then on your answers decide. `tags` are optional and are used by search and by starting a test from a tag.

**The import report.** When an import finishes, questions found to be incomplete (no answer, no options, empty text) are listed in a report. From there you fix them, flag them, or delete them - they are never taken in silently.

**Safety.** Question text is drawn as Markdown, and any raw HTML inside it is **never executed** - it appears as literal text. Opening a JSON you do not trust does not expose you to a script.

---

## Managing, merging and exporting sources

**On / off.** A source's switch decides whether it takes part in tests. You can have several on at once; a test then draws from all of them.

**Folders.** Sources can be put into folders and folders can be coloured. Anything without a folder collects in "Uncategorized", which always exists and cannot be deleted. A folder that stays empty is removed on its own after 10 minutes, or at the next start if you closed the app. A folder with sources in the archive does not count as empty.

**Folder hint.** A data set can name a folder in its `exam_metadata.folder` field. The set goes into the folder of that name when it is imported or first arrives by sync (from Obsidian, for example); case, accents and punctuation do not matter. If there is no such folder it is created, and a folder you renamed since is still found. Without a hint the set goes to "Uncategorized". It happens once per set: a set you move later stays where you put it. Importing a set you deleted again, from the same file, brings it back on every device.

**The source menu** (long-press a source, or tap its three dots):

- **Rename / edit details** - title and category.
- **Move to folder**.
- **Export** - downloads just that source as JSON. You can hand that file to another device or another person.
- **Archive** - takes the source out of the library but keeps its questions. An archived source takes no part in tests and its review clock **stops**: bring it back three months later and its questions are not all overdue at once.
- **Delete** - removes the source and its statistics. It cannot be undone; export first.

**Merging.** The merge option on the Sources screen gathers the questions of the sources you pick into a single new source, de-duplicating anything that appears in two of them. Merging cannot be undone either, so exporting first is a good habit.

**Does archiving free space?** Only when GitHub sync is connected: the archived source's questions are moved into the Gist and removed from the device. Without a connection the questions stay on the device, so archiving frees nothing - and in that case the app offers "Download and delete" instead.

**The storage warning.** A warning appears as browser storage fills up. It shows no percentage, because browsers do not publish the ceiling; it estimates how many more questions will fit instead.

---

## Starting a test and quick groups

From the home screen you pick your active sources, how many questions you want and the order, then start.

**How many questions.** Ready values like 10, 20, 40, or **All questions**. Which questions you get is the app's decision: the ones closest to being forgotten come first.

**Sequential mode.** If a source is marked sequential its questions come in the order they appear in the JSON, unshuffled. That mode also shows a **range picker**: in a 40-question book you can do the first 10 and move to 11-20 next time. When the test ends the range moves on by one block and the app tells you so.

**Quick test groups** (the lightning button on the home screen). Save the source combinations you use often: "Exam week" = Anatomy + Physiology + Biochemistry. Tapping a group switches those sources on and leaves you ready to start.

To edit a group, tap the pencil next to it. The window that opens lets you change **its name** and also pick or remove **which sources are in it**, directly. That is where you build your study set, on one screen.

**Testing from a tag.** Tap a tag on the statistics screen and you get the questions carrying it; you can start a test straight from there. The same is true of search results and filters: whatever list is on screen is what the test starts with.

---

## Question types

There are seven types, and the set is closed - no new ones are added.

| Type | What it does |
|---|---|
| `single_choice` | One correct option. |
| `multiple_choice` | Several correct options; you have to mark all of them. |
| `true_false` | True / false. |
| `short_answer` | You type a short text. Several acceptable answers can be defined. |
| `fill_in_the_blank` | Gap(s) in a sentence. Write `{{blank}}` or `{{correct|alternative}}` in the text; each gap is graded on its own. |
| `flashcard` | Front / back. You rate yourself. |
| `reading` | Not a question but a passage. Read section by section; progress counts, but there is no right or wrong. |

**Old names.** `text`, `text_input` and `open_ended` map to `short_answer`; `topic_review` maps to `reading`. Your older files keep working.

**Markdown everywhere.** Question text, options and explanations all support Markdown: bold, italic, headings, lists, code blocks, tables, `==highlight==`. To add a picture, use the media field in the question editor.

---

## During a test

**Answering.** Pick an option and check it. Once an answer is checked the correct answer appears, with the explanation if there is one. Wrong answers are not re-asked within the session - the questions are chosen up front.

**Hard / Easy.** These two buttons, which appear after checking, shorten or lengthen the question's review interval. Pressing **Hard** on something you struggled with brings it back sooner. They are optional; without them an ordinary result is recorded.

**The marks in the top bar:**

- **Star** - the ones you want to come back to.
- **Flag** - the ones where you think the question itself is wrong.
- **Note** - your own note on the question. Notes sync, and a progress reset does not delete them.

All three carry **un-marking** too: clear a star on one device and it clears on the other.

**Menu buttons:**

- **Translate** - translates the whole question into your chosen language (needs the internet).
- **AI** - two buttons. The copy button puts the question and the correct answer on the clipboard; the share button hands your chosen prompt out in full (the system share sheet on a phone, the clipboard on a desktop).
- **Read aloud** - speaks the question or the reading section.

**Timers.** Menu - Timer gives you two independent things: a per-question **countdown** (which warns you when time is up) and a **stopwatch**. Both are off by default.

**How a test ends.** When nothing is left unanswered the test finishes itself - but not instantly: it waits 1.5 seconds so you can press Hard or Easy, and touching anything in that beat cancels the wait. On the last question the button already says "Finish test". A test you deliberately leave half-done waits for you on the home screen as "Resume".

---

## The results screen and retaking

When a test ends you see correct / wrong / blank counts, the success rate and the elapsed time. Below them every question of the test is listed; tap any of them to read the answer and explanation again.

The **Retake** button asks the test's questions once more - most useful after a lot of misses, while the explanations are still fresh.

In a retake, getting right a question you got **wrong** the first time **does not count as a full success**. Knowing something you missed minutes ago is a *recovery*, not the same event as knowing it first time, and the app records it as "Hard". Without that, missing a question and then getting it right straight after would leave a **better** record than answering it correctly in the first place. Questions you got right or left blank the first time are rated normally.

---

## Question details and editing

Tapping a question in the statistics list opens the **preview** screen: the full question, its correct answer, the explanation, its tags, your note and its figures.

**The arrows.** The left/right arrows in the preview take you to the **next** question in the list - as filtered, searched and sorted. So "walk through the starred ones" is exactly that. The `12 / 30` between them says where you are.

**Editing.** The pencil opens the question editor. Text, options, correct answer, explanation, difficulty, tags and media all change from here.

- **Quick formatting bar**: bold, italic, heading, list, highlight, code.
- **Live preview**: shows how the Markdown will look as you type.
- **Focus mode**: tap a text field and everything else hides while the field grows. For writing long text on a phone. Tap outside or use the exit button to leave.
- **Unsaved changes**: if you try to leave without saving, the app asks - Save / Leave without saving / Cancel.
- **The arrows at the bottom** move to the next question without closing the editor.

When you save, the preview refreshes immediately; you do not have to go out to the list and back in.

---

## What the statistics show

The statistics screen is a list of your questions; each row is one question and where it stands.

**What is in a row:**

- **✓ / ✗ and a percentage** - how many times you got it right and wrong.
- **Difficulty** - the difficulty the app holds for that question (1-5). Your answers move it.
- **🧠 percentage** - *retrievability*: the chance you would know it if asked right now. Below 90% a question counts as overdue and is prioritised.
- **🔥 / ❄️ number** - how many right or wrong in a row.
- **🎓** - considered learned.
- Star, flag, note and **suspended** badges.

**The filters (the strip at the top):**

| Filter | What it lists |
|---|---|
| All | Every question in scope |
| Recently answered | Past test sessions |
| Answered incorrectly | Everything you have missed at least once |
| Starred / Flagged / With note | The questions you marked |
| **Stuck** | Questions that are stuck - see below |

**Stuck.** Missing a question over and over drives its review interval down to the minimum: it comes back every single day and takes one of that day's slots, while never becoming learned. Questions missed **8 times** that are still not going right collect in this filter.

Each row here has two buttons:

- **Edit** - usually the question is at fault: ambiguous wording, two defensible answers, or a mistake in the answer key. Look here first.
- **Suspend** - the question stops appearing in tests. **No statistic is deleted**, it stays in the list, and you can undo it whenever you like. Suspending is not a punishment; it means "not this one, not now".

**Scope.** The bar at the bottom says which sources you are looking at. With the **All sources** switch in the header off, the scope is your active sources; on, it is the whole library. You can also name a scope directly by typing `$SourceName` into the search box.

**Search.** Plain text searches the question, `#tag` searches tags, `$Source` narrows to a source.

**Sorting.** Original order, difficulty, success rate or retrievability.

---

## Charts and the progress panel

**The home screen cards** describe your library - every source that is not archived.

- **Difficulty spread** - how your questions divide into easy/medium/hard.
- **Trend** - questions per day over the last 7 days. Flip the card for a monthly face.
- **Heatmap** - a year of study days. A dark day is a day you worked a lot.
- **Exam readiness** - the average readiness across your sources.

**The progress panel** (the expand button on the card) describes **your test** instead - only the sources that are switched on. It holds three charts and all three read the same set:

- **Overview** - the right/wrong/blank split.
- **Difficulty bar** - the questions by difficulty.
- **Workload** - the chart actually worth reading. Left to right is time:

  `−6d … yesterday │ Overdue · Not started │ Today │ +1d … +6d`

  **Filled** = that moment is behind you (an answer you gave, or a review day that went past without you). **Hollow** = still ahead of you. Colour says what kind of debt: red is overdue, blue is never started, yellow is today, grey is plan.

  The grey columns on the right are **plan, not debt** - the ordinary reviews waiting for you over the coming days.

The **i** button beside each chart explains what that chart says.

The **Inspect** button opens the panel's sources as a question list on the statistics screen.

---

## Streaks and freeze tokens

There are two streaks and they run independently.

**General streak.** For your whole library. To win a day you must answer **at least 15 questions** that day. That number is fixed and cannot be changed: a floor that moves is not a floor. More than 15 is your business - the app neither rewards nor penalises the surplus.

**Focus streak.** A separate streak for **up to 3 sources** of your choosing. Pick them with the gear on the Focus card; the words "Sources" next to it point at exactly that. The focus streak only counts questions you answer in those sources **after** you picked them.

**Where the day ends.** The day turns on a fixed **Europe/Berlin** midnight, not on your device's clock. The reason is simple: otherwise two of your devices in different time zones file the same study session under two different days, and no merge rule can repair that.

**Freeze tokens (❄️).** Tokens spent so that a missed day does not break your streak.

- Earned by studying regularly; there are two tiers.
- A missed day is frozen automatically on the next launch, with nothing for you to do.
- **A frozen day earns no new token** - otherwise freezing and earning would feed each other in a loop.
- The general and focus streaks have their own tokens. One can borrow from the other when it runs out, but each spends its own first.
- If you have **no focus sources selected, no token is spent** on the focus streak. An unset target reads as "missed" every single day and would quietly burn every token you have.

The **Keep the streak** button turns the day's requirement straight into a test: a mix of overdue questions, a few new ones and some coming up.

---

## How the review algorithm decides

The app uses a spaced-repetition algorithm called **FSRS** (the modern member of the family Anki also uses). For every question it keeps two numbers:

- **Stability** - an estimate, in days, of how long you will remember it.
- **Difficulty** - how hard that question is for you.

Those two give **retrievability**: `R = 0.9 ^ (days elapsed / stability)`. When `R` falls below 90% the question is overdue - which means its due date is exactly **last review + stability** days.

**What moves them:**

- **A right answer** raises stability; the interval grows.
- **A wrong answer** lowers it; the question comes back soon.
- The **Hard** button shortens the interval, **Easy** lengthens it.
- `difficulty` in the JSON only supplies the **initial** estimate.

The **learned** mark (🎓) means five right in a row or a stability past 30 days. One wrong answer clears it.

You never have to tune any of this, and there is no setting for it. Your only inputs are the Hard/Easy buttons and - for questions that really are stuck - suspending.

---

## Syncing and backups

There are two separate things: **syncing** (between devices, continuous) and a **backup** (one file, manual).

### GitHub sync

Your data lives in a secret **Gist** in your own GitHub account. There is no server of ours; your data never passes through us.

**Setting it up:**

1. Create a **Personal Access Token** on GitHub. The only scope it needs is `gist`.
2. Enter the token under Menu - Backup.
3. On the first connection the app creates the Gist itself.

**How it works:**

- Changes are pushed up after every answer.
- They are pulled down when the app comes to the foreground (returning to the tab, unlocking the phone) - no more often than once every 30 seconds.
- **A pull is deferred while you are in a test**, or the questions would change under you.
- Half-finished tests sync too: start on the phone, carry on at the computer.
- When two devices disagree the app merges rather than overwrites. Study the same day on both and the two are **added together**.

**The sync badge in the menu** shows the state: fine, a network problem, or a token problem. If failures pile up the badge says so.

### Manual backup

Menu - Backup - **Export** downloads a single JSON file. It holds your sources, folders, all your statistics, your **daily study history**, your streak settings, your tokens and your quick test groups.

**Import** restores that file. It writes over what is there and reloads the page, so it asks for confirmation first.

Take a backup when you move to a new device, and before anything risky (deleting a source, merging, resetting). The backup file goes nowhere; it stays with you.

---

## Working with an AI

There is **no AI running inside** the app. Instead it prepares the text you will send to an AI outside it. You provide no key, you pay nothing, and nothing goes anywhere in the background - you decide what is sent.

**Generating questions.** This is how most people build their sources: give an AI your notes, ask for questions in the JSON format above, and paste the result into the Sources screen. Asking it to fill in `difficulty` is worth doing - it improves the algorithm's starting estimate.

**The prompt library.** Menu - AI lets you write and keep your own prompts. Three come ready: have the question audited, have the topic explained, have your own answer assessed.

The variables you can use in a prompt:

| Variable | Stands for |
|---|---|
| `{question}` | The question text |
| `{options}` | The options |
| `{correct}` | The correct answer |
| `{answer}` | The answer you gave |
| `{source}` | The source name |
| `{explanation}` | The explanation |

**A variable with nothing behind it drops its line.** On a question with no options, the line containing `{options}` is not written at all - there is no point sending an AI an empty "Options:" that tells it nothing.

**The provider list.** Save the addresses of the AIs you use with a `{PROMPT}` placeholder, and one tap opens them with the prompt already filled in. That list is per device and is not synced.

**This guide is a reference too.** If you want to ask an AI how to use the app, the whole guide sits in the repository as `docs/USER_GUIDE.md`; hand it over and ask away.

---

## The menu and settings

The menu (the button at the top right) opens section by section.

- **Backup** - export/import and GitHub sync.
- **AI** - the prompt library and the provider list.
- **Timer** - per-question countdown and stopwatch; both optional.
- **Translation** - turn translation on or off and choose the target language (10 available).
- **Text-to-speech** - voice, speed and automatic reading.
- **Home screen** - which cards are shown.
- **Notifications** - two independent channels: a general streak reminder (morning) and a focus streak reminder (evening). You can set quiet hours. Notifications are produced on your device; there is no server.
- **Language** - interface language: Turkish, English, German.
- **Theme** - light / dark.

**The in-page mark buttons** (star, flag, note, translate all, copy the AI prompt) appear in the menu on the test and preview screens.

**Delete sources** is at the bottom of the menu and cannot be undone. It has two levels: reset progress only (sources stay) and delete everything. Both keep your prompts and your quick test groups - those are not a record of something you studied but tools you wrote.

**Which settings sync?** Language, translation target, text-to-speech settings, timer settings and your prompt selection travel between devices. The **AI provider list** and the **theme** are per device.

---

## e-Reader and Books

The e-Reader allows you to read long-form study materials, PDFs, EPUB books, and documentation section by section in a clean, distraction-free environment.

**Adding books and the AI prompt.** To convert any material into e-Reader format, provide the `EREADER_AI_PROMPT.md` instructions to an external AI (ChatGPT, Claude, Gemini, etc.). The resulting standard JSON can be imported from clipboard or file. Books are stored directly in your browser's IndexedDB.

**Multi-part generation and merging.** Large books can be produced in parts without running into AI context limits (`part: { from: 1, to: 20, ... }`). Parts sharing the same `book_key` are detected automatically or can be combined into a single book via the **Merge parts** button in the library header. If any range is missing between parts, a gap warning appears in the contents list, and you can copy the prompt for the next part from the book actions menu.

**Image support and URL placeholders.** Markdown images with secure `https://` URLs are rendered inline. Images specified with `placeholder:id` or file links appear as interactive placeholder cards; tap a placeholder to assign an `https://` image URL directly. For data economy and privacy, raw image binaries are never stored or synced.

**Reading tools.** The reading screen provides chapter-by-chapter navigation, adjustable text size, table of contents in the side menu, fast in-book search, fullscreen zen mode, and print/PDF export. Additionally, each heading features read-aloud (TTS) and section translation controls.

**Synchronization.** When GitHub Gist sync is configured, your books and current reading positions sync automatically between your devices in the background.

**Resetting e-Reader.** Use "Reset e-Reader" in the e-Reader side menu to reset reading positions or delete all books. This operation never affects your exam/test progress, FSRS history, or regular study sources.

---

## Common situations

**"One question keeps coming back."** It is probably stuck. Look at Statistics - the **Stuck** filter; fix it or suspend it.

**"My streak broke although I studied."** The day turns at **Europe/Berlin** midnight; questions you answered after midnight in another time zone may have been filed under the next day. And a day needs 15 questions to be won.

**"The two devices show different numbers."** Bring the app to the foreground on both and wait a few seconds - pulling happens when the app comes forward. It is deferred while you are on the test screen.

**"The sync badge is red."** Your token may have expired or may not have the right scope (it needs `gist`). Tap the badge to read the state; a passing network error and a token problem are reported separately.

**"I am getting an out-of-space warning."** Export and delete sources you are not using, or archive them if GitHub is connected. Archiving only frees space on the device when GitHub is connected.

**"My questions are gone."** Clearing browser data clears the app's data with it. If GitHub sync is connected, reconnecting brings everything back; if not, import the backup file you have. That is what regular backups are for.

**"My answer was right but it was marked wrong."** For short answers and gap-fills you can widen the accepted answers in the question editor; several equivalent answers can be defined.

**"The app froze on my phone."** Reload the page. A half-finished test is not lost; it waits on the home screen as "Resume".

---

## Version and contact

**Version:** 1.1.0

**Contact:** tafirnat@gmail.com

Write if you find a bug, if something here was unclear, or if you have a suggestion. When reporting a bug it helps a great deal to say which screen you were on and what you were trying to do.

**Source code:** https://github.com/tafirnat/exam-app

**Who holds your data?** You do. The app has no server. Data lives in your browser's storage, and if you turn on syncing it lives in a secret Gist in your own GitHub account. Apart from translation and text-to-speech no request leaves the device, and you can switch both of those off.

---

<https://github.com/tafirnat/exam-app> · tafirnat@gmail.com
