# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: university lecturers** at BdREN member universities in Bangladesh (confirmed). They create quizzes and quests at a desk, then run them in a lecture hall from a laptop on a projector, with 30–300 students answering on their own phones.
- **Students / participants**: join a session with a 6-character code, QR code or link; no account and no app install. They use the product one-handed on a phone, often on a slow mobile connection, in a hall where the host's screen is the shared reference.
- **Admin**: a seeded super-admin role exists in the backend (user management); no admin UI was found in this frontend.

## Product Purpose

MindSpear is BdREN's platform for interactive teaching: a lecturer builds a quiz or quest as a slide deck (by hand, or with AI generation from a document), presents it live, and sees the results on the presenter screen; participants can review their answers once the session ends. Success for a lecturer is a session that runs without friction in front of a class and a report they can act on the same week. Success for a student is joining in seconds and answering without confusion.

## Positioning

What the code shows, not a marketing claim: one workspace holds three formats (Quiz, Quest, Fun Games) with a question bank, file library and AI generation, under an institutional (BdREN) umbrella with Google and Microsoft sign-in. A distinct mechanism versus Kahoot/Quizizz/Mentimeter has **not** been confirmed by the user; do not invent one in copy.

## Operating Context

- Lecture hall: host laptop on a projector (often low-contrast, washed out by daylight), students on phones at arm's length. The presenter screen must read from the back row; the phone screen must work one-handed.
- Session flow: create a deck → present live with a join code / QR → students answer on `/play` → live results (quiz: scores and a leaderboard) → end-of-session summary on the presenter; participants can review their answers afterwards. There is no host report or CSV / Excel / PDF export (the legacy v1 reports were removed on 29 Oct 2026).
- Quiz and Quest share one deck engine (editor, presenter, participant app): a quiz scores answers; a quest collects responses (polls, word clouds, Q&A) without scoring.
- Live transport: Laravel Reverb websockets. The participant app under `/play` is a PWA with its own shell and per-deck colour themes (`src/features/deck/theme.ts`).
- Backend is Laravel (`backend/`), API at `/api/v1`; frontend is Next.js 15 App Router with Tailwind 3, Ant Design 5, Redux Toolkit, framer-motion, lucide-react, ApexCharts (`frontend/`).

## Capabilities and Constraints

- Formats: Quiz (live, host-paced, timed, scored with a leaderboard), Quest (live polls, word clouds and audience Q&A with live results, no scoring), Fun Games (import questions from a quiz or a document, host as a party game with QR join).
- Slide types present in code. Quiz: pick answer (single / multiple), true/false, short answer, fill in the blanks, correct order, match pairs, categorise, drag and drop, spinner wheel, leaderboard. Quest: poll (single / multiple), open-ended, word cloud, ranking, rating, scales, points allocation, 2×2 matrix, pin on image, audience Q&A. Both: content slides (heading, paragraph, bullets, numbered list, big text, quote, image, video, QR code).
- Shared assets: Question Bank (my / public / categories; not yet usable from quizzes and quests), My Files (documents, images, videos with a storage quota), Discover (public quizzes and quests).
- Plans page lists Free / Basic / Pro / Enterprise with prices; billing page shows a current plan, usage and payment methods. Prices are product facts owned by the business; do not restate them elsewhere.
- Quizzes and quests are built in the deck editor (`/quizzes/[id]/edit`, `/quests/[id]/edit`) and run from the presenter (`/quizzes/[id]/present`, `/quests/[id]/present`); participants play under `/play` (`/join` redirects there).
- Auth: email/password, Google, Microsoft; forgot/reset/verify flows.
- Constraint: redesign keeps every route, data flow, store and API call; only presentation changes. Pages must still work in dark mode classes where they exist, but dark mode is not a confirmed requirement.
- Decided (29 Oct 2026): the deck editor is the only builder. The legacy v1 quiz, quest and survey editors and pages were removed.

## Brand Commitments

- Name: **MindSpear**, by BdREN. The logo (brain/spear mark with "MindSpear" wordmark, `public/images/logo/logo.svg`, `frontend/src/assets/logos/`) **stays as is** (confirmed).
- The logo's colours (orange #F79945, orchid/plum #BC5EB3, pink #ED3A76, with a cobalt-to-plum gradient in the brain) are the seeds the palette is reworked around; the exact current working palette, type (Satoshi) and components are **not** binding (confirmed: "keep the logo; rework the palette around it").
- Voice in current copy is plain and instructional ("Enter the code on the host's screen"); no tone guide exists.
- **Standing preference (confirmed 26 Oct 2026):** keep the current layout and orientation of every page (header, sidebar, card structure); the redesign is a new palette, type and finish plus UX changes, not a replacement visual world. The user wants it "more playful and game-like" and "eye-soothing"; the current colours read "old and faded". Reference products this should sit alongside: live-quiz tools of the Kahoot / Quizizz / Mentimeter class, at their craft level. The host's live-event screens are the one area where the UX itself must change.

## Evidence on Hand

- Logo files, favicon, PWA icons (`frontend/public/images/logo`, `frontend/public/pwa`).
- Stock-style illustrations used today: `public/images/hero-image-1.jpg`, `HowItWorksCreate/Interact/Analyze.png`, quiz/quest card illustrations. None are brand assets; they may be replaced.
- Real sample data in the dev database (quizzes such as "QA - Timer sync", sessions with 1–6 participants) for screenshots.
- **Absent**: testimonials, customer or institution logos, usage statistics, press. Do not fabricate any of these; use labelled placeholders.

## Product Principles

1. The host's screen is for the room; the student's screen is for one thumb. Design each for its distance.
2. Running a class is the moment that matters: anything on the path from "open quiz" to "first question on the projector" earns extra care.
3. Reports exist to change next week's lecture: lead with what to re-teach, not with totals.
4. Three formats, one vocabulary: the same words, states and controls across Quiz, Quest and Fun Games.
5. Institutional trust without dullness: this is university infrastructure, and also a game students want to play.

## Accessibility & Inclusion

- Presenter surfaces must hold contrast on a washed-out projector; answer options must be distinguishable by shape/letter as well as colour (inferred from the lecture-hall context; not a user-stated standard).
- Participant surfaces: 44px+ touch targets, one-handed reach, works with the on-screen keyboard open (the existing `/play` shell already handles keyboard insets and safe areas; preserve that).
