# BdREN MindSpear Frontend

## Getting Started

**Run the development server:**

```bash
npm install

# then

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

In the Docker setup the production build runs as the `frontend` service (`docker compose up -d --build frontend` after code changes); the `frontend-dev` service runs `next dev` with hot reload on port 3001.

## Project Structure

```
frontend/
├── public/                    # Static assets, PWA icons
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── (auth)/            # Sign in, sign up, password reset, email verification
│   │   ├── (play)/            # Participant app (/play): join a live quiz or quest
│   │   ├── (protected)/       # Signed-in pages: dashboard, my-library, discover, quizzes/quests
│   │   │                      #   (edit + present), bank, my-files, fun-games, profile, settings, billing
│   │   ├── (public)/          # Landing page, plans, Fun Games participant page (attempt/fun-games)
│   │   ├── api/               # Next.js route handlers (auth)
│   │   ├── layout.tsx         # Root layout
│   │   ├── providers.tsx      # Theme, Redux (+ persist) and sidebar providers
│   │   └── ProtectedRoute.tsx # Redirects signed-out users
│   ├── features/              # Feature modules (components, hooks, api, types per feature)
│   │   ├── deck/              # Shared quiz/quest ("deck") API client, routes, types, theme
│   │   ├── deck-editor/       # Deck editor and the per-slide-type editor/participant/presenter views
│   │   ├── deck-presenter/    # Host screen for a live session
│   │   ├── deck-participant/  # Participant screens under /play
│   │   ├── deck-library/      # My Library and Discover lists, "new quiz/quest" cards
│   │   ├── fun-games/         # Fun Games host and participant apps
│   │   ├── file-library/      # My Files, upload and file picker
│   │   ├── ai-generate/       # AI question generation (document → questions)
│   │   ├── dashboard/         # Dashboard stats, question bank UI, billing and plans views
│   │   └── auth/              # Auth forms and the auth Redux slice
│   ├── components/            # Shared UI: layouts (header, sidebar), form elements, ui primitives
│   ├── stores/store.ts        # Redux store (signed-in user only, persisted)
│   ├── utils/axiosInstance.ts # Axios client for the Laravel API (token, 401 handling)
│   ├── lib/echo.ts            # Laravel Echo / Reverb client
│   ├── config/                # API and env config, Tailwind theme tokens
│   ├── hooks/                 # Generic hooks
│   ├── types/, interfaces/    # Shared TypeScript types
│   └── styles/                # Global CSS
├── next.config.ts             # Next.js config (/join redirect, API proxy rewrites, standalone output)
├── tailwind.config.ts         # Tailwind CSS config
└── package.json
```

## Key Features

-   **Quiz and Quest decks**: one slide-based editor, presenter and participant app for both products; quizzes are scored with a leaderboard, quests collect polls, word clouds and Q&A
-   **Real-time sessions**: Laravel Echo/Reverb for live slides, results and participant counts
-   **Fun Games**: import questions from a quiz or a document and host them as a party game
-   **My Files**: personal file library with a storage quota
-   **Question Bank**: personal and public banks with categories
-   **AI generation**: questions from an uploaded document

## Technologies Used

-   Next.js 15 (App Router)
-   React 19
-   TypeScript
-   Tailwind CSS 3, Ant Design 5
-   Laravel Echo + Reverb
-   Redux Toolkit + redux-persist
-   ESLint

## Environment Variables

The application uses the following environment variables (defined in `.env.example`):

-   `NEXT_PUBLIC_API_BASE_URL`: Backend API base URL, for example `http://localhost:8000/api/v1`
-   `NEXT_PUBLIC_AI_API_URL`: AI server base URL (question generation)
-   `NEXT_PUBLIC_APP_URL`: Public URL of this app (Fun Games join links rendered on the server)
-   `NEXT_PUBLIC_REVERB_APP_KEY`: Reverb app key from the Laravel backend
-   `NEXT_PUBLIC_REVERB_HOST`: Reverb websocket host, for example `localhost`
-   `NEXT_PUBLIC_REVERB_PORT`: Reverb websocket port, usually `8080` locally
-   `NEXT_PUBLIC_REVERB_SCHEME`: `http` for local development or `https` in production
-   `NEXT_PUBLIC_FUN_GAMES_MOCK`: `1` (or `true`) serves every Fun Games call from an in-browser mock

## Development Scripts

-   `npm run dev`: Start development server
-   `npm run build`: Build the application for production
-   `npm run start`: Start production server
-   `npm run lint`: Run ESLint
