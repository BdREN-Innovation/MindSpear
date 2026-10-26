# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: university lecturers** at BdREN member universities in Bangladesh (confirmed). They create quizzes, quests and surveys at a desk, then run them in a lecture hall from a laptop on a projector, with 30–300 students answering on their own phones.
- **Students / participants**: join a session with a 6-character code, QR code or link; no account and no app install. They use the product one-handed on a phone, often on a slow mobile connection, in a hall where the host's screen is the shared reference.
- **Admin**: a seeded super-admin role exists in the backend (user management); no admin UI was found in this frontend.

## Product Purpose

MindSpear is BdREN's platform for interactive teaching: a lecturer builds a quiz, quest or survey (or imports one from a question bank, a file, or AI generation from a PDF), runs it live or assigns it for self-paced completion, and reads per-session reports (participants, per-question accuracy, exports). Success for a lecturer is a session that runs without friction in front of a class and a report they can act on the same week. Success for a student is joining in seconds and answering without confusion.

## Positioning

What the code shows, not a marketing claim: one workspace holds four formats (live Quiz, self-paced Quest, Survey, Fun Games) with a shared question bank, file library and AI generation, under an institutional (BdREN) umbrella with Google and Microsoft sign-in. A distinct mechanism versus Kahoot/Quizizz/Mentimeter has **not** been confirmed by the user; do not invent one in copy.

## Operating Context

- Lecture hall: host laptop on a projector (often low-contrast, washed out by daylight), students on phones at arm's length. The presenter screen must read from the back row; the phone screen must work one-handed.
- Session flow: create → (optionally schedule) → host live with a join code / QR → students answer → leaderboard / results → report (Summary, Participants, Questions; CSV / Excel / PDF export).
- Quests are self-paced with a start and end date; sessions are tracked per attempt. Surveys use a Google-Form-style attempt page.
- Timezone shown in reports: Asia/Dhaka. Live transport: Laravel Reverb websockets. The participant app under `/play` is a PWA with its own shell and per-deck colour themes (`src/features/deck/theme.ts`).
- Backend is Laravel (`backend/`), API at `/api/v1`; frontend is Next.js 16 App Router with Tailwind 3, Ant Design 5, Redux Toolkit, framer-motion, lucide-react, ApexCharts (`frontend/`).

## Capabilities and Constraints

- Formats: Quiz (live, host-paced, timed, points), Quest (self-paced, dated), Survey, Fun Games (import a quiz, host as a party game with QR join).
- Question types present in code: single choice, multiple choice, true/false, short answer, fill in the blanks, long answer, ranking, sorting, scales, word cloud, poll, quick form, plus creator previews for pin-answer, puzzle, slider and audio questions.
- Shared assets: Question Bank (my / public / categories), My Files (documents, images, videos with a storage quota), Discover (public quizzes/surveys/quests), Templates.
- Plans page lists Free / Basic / Pro / Enterprise with prices; billing page shows a current plan, usage and payment methods. Prices are product facts owned by the business; do not restate them elsewhere.
- A "Quest/Quiz v2" deck editor and presenter exist behind a per-account feature flag (`/quizzes/[id]/edit`, `/quests/[id]/present`); the flag was off for the test account.
- Auth: email/password, Google, Microsoft; forgot/reset/verify flows.
- Constraint: redesign keeps every route, data flow, store and API call; only presentation changes. Pages must still work in dark mode classes where they exist, but dark mode is not a confirmed requirement.
- Undecided: whether the legacy quiz editor (`/quiz-edit`) or the v2 deck editor is the long-term builder. Both are in scope for restyling; neither is removed.

## Brand Commitments

- Name: **MindSpear**, by BdREN. The logo (brain/spear mark with "MindSpear" wordmark, `public/images/logo/logo.svg`, `frontend/src/assets/logos/`) **stays as is** (confirmed).
- The logo's colours (orange #F79945, orchid/plum #BC5EB3, pink #ED3A76, with a cobalt-to-plum gradient in the brain) are the seeds the palette is reworked around; the exact current working palette, type (Satoshi) and components are **not** binding (confirmed: "keep the logo; rework the palette around it").
- Voice in current copy is plain and instructional ("Enter the code on the host's screen"); no tone guide exists.
- **Standing preference (confirmed 26 Oct 2026):** keep the current layout and orientation of every page (header, sidebar, card structure); the redesign is a new palette, type and finish plus UX changes, not a replacement visual world. The user wants it "more playful and game-like" and "eye-soothing"; the current colours read "old and faded". Reference products this should sit alongside: live-quiz tools of the Kahoot / Quizizz / Mentimeter class, at their craft level. The host's live-event screens are the one area where the UX itself must change.

## Evidence on Hand

- Logo files, favicon, PWA icons (`frontend/public/images/logo`, `frontend/public/pwa`).
- Stock-style illustrations used today: `public/images/hero-image-1.jpg`, `HowItWorksCreate/Interact/Analyze.png`, quiz/quest/survey card illustrations. None are brand assets; they may be replaced.
- Real sample data in the dev database (quizzes such as "QA - Timer sync", sessions with 1–6 participants) for screenshots.
- **Absent**: testimonials, customer or institution logos, usage statistics, press. Do not fabricate any of these; use labelled placeholders.

## Product Principles

1. The host's screen is for the room; the student's screen is for one thumb. Design each for its distance.
2. Running a class is the moment that matters: anything on the path from "open quiz" to "first question on the projector" earns extra care.
3. Reports exist to change next week's lecture: lead with what to re-teach, not with totals.
4. Four formats, one vocabulary: the same words, states and controls across Quiz, Quest, Survey and Fun Games.
5. Institutional trust without dullness: this is university infrastructure, and also a game students want to play.

## Accessibility & Inclusion

- Presenter surfaces must hold contrast on a washed-out projector; answer options must be distinguishable by shape/letter as well as colour (inferred from the lecture-hall context; not a user-stated standard).
- Participant surfaces: 44px+ touch targets, one-handed reach, works with the on-screen keyboard open (the existing `/play` shell already handles keyboard insets and safe areas; preserve that).
