# MindSpear - Development Guide

> **Purpose**: This document is the single source of truth for AI coding assistants and developers working on MindSpear. It describes everything that exists today — architecture, conventions, data flow, file locations, and patterns — so you can make informed changes without guessing.

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Backend Architecture (Laravel 12)](#4-backend-architecture-laravel-12)
   - 4.1 [Directory Map](#41-directory-map)
   - 4.2 [Database Schema & Models](#42-database-schema--models)
   - 4.3 [API Routing](#43-api-routing)
   - 4.4 [Controllers & Business Logic](#44-controllers--business-logic)
   - 4.5 [Authentication & Authorization](#45-authentication--authorization)
   - 4.6 [Form Requests & Validation](#46-form-requests--validation)
   - 4.7 [Helpers, Traits & Casts](#47-helpers-traits--casts)
   - 4.8 [Observers, Listeners & Events](#48-observers-listeners--events)
   - 4.9 [Mail System](#49-mail-system)
   - 4.10 [File Uploads](#410-file-uploads)
   - 4.11 [Excel Exports](#411-excel-exports)
   - 4.12 [Filament Admin Panel](#412-filament-admin-panel)
   - 4.13 [Seeders & Factories](#413-seeders--factories)
5. [Frontend Architecture (Next.js 15)](#5-frontend-architecture-nextjs-15)
   - 5.1 [Directory Map](#51-directory-map)
   - 5.2 [App Router & Layouts](#52-app-router--layouts)
   - 5.3 [Redux Store & State Management](#53-redux-store--state-management)
   - 5.4 [API Layer (Axios)](#54-api-layer-axios)
   - 5.5 [Laravel Reverb Real-Time Communication](#55-laravel-reverb-real-time-communication)
   - 5.6 [Type System](#56-type-system)
   - 5.7 [Custom Hooks](#57-custom-hooks)
   - 5.8 [Component Library & UI Patterns](#58-component-library--ui-patterns)
   - 5.9 [Content Editor System](#59-content-editor-system)
   - 5.10 [AI Features (OpenAI)](#510-ai-features-openai)
6. [Data Flow: End-to-End Walkthroughs](#6-data-flow-end-to-end-walkthroughs)
7. [Entity Relationship Map](#7-entity-relationship-map)
8. [API Response Contract](#8-api-response-contract)
9. [Naming Conventions & Patterns](#9-naming-conventions--patterns)
10. [Known Quirks & Technical Debt](#10-known-quirks--technical-debt)
11. [Environment & Configuration](#11-environment--configuration)
12. [What Does NOT Exist Yet](#12-what-does-not-exist-yet)

---

## 1. Project Identity

**MindSpear** is an interactive educational platform that combines three assessment tools into a single product:

| Module   | Inspiration   | What It Does |
|----------|---------------|--------------|
| **Quiz** | Kahoot        | Real-time, timed MCQ quizzes with leaderboards. Host live or schedule for later. |
| **Quest**| Mentimeter    | Task-based interactive sessions with varied question types (scales, ranking, word cloud, short/long answer, quick forms). Live hosting with real-time results. |
| **Survey**| Google Forms | Multi-page surveys with conditional branching/logic, anonymous or authenticated responses. |

All three modules share common patterns: create content, host a session (live or async), participants join via link/code, results are collected and reported.

**Production domain**: `mindspear.app` (frontend), `admin.mindspear.app` (Filament admin)
**Legacy domain references**: `eduquest.bdren.net.bd`, `quest.bdren.net.bd` (may appear in older config)

---

## 2. Tech Stack

### Backend
| Layer           | Technology                        | Version   |
|-----------------|-----------------------------------|-----------|
| Framework       | Laravel                           | 12.x      |
| PHP             | PHP                               | ^8.4      |
| Auth (API)      | Laravel Sanctum                   | ^4.1      |
| Auth (Roles)    | Spatie Laravel Permission         | ^6.17     |
| Admin Panel     | Filament                          | ^3        |
| Social Login    | Laravel Socialite + Microsoft     | ^5.23     |
| Excel Export    | Maatwebsite Excel                 | ^3.1      |
| Testing         | Pest PHP                          | ^3.7      |
| Build Tool      | Vite (for Filament assets only)   | ^6        |
| Database        | SQLite (dev) / MySQL (prod)       | -         |

### Frontend
| Layer           | Technology                        | Version   |
|-----------------|-----------------------------------|-----------|
| Framework       | Next.js (App Router)              | 15.3      |
| React           | React                             | 19.1      |
| Language        | TypeScript                        | ^5        |
| State           | Redux Toolkit + redux-persist     | ^2.8      |
| HTTP Client     | Axios                             | ^1.9      |
| Real-Time       | Laravel Echo + Reverb             | Echo ^2.3 |
| UI Library      | Ant Design                        | ^5.25     |
| CSS             | Tailwind CSS                      | ^3.4      |
| Rich Text       | Tiptap                            | ^3.9      |
| Charts          | ApexCharts, Recharts, Highcharts, D3 | various |
| Forms           | React Hook Form + Zod             | ^7.56     |
| DnD             | dnd-kit + @hello-pangea/dnd       | various   |
| Animations      | Framer Motion                     | ^12.23    |
| PDF             | jsPDF, pdfjs-dist                 | various   |
| PPTX            | pptxgenjs                         | ^4.0      |

### Dev Server Ports
| Service        | Port |
|----------------|------|
| Frontend       | 2000 |
| Backend API    | 8000 |
| Reverb         | 8080 |
| Filament Admin | 8000 (path: `/super-admin`) |

---

## 3. Repository Layout

```
MindSpear/
├── frontend/                  # Next.js 15 application
├── backend/                   # Laravel 12 application
├── SETUP_GUIDE.md             # How to run locally on WSL
└── DEVELOPMENT_GUIDE.md       # This file
```

There is **no monorepo tooling** (no Turborepo, no Nx). Frontend and backend are independent projects with separate dependency management (`npm` vs `composer`).

---

## 4. Backend Architecture (Laravel 12)

### 4.1 Directory Map

```
backend/
├── app/
│   ├── Casts/
│   │   └── LocalTimezoneDatetime.php       # UTC↔local timezone conversion
│   ├── Exports/
│   │   ├── Quizzes/                        # Excel exports for quiz sessions
│   │   └── Quests/                         # Excel exports for quest sessions
│   ├── Filament/
│   │   ├── Pages/                          # Dashboard, MyProfile, ChangePassword, Auth/Login
│   │   ├── Resources/                      # UserResource (CRUD)
│   │   └── Widgets/                        # StatsOverview, UsersByDayChart, QuizParticipantsByDayChart
│   ├── Helpers/
│   │   ├── helpers.php                     # Join link/code generators, storage driver, frontend_url
│   │   └── EnvHelper.php                   # Read/write .env at runtime
│   ├── Http/
│   │   ├── Controllers/api/v1/             # All API controllers (see §4.4)
│   │   ├── Middleware/
│   │   │   ├── Authenticate.php            # Sanctum auth check
│   │   │   └── UseWebGuardForFilament.php  # Forces web guard for admin panel
│   │   └── Requests/                       # Form request validation (see §4.6)
│   │       ├── Authentication/             # Register, Login, ForgotPassword, ResetPassword, VerifyEmail
│   │       ├── Quiz/                       # Quiz/, Question/, QuestionBank/, HostLive/, HostLater/, QuizAttempt/
│   │       ├── Survey/                     # Survey/, SurveyPage/, SurveyQuestion/, SurveyAttempt/, QuestionBank/
│   │       ├── Quest/                      # Quest/, QuestTask/, QuestTaskBank/, HostLive/, QuestAttempt/
│   │       ├── File/
│   │       ├── Institution/
│   │       ├── Preference/
│   │       ├── Profile/
│   │       └── SocialConfig/
│   ├── Listeners/
│   │   ├── LogLogin.php                    # Auth\Login event → LoginLog
│   │   ├── LogLogout.php                   # Auth\Logout event → LoginLog update
│   │   └── LogEmailSent.php               # Mail\MessageSent event → EmailLog
│   ├── Mail/
│   │   ├── VerifyEmailMail.php             # Email verification (queued)
│   │   └── PasswordResetMail.php           # Password reset (queued)
│   ├── Models/                             # Eloquent models (see §4.2)
│   │   ├── User.php
│   │   ├── Institution.php
│   │   ├── File.php
│   │   ├── Preference.php
│   │   ├── PasswordResetToken.php
│   │   ├── Quiz/                           # Quiz, Question, QuizSession, QuizParticipant, UserQuizAnswer, BankQuestion, QuestionBankCategory, QuizOrigin
│   │   ├── Survey/                         # Survey, SurveyPage, SurveyQuestion, SurveyQuestionAnswer, SurveyResponse, BankQuestion, SurveyQuestionBankCategory
│   │   ├── Quest/                          # Quest, QuestTask, QuestSession, QuestParticipant, QuestTaskCompletion, QuestTaskDependency, BankTask, QuestTaskBankCategory, QuestOrigin
│   │   └── Log/                            # ActivityLog, LoginLog, EmailLog
│   ├── Observers/
│   │   ├── ActivityLoggerObserver.php      # Tracks created/updated/deleted/restored on User, Institution, Quiz, Survey, Quest
│   │   └── PersonalAccessTokenObserver.php # Tracks Sanctum token creation → LoginLog
│   ├── Providers/
│   │   ├── AppServiceProvider.php          # Loads multi-folder migrations, registers observers
│   │   ├── EventServiceProvider.php        # Login/Logout/EmailSent listeners
│   │   └── Filament/AdminPanelProvider.php # Admin panel config
│   └── Traits/
│       ├── ApiResponseTrait.php            # Standardized JSON responses (see §8)
│       └── FileUploadTrait.php             # File upload/delete/check helpers
├── bootstrap/
│   ├── app.php                             # Route loading, middleware, exception handling
│   └── providers.php                       # AppServiceProvider, EventServiceProvider, AdminPanelProvider
├── config/                                 # Standard Laravel config + permission.php, services.php
├── database/
│   ├── migrations/                         # Core tables
│   │   ├── Quiz/                           # 20+ quiz-related migrations
│   │   ├── Survey/                         # 25+ survey-related migrations
│   │   └── Quest/                          # 18+ quest-related migrations
│   ├── seeders/                            # SuperAdminSeeder, UsersTableSeeder, module seeders
│   └── factories/                          # UserFactory
├── routes/
│   ├── api.php                             # Loads all api/v1/* routes under sanctum middleware
│   ├── web.php                             # Filament admin routes
│   └── api/v1/
│       ├── auth.php                        # Authentication endpoints
│       ├── Quiz/                           # quizes.php, questions.php, questionbank.php, questionbankcategory.php, quizparticipants.php, quizattempts.php
│       ├── Survey/                         # surveys.php, surveyquestions.php, surveypages.php, surveyresponses.php, surveyattampts.php, surveyquestionbank.php, surveyquestionbankcategories.php
│       ├── Quest/                          # quests.php, questtasks.php, questparticipants.php, questattempts.php, questtaskbank.php, questtaskbankcategories.php
│       ├── Dashboard/dashboard.php
│       ├── profiles.php, institutions.php, files.php, logs.php, preferences.php
│       └── socialauth.php, socialsettings.php
└── resources/
    ├── views/emails/                       # Blade templates for verification/reset emails
    └── css/filament/admin/theme.css        # Filament admin theme overrides
```

### 4.2 Database Schema & Models

#### Core Tables

**users**
| Column | Type | Notes |
|--------|------|-------|
| id | bigint PK | |
| first_name | string(50) | |
| last_name | string(50) | |
| email | string(110) | unique |
| email_verified_at | timestamp | null = unverified |
| password | string | bcrypt hashed |
| phone | string | nullable |
| profile_picture | string | nullable, path to uploaded image |
| account_type | string | nullable |
| designation | string | nullable |
| department | string | nullable |
| institution_id | FK → institutions | nullable |
| provider | string | nullable (google/microsoft) |
| provider_id | string | nullable |
| email_verification_token | string | nullable |
| remember_token | string | |
| timestamps | | |

**institutions** — Soft-deletable. Fields: name, address, city, state, country, postal_code, phone, email, website, type, logo, status. Tracking: created_by, updated_by, deleted_by (all FK → users).

**files** — Soft-deletable. Fields: name, path, type, size, mime_type, extension, original_name, user_id. Status: is_active, is_deleted. Audit: created_by, updated_by, deleted_by, restored_by.

**preferences** — Key-value store: category, field, value (JSON).

#### Quiz Module

```
quizes
├── questions                    (1:N)
├── quiz_sessions                (1:N)
│   └── quiz_participants        (1:N via session)
│       └── user_answers         (1:N)
├── quiz_origins                 (1:1, tracks original creator for copies)
└── question_bank_categories     (standalone, hierarchical)
    └── bank_questions           (reusable question library)
```

**quizes** (note: table name has intentional typo, not "quizzes")
| Column | Type | Notes |
|--------|------|-------|
| id | bigint PK | |
| title | string(255) | required |
| description | text | nullable |
| user_id | FK → users | creator |
| is_published | boolean | default false |
| is_live | boolean | default false |
| visibility | enum | public/private/unlisted |
| join_link | string | auto-generated (xxx-xxx-xxx-xxx) |
| join_code | string | auto-generated (6-digit zero-padded) |
| is_pin_required | boolean | |
| pin | string | nullable |
| duration | integer | quiz duration in seconds |
| open_datetime | datetime | nullable, stored as UTC |
| close_datetime | datetime | nullable, stored as UTC |
| timezone | string | e.g. "Asia/Dhaka" |
| logged_in_users_only | boolean | |
| safe_browser_mode | boolean | |
| quiztime_mode | string | nullable |
| origin_owner_id | integer | nullable, original creator for copies |
| origin_owner_name | string | nullable |
| origin_owner_profile_picture | string | nullable |
| soft deletes, timestamps | | |

**questions** — Fields: quiz_id, owner_id, serial_number, question_text, question_type, options (JSON), time_limit_seconds, points, image_url, is_ai_generated, source_content_url, visibility. Soft deletes.

**quiz_sessions** — Fields: quiz_id, title, session_id (format: `QUIZ-{quizId}-{timestamp}-{random}`), running_status, start_datetime, end_datetime, is_host_live, join_link, join_code, quiztime_mode, quiz_mode, timezone.

**quiz_participants** — Fields: quiz_id, quiz_session_id, user_id, is_anonymous, anonymous_details (JSON), start_time, end_time, score, status (In Progress/Completed/Abandoned).

**user_answers** — Fields: quiz_participant_id, question_id, answer_data (JSON), time_taken_seconds.

**question_bank_categories** — Hierarchical: parent_category_id for nesting. Fields: name, description, is_parent, color_code, created_by.

**bank_questions** (Quiz) — Reusable question library. Fields: q_bank_category_id, owner_id, question_text, question_type, options (JSON), time_limit_seconds, points, is_ai_generated, visibility. Soft deletes.

#### Survey Module

```
surveys
├── survey_pages                 (1:N, ordered by page_number)
│   └── survey_questions         (1:N per page)
│       └── survey_question_answers  (1:N per question per response)
├── survey_responses             (1:N)
│   └── survey_question_answers  (1:N)
└── survey_q_bank_categories     (standalone, hierarchical)
    └── survey_bank_questions    (reusable question library)
```

**surveys** — Fields: title(100), description, creator_id, is_published, visibility (public/private), join_link, open_datetime, close_datetime, origin_owner_id/name/profile_picture. Soft deletes.

**survey_pages** — Fields: survey_id, page_number, title, description. Conditional logic: has_conditional_logic, conditional_parent_type, conditional_question_id, conditional_page_id, conditional_value, conditional_operator. Unique index on (survey_id, page_number). Soft deletes.

**survey_questions** — Fields: survey_id, page_id, owner_id, serial_number, question_text, question_type, options (JSON), is_required, display_conditions (JSON). Conditional logic: has_conditional_logic, conditional_parent_type, conditional_question_id, conditional_value, conditional_operator. Soft deletes.

**survey_responses** — Fields: survey_id, respondent_id, is_anonymous, anonymous_details (JSON), start_time, end_time, submitted_at, status (In Progress/Completed), current_page_id, progress_data (JSON).

**survey_question_answers** — Fields: response_id, question_id, answer_data (JSON), is_validated, validation_notes.

#### Quest Module

```
quests
├── quest_tasks                  (1:N)
│   ├── quest_task_dependencies  (M:N self-referential prerequisites)
│   └── quest_task_completions   (1:N per participant)
├── quest_sessions               (1:N)
│   └── quest_participants       (1:N per session)
│       └── quest_task_completions (1:N)
└── quest_task_bank_categories   (standalone, hierarchical)
    └── quest_bank_tasks         (reusable task library)
```

**quests** — Constants: STATUS_NOT_STARTED, STATUS_INITIATED, STATUS_RUNNING, STATUS_ENDED. Fields: title, description, creator_id, is_published, status, visibility, join_link, join_code, sequential_progression (boolean), start_datetime, end_datetime, timezone, origin_owner_id/name/profile_picture. Soft deletes.

**quest_tasks** — Fields: quest_id, owner_id, title, description, task_type, serial_number, task_data (JSON), is_required. Soft deletes. Self-referential M:N via `quest_task_dependencies` pivot (task_id, prerequisite_task_id).

**Task types** (from frontend `TaskType` enum):
- `single_choice`, `truefalse`, `ranking`, `sorting`, `scales`, `wordcloud`, `shortanswer`, `longanswer`, `quick_form`

**quest_sessions** — Fields: quest_id, title, session_id (format: `QUEST-{questId}-{timestamp}-{random}`), running_status, start_datetime, end_datetime, timezone.

**quest_participants** — Fields: quest_id, quest_session_id, user_id, is_anonymous, anonymous_details (JSON), start_time, end_time, status (In Progress/Completed/Failed).

**quest_task_completions** — Fields: participant_id, task_id, status (Completed/Pending/Skipped), completed_at, completion_data (JSON).

#### Logging Tables

**activity_logs** — Fields: user_id, subject_type (model class), subject_id, event (created/updated/deleted/restored), changes (JSON of old→new), ip, user_agent.

**login_logs** — Fields: user_id, guard, ip, user_agent, status (success/logout), logged_in_at, logged_out_at.

**email_logs** — Fields: to, subject, mailable (class name), status, message_id, sent_at.

### 4.3 API Routing

**Base path**: `/api/v1/`
**Auth middleware**: `auth:sanctum` on all protected routes.

All route files are loaded in `bootstrap/app.php` from `routes/api/v1/` subdirectories.

#### Authentication (`/api/v1/`)
| Method | Path | Auth | Controller Method |
|--------|------|------|-------------------|
| POST | `/register` | No | AuthenticationController@register |
| POST | `/login` | No | AuthenticationController@login |
| POST | `/forgot-password` | No | AuthenticationController@forgotPassword |
| POST | `/forgot-password-resend` | No | AuthenticationController@resendForgotPassword |
| POST | `/reset-password` | No | AuthenticationController@resetPassword |
| POST | `/verify-email` | No | AuthenticationController@verifyEmail |
| POST | `/resend-verification` | No | AuthenticationController@resendVerificationEmail |
| GET | `/user-check` | Yes | AuthenticationController@user |
| POST | `/logout` | Yes | AuthenticationController@logout |
| GET | `/public/join-by-code/{joinCode}` | No | AuthenticationController@publicJoinByCode |

#### Quiz CRUD (`/api/v1/quizes`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/quizes` | Yes | List user's quizzes (filterable) |
| GET | `/quizes/show/{id}` | Yes | Show quiz with questions |
| POST | `/quizes/store` | Yes | Create quiz |
| POST | `/quizes/update/{id}` | Yes | Update quiz |
| DELETE | `/quizes/delete/{id}` | Yes | Soft delete quiz |
| POST | `/quizes/copy-with-questions/{id}` | Yes | Duplicate quiz with all questions |
| POST | `/quizes/add-my-library/{id}` | Yes | Copy to library (tracks origin) |

#### Quiz Hosting
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/quizes/host-live/{id}` | Yes | Create live session |
| POST | `/quizes/update-host-live/{id}` | Yes | Update live session |
| POST | `/quizes/end-host-live/{id}` | Yes | End live session |
| POST | `/quizes/status-host-live/{id}` | Yes | Check/update live status |
| GET | `/quizes/host-live-check/{userId}` | Yes | Is user hosting live? |
| POST | `/quizes/host-later/{id}` | Yes | Schedule future session |
| POST | `/quizes/update-host-later/{id}` | Yes | Update scheduled session |
| POST | `/quizes/time-host-later/{id}` | Yes | Adjust scheduled time |
| POST | `/quizes/status-host-later/{id}` | Yes | Check scheduled status |

#### Quiz Public & Check
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/quizes-public` | Yes | Discover public quizzes |
| GET | `/quizes-public/show/{id}` | Yes | View public quiz |
| GET | `/quizes-check/id/{id}` | No | Check quiz by ID |
| GET | `/quizes-check/join-link/{joinLink}` | No | Look up by join link |
| GET | `/quizes-check/join-code/{joinCode}` | No | Look up by join code |

#### Quiz Attempts (`/api/v1/quiz-attempts`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/quiz-attempts/join` | Varies | Join quiz by link/code |
| GET | `/quiz-attempts/{participantId}/current-question` | Yes | Get next question |
| POST | `/quiz-attempts/record-answer` | Yes | Submit answer |
| POST | `/quiz-attempts/submit-attempt` | Yes | Complete attempt |

**Survey and Quest modules follow the same pattern**: CRUD, hosting, public/check, and attempts. Replace "quiz" with "survey" or "quest" and "questions" with "pages/questions" or "tasks".

#### Survey-specific endpoints
- `survey-pages/*` — CRUD for pages within a survey
- `survey-questions/*` — CRUD for questions within pages
- `survey-responses/*` — Record answers, navigate pages with conditional logic
- `survey-attempts/*` — Join, start, record, submit

#### Quest-specific endpoints
- `quest-tasks/*` — CRUD for tasks within a quest
- `quest-attempts/*` — Join, complete-task, submit
- Session-latest-creator endpoint for checking active sessions

#### Supporting Endpoints
| Prefix | Purpose |
|--------|---------|
| `/profiles` | User profile CRUD, profile picture upload |
| `/institutions` | Institution CRUD |
| `/files` | File upload/management |
| `/logs` | Login logs, activity logs, email logs |
| `/preferences` | System/user preferences key-value |
| `/socialauth` | Social auth config (Google, Microsoft) |
| `/Dashboard` | Dashboard statistics |

### 4.4 Controllers & Business Logic

All API controllers extend `ApiBaseController` which uses `ApiResponseTrait` and `FileUploadTrait`.

**Controller Location**: `app/Http/Controllers/api/v1/`

**Key patterns across all controllers**:

1. **Ownership validation**: Private helper methods like `ensureQuizOwner()`, `ensureSurveyOwner()` check `resource.user_id === auth()->id()`. Returns 403 if not owner.

2. **Auto-generated identifiers**: On `store()`, `prepareForValidation()` in the FormRequest auto-generates `join_link`, `join_code`, and sets `user_id` from auth.

3. **Timezone handling**: Datetimes arrive in the user's local timezone, get converted to UTC for storage in `validated()` method of FormRequests. `LocalTimezoneDatetime` cast converts back on read.

4. **Copy/duplicate pattern**: `copyWithQuestions()` / `copyWithTasks()` clones the parent entity and all children in a DB transaction. Sets `origin_owner_id/name/profile_picture` for attribution.

5. **Host live flow**: Creates a Session record with `running_status=true`, generates a session-specific `join_link` and `join_code`. End live updates `running_status=false`.

6. **Host later flow** (Quiz only): Creates a Session record with scheduled `start_datetime`/`end_datetime`. Status polling checks if the scheduled time has arrived.

7. **Attempt flow**: Participants join by link/code → creates Participant record → answers recorded one by one → `submit-attempt` marks status as Completed.

### 4.5 Authentication & Authorization

#### API Authentication (Sanctum)
- All API routes protected with `auth:sanctum` middleware
- Token generated on login: `$user->createToken(config('app.name'))->plainTextToken`
- Token passed as `Authorization: Bearer {token}` header
- 401 responses when token is invalid/expired

#### Email Verification
- Registration sends `VerifyEmailMail` with a verification token
- User cannot log in until `email_verified_at` is set
- Token validated via `email_verification_token` column on users table
- 60-minute token expiry on password reset tokens

#### Role-Based Access (Spatie)
- `User` model uses `HasRoles` trait
- Roles: `Super Admin` (seeded) — required for Filament admin access
- Custom middleware registered: `RoleMiddleware`, `PermissionMiddleware`, `RoleOrPermissionMiddleware`
- Permissions system is in place but not heavily utilized yet beyond Super Admin

#### Filament Admin (Web Guard)
- Separate session-based auth at `/super-admin`
- `UseWebGuardForFilament` middleware forces web guard
- Login page: `App\Filament\Pages\Auth\Login`
- Only users with `Super Admin` role can access

#### Social OAuth
- Google and Microsoft login via Socialite
- Callback flow: Frontend redirects to provider → provider redirects back with code → frontend sends code to backend → backend exchanges for user data → creates/links user → returns Sanctum token
- Provider fields on User: `provider`, `provider_id`

### 4.6 Form Requests & Validation

**Base class**: `BaseFormRequest` extends Laravel's `FormRequest`
- Overrides `failedValidation()` to throw `HttpResponseException` with 422 JSON response
- All validation errors returned in standardized format via `ApiResponseTrait`

**Key validation rules by module**:

| Request | Rules |
|---------|-------|
| RegisterRequest | first_name: required, max:50; last_name: required, max:50; email: required, unique:users, max:110; password: required, min:8, confirmed |
| LoginRequest | email: required, email; password: required |
| Quiz\StoreRequest | title: required, max:255; visibility: in:public,private,unlisted; datetimes: Y-m-d H:i:s with timezone validation |
| Survey\StoreRequest | title: required, max:100; visibility: required, in:public,private; close_datetime: after_or_equal:open_datetime |
| Quest\StoreRequest | title: required; creator auto-set |
| Question\StoreRequest | quiz_id: required, exists; question_text: required; options: nullable, JSON array; points: min:0; time_limit_seconds: min:0 |

**Request directories**:
```
app/Http/Requests/
├── Authentication/     # 6 request classes
├── Quiz/
│   ├── Quiz/           # Store, Update
│   ├── Question/       # Store, Update
│   ├── QuestionBank/   # Store, Update
│   ├── QuestionBankCategory/
│   ├── HostLive/       # Store, Update, End, Status
│   ├── HostLater/      # Store, Update, Time, Status
│   └── QuizAttempt/    # Join, RecordAnswer, Submit
├── Survey/
│   ├── Survey/         # Store, Update
│   ├── SurveyPage/     # Store, Update
│   ├── SurveyQuestion/ # Store, Update
│   ├── SurveyAttempt/  # Join, RecordAnswer, Submit
│   ├── QuestionBankCategory/
│   └── SurveyQuestionBank/
├── Quest/
│   ├── Quest/          # Store, Update
│   ├── QuestTask/      # Store, Update
│   ├── QuestTaskBank/  # Store, Update
│   ├── HostLive/       # Store, Update, End, Status
│   └── QuestAttempt/   # Join, CompleteTask, Submit
├── File/
├── Institution/
├── Preference/
├── Profile/
└── SocialConfig/
```

### 4.7 Helpers, Traits & Casts

#### helpers.php (`app/Helpers/helpers.php`)
```php
getStorageDriver()              // Returns 'public' or 's3' from config
frontend_url($path)             // Builds full frontend URL
generate_quiz_join_link()       // Format: xxx-xxx-xxx-xxx (alphanumeric)
generate_quiz_join_code()       // Format: 000000-999999 (6-digit)
generate_survey_join_link()     // Format: xxx-xxx-xxx (3-segment)
generate_quest_join_link()      // Format: xxx-xxx-xxx-xxx
generate_quest_join_code()      // Format: 000000-999999
generate_quest_session_id()     // Format: QUEST-{id}-{timestamp}-{random}
generate_quiz_session_id()      // Format: QUIZ-{id}-{timestamp}-{random}
```
All generators retry recursively if a duplicate is found in the database.

#### EnvHelper (`app/Helpers/EnvHelper.php`)
- `getEnvValues(array $keys)` — Read multiple values from `.env`
- `setEnvValues(array $values)` — Write key-value pairs to `.env`, clears config cache
- `keyExists(string $key)` — Check if a key exists in `.env`

#### ApiResponseTrait (`app/Traits/ApiResponseTrait.php`)
Provides 21 response methods. See [§8 API Response Contract](#8-api-response-contract).

#### FileUploadTrait (`app/Traits/FileUploadTrait.php`)
- `uploadFile($file, $baseDir, $oldFile = null)` — Stores to `storage/{Y}/{m}/{d}/{baseDir}/`, deletes old file if provided
- `removeFile($path)` — Delete from storage
- `checkExistsFile($path)` — Check file existence
- Uses `getStorageDriver()` to determine disk

#### LocalTimezoneDatetime Cast (`app/Casts/LocalTimezoneDatetime.php`)
- **Get**: Converts UTC datetime from DB → user's timezone (reads `timezone` attribute from model)
- **Set**: Stores as-is (assumes already converted in FormRequest)
- Applied to: Quiz (open_datetime, close_datetime), Survey, Quest

### 4.8 Observers, Listeners & Events

#### Observers (registered in `AppServiceProvider`)
| Observer | Models | What It Tracks |
|----------|--------|----------------|
| ActivityLoggerObserver | User, Institution, Quiz, Survey, Quest | created/updated/deleted/restored events → activity_logs table. Stores old vs new values in `changes` JSON. |
| PersonalAccessTokenObserver | PersonalAccessToken (Sanctum) | Token creation → login_logs with status 'success' |

#### Listeners (registered in `EventServiceProvider`)
| Listener | Event | What It Does |
|----------|-------|--------------|
| LogLogin | Illuminate\Auth\Events\Login | Creates login_log record |
| LogLogout | Illuminate\Auth\Events\Logout | Updates last login_log with logout time |
| LogEmailSent | Illuminate\Mail\Events\MessageSent | Creates email_log record |

### 4.9 Mail System

Two mailable classes, both queued:
- **VerifyEmailMail** — Sends verification token link. Template: `resources/views/emails/verify_email.blade.php`
- **PasswordResetMail** — Sends reset token link. Template: `resources/views/emails/password_reset.blade.php`

Default mailer is `log` (emails go to `storage/logs/laravel.log`). Switch to `smtp` in `.env` for real delivery.

### 4.10 File Uploads

- Handled via `FileUploadTrait` in controllers
- Storage path pattern: `{year}/{month}/{day}/{category}/`
- Supports local disk and S3 (configured via `FILESYSTEM_DISK` env)
- File metadata tracked in `files` table
- Profile pictures stored and referenced by path in `users.profile_picture`

### 4.11 Excel Exports

Located in `app/Exports/`:

**Quiz Exports** (`Quizzes/`):
- `QuizSessionsExport` — List of all sessions for a quiz
- `QuizSessionAttemptsExport` — Detailed participant answers with formatting
- `QuizSessionAttemptExportGrouped` — Grouped layout
- `QuizSessionAttemptExportVertical` — Vertical layout

**Quest Exports** (`Quests/`):
- `QuestSessionsExport` — List of quest sessions
- `QuestSessionAttemptsExport` — Detailed task completions
- `QuestSessionAttemptExportGrouped` — Grouped layout
- `QuestSessionAttemptExportVertical` — Vertical layout

All use `Maatwebsite\Excel` with `FromCollection`, `WithHeadings`, `WithMapping`, `WithStyles`.

### 4.12 Filament Admin Panel

**Path**: `/super-admin`
**Guard**: `web` (session-based, NOT Sanctum)
**Access**: `Super Admin` role required

**Pages**:
- Dashboard — Custom dashboard with widgets
- MyProfile — Edit admin profile
- ChangePassword — Change admin password
- Auth/Login — Custom login page

**Resources**:
- UserResource — Full CRUD for users

**Widgets**:
- StatsOverview — Key metrics (total users, quizzes, etc.)
- UsersByDayChart — User registration trend
- QuizParticipantsByDayChart — Quiz participation trend

**Branding**: Primary color `#F79945` (orange), custom logo/favicon.

### 4.13 Seeders & Factories

**SuperAdminSeeder** — Creates `Super Admin` role and a user with env-configurable email/password (`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`).

**UsersTableSeeder** — Seeds test users.

**Module seeders** exist in `database/seeders/Quiz/`, `Survey/`, `Quest/` for populating test data.

**UserFactory** — Standard Laravel factory for generating test User records.

---

## 5. Frontend Architecture (Next.js 15)

### 5.1 Directory Map

```
frontend/src/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root layout: meta, GTM, ClientProviders
│   ├── ClientLayout.tsx                    # Client wrapper: NextTopLoader + Providers
│   ├── providers.tsx                       # Redux Provider + PersistGate + ThemeProvider + SidebarProvider
│   ├── ProtectedRoute.tsx                  # Checks auth.isAuthenticated from Redux
│   ├── (auth)/auth/                        # Public auth pages
│   │   ├── sign-in/page.tsx
│   │   ├── sign-up/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   ├── google/callback/page.tsx        # OAuth callback handler
│   │   └── microsoft/callback/page.tsx     # OAuth callback handler
│   ├── (protected)/                        # All authenticated routes
│   │   ├── layout.tsx                      # Sidebar + Header + route-specific wrappers
│   │   ├── dashboard/
│   │   ├── my-library/                     # Quest, Quiz, Survey tabs
│   │   ├── discover/                       # Public content discovery
│   │   ├── bank/                           # Question/Task bank management
│   │   ├── quiz-creator/                   # Quiz builder UI
│   │   ├── quiz-edit/
│   │   ├── quiz-play/                      # Live quiz participation
│   │   ├── quiz-reports/                   # Quiz analytics
│   │   ├── quest/                          # Quest creation/management
│   │   ├── quest-reports/                  # Quest analytics
│   │   ├── quests-session/                 # Quest session management
│   │   ├── survey/                         # Survey builder/management
│   │   ├── profile/
│   │   ├── settings/
│   │   └── billing/
│   ├── (public)/                           # Public (no auth required) pages
│   │   ├── page.tsx                        # Landing page
│   │   ├── join/                           # Join by code
│   │   ├── live/                           # Live session participation
│   │   ├── attempt/                        # Attempt view
│   │   ├── quiz-public/                    # Public quiz view
│   │   ├── survey-form/                    # Survey form fill
│   │   ├── result-view/                    # Result viewing
│   │   ├── quiz-result-view/
│   │   ├── create-live/                    # Live creation
│   │   ├── plans/                          # Pricing plans
│   │   ├── templates/                      # Template gallery
│   │   └── upcoming/                       # Upcoming events
│   └── api/                                # Next.js API routes (server-side)
│       ├── auth/set-cookie/route.ts        # Sets httpOnly auth_token cookie
│       ├── auth/logout/route.ts            # Clears auth_token cookie
│       ├── generate-quiz/route.ts          # OpenAI GPT-4o quiz generation from PDF/text
│       └── proxy/[...path].ts              # Authenticated proxy to backend API
├── components/                             # Reusable components
│   ├── Auth/                               # Login/register forms
│   ├── Breadcrumbs/                        # Navigation breadcrumbs
│   ├── Chart/                              # Chart components
│   ├── Dashboard/                          # Dashboard widgets
│   ├── ErrorComponent/                     # Error displays
│   ├── FormElements/                       # Form inputs
│   ├── Layouts/                            # Sidebar, Header
│   ├── Library/                            # My Library components
│   ├── Liveui/                             # Live session UI components
│   │   ├── ChoiceComponent.tsx             # MCQ for quiz
│   │   ├── MultipleChoiceComponent.tsx
│   │   ├── TrueFalseComponent.tsx
│   │   ├── FillInTheBlanksComponent.tsx
│   │   ├── ShortAnswerComponent.tsx
│   │   ├── QuestPlayComponent.tsx          # Quest live play
│   │   ├── QuestChoiceComponent.tsx
│   │   ├── QuestRankingComponent.tsx
│   │   ├── QuestScalesChoiceComponent.tsx
│   │   ├── QuestShortAnswerComponent.tsx
│   │   ├── QuestContantComponent.tsx       # Quest content display
│   │   ├── QuickFormPreview.tsx            # Quick form preview
│   │   ├── QuickFromCreateorView.tsx       # Quick form creator view
│   │   ├── QuickFromAnswerView.tsx         # Quick form answer view
│   │   ├── QuizPlayComponent.tsx           # Quiz live play
│   │   ├── QuizAttemptForm.tsx             # Quiz attempt form
│   │   ├── QuestAttemptForm.tsx            # Quest attempt form
│   │   ├── WatingRoomComponent.tsx         # Quest waiting room
│   │   ├── WatingRoomComponentQuiz.tsx     # Quiz waiting room
│   │   └── Scales/                         # Scale-type components
│   ├── QuestReports/                       # Quest report components
│   ├── QuestionBank/                       # Question bank UI
│   ├── QuizReports/                        # Quiz report components
│   ├── ResultComponent/                    # Result display
│   ├── Survey/
│   │   └── GoogleFormStyleSurvey.tsx       # Google-form-style survey renderer
│   ├── SurveyReports/                      # Survey report components
│   ├── editor/                             # Tiptap content editor (see §5.9)
│   ├── questions/                          # Question type selector toggle
│   ├── ui/                                 # Core UI: Title, dropdown, table, skeleton, loader
│   ├── GlobalPagination.tsx                # Reusable pagination
│   ├── GlobalTimeManage.tsx                # Time management
│   ├── GlobalTimeShow.tsx                  # Time display
│   ├── GlobalTimer.tsx                     # Countdown timer
│   ├── SharedQuestTimer.tsx                # Shared quest timer
│   ├── QRCodeGenerator.tsx                 # QR code generation
│   ├── SafeHTMLRendererProps.tsx           # Sanitized HTML render (DOMPurify)
│   ├── ToastProvider.tsx                   # Toast notification provider
│   ├── globalModal.tsx                     # Reusable modal
│   ├── globalBigModal.tsx                  # Large modal
│   └── logo.tsx                            # App logo
├── constants/
│   └── templates.ts                        # Content editor layout templates
├── css/                                    # Global styles
├── hooks/                                  # Custom React hooks (see §5.7)
├── interfaces/
│   └── questionBank.ts                     # APICategory interface
├── services/                               # API service layer
│   ├── questService.ts                     # Quest API calls
│   ├── quizService.ts                      # Quiz API calls (minimal)
│   ├── surveyService.ts                    # Survey API calls (comprehensive)
│   └── redux/                              # Redux-specific services
├── features/live/                          # Live Reverb hooks, services, and UI
├── lib/
│   └── echo.ts                             # Laravel Echo/Reverb client
├── stores/                                 # Redux store (see §5.3)
│   ├── store.ts                            # Store configuration + persist whitelist
│   └── features/                           # Redux slices
├── types/                                  # TypeScript types (see §5.6)
├── utils/                                  # Utility functions
│   ├── axiosInstance.ts                    # Client-side axios with interceptors
│   ├── serverAxios.ts                      # Server-side axios (uses cookies)
│   ├── serverApiService.ts                 # Generic CRUD factory
│   ├── quizUtils.ts                        # Quiz data transformers
│   ├── pdfUtils.ts                         # PDF thumbnail/text extraction
│   ├── prepareChart.ts                     # Quest results → chart data
│   ├── timeframe-extractor.ts              # Timeframe section extraction
│   ├── timerCacheUtils.ts                  # Timer state caching
│   ├── storageCleaner.ts                   # localStorage cleanup
│   ├── showConfirmDialog.ts                # SweetAlert2 confirm dialogs
│   └── QuickFromTransform.ts              # Quick form data transformation
└── views/                                  # Page-level view components
    ├── dashboard/                          # Dashboard views
    ├── discover/                           # Discover tabs (Quest, Quiz, Survey)
    ├── quest/                              # Quest views (QuestView, QuestDuplicate, QuestEnd, etc.)
    ├── survey/                             # Survey views
    └── web/
        ├── plans/                          # Pricing plan comparison
        └── billing/                        # Billing, payment, subscription views
```

### 5.2 App Router & Layouts

**Route Groups**:
- `(auth)` — Sign in, sign up, password reset, OAuth callbacks. No sidebar/header.
- `(protected)` — All authenticated routes. Wrapped in `ProtectedRoute`, has `Sidebar` + `Header`.
- `(public)` — Landing page, join links, live sessions, public views, pricing. No auth required.

**Layout hierarchy**:
```
layout.tsx (Root)
└── ClientLayout.tsx → NextTopLoader
    └── providers.tsx → Redux + Persist + Theme + Sidebar
        ├── (auth)/layout.tsx → minimal layout
        ├── (protected)/layout.tsx → ProtectedRoute + Sidebar + Header
        │   └── Special wrapping for:
        │       - quiz-creator → CreateQuizHeader instead of Header
        │       - quest creator → CreateQuizHeader
        │       - survey → SurveyProvider + SurveyDataInitializer
        └── (public)/layout.tsx → public layout
```

**Route protection**:
- `ProtectedRoute.tsx` reads `auth.isAuthenticated` from Redux store
- If not authenticated, redirects to `/` (home/landing)
- Children only rendered when authenticated

### 5.3 Redux Store & State Management

**Store file**: `stores/store.ts`

**Persisted slices** (survive page refresh via `redux-persist` + localStorage):
| Slice Key | File | Purpose |
|-----------|------|---------|
| `auth` | `features/authSlice.ts` | Token, user data, isAuthenticated |
| `quiz` | `features/quizItems/quizSlice.ts` | Quiz editor state (questions, options, selection) |
| `quizInformation` | `features/quizInformationSlice.ts` | Current quiz metadata |
| `survey` | `survey/surveySlice.ts` | Survey editor state (questions, options) |
| `surveyInformation` | `survey/surveyInformationSlice.ts` | Current survey metadata |
| `surveyQuestions` | `survey/surveyQuestionsSlice.ts` | Questions organized by page |
| `activeSurveyPage` | `survey/activeSurveyPageSlice.ts` | Active page tracker |
| `questInformation` | `features/questInformationSlice.ts` | Current quest metadata |
| `questSession` | `features/questSessionSlice.ts` | Active quest session data |
| `questTime` | `features/questQsenTimeSlice.ts` | Quest question timing |
| `quickForm` | `features/quickFormSlice.ts` | Quick form task builder state |
| `contentEditor` | `features/contentEditorSlice.ts` | Block-based content editor |
| `leaderboard` | `features/leaderboardSlice.ts` | Leaderboard + slide navigation |
| `dropdown` | `features/dropdownSlice.ts` | Dropdown open/close state |

**Auth slice state shape**:
```typescript
interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  user: {
    id: number;
    full_name: string;
    email: string;
    profile_picture?: string | null;
  } | null;
}
```

**Auth thunks**: `loginUser`, `registerUser`, `loginWithGoogle`, `loginWithMicrosoft`, `logoutUser`, `updateProfilePicture`

**Token flow**:
1. Login thunk receives token from API
2. Token stored in localStorage as `auth_token`
3. Cookie set via `/api/auth/set-cookie` for SSR
4. Axios interceptors read from localStorage and attach `Authorization: Bearer {token}`
5. On 401 response, token cleared and redirect to `/`

### 5.4 API Layer (Axios)

**Client-side**: `utils/axiosInstance.ts`
```typescript
// Base URL from NEXT_PUBLIC_API_BASE_URL
// Timeout: 10000ms
// Request interceptor: adds Bearer token + XSRF token
// Response interceptor: handles 401 (clear token, redirect), logs 400/403/404/500

// Exported wrapper:
api.get<T>(url, config?)    → ApiResponse<T>
api.post<T>(url, data?, config?) → ApiResponse<T>
api.put<T>(url, data?, config?)  → ApiResponse<T>
api.delete<T>(url, config?)      → ApiResponse<T>
```

**Server-side**: `utils/serverAxios.ts` — Uses cookies from request headers for SSR.

**Service factory**: `utils/serverApiService.ts`
```typescript
createApiResource<T>(resourcePath) → {
  getAll(params?, config?),
  getById(id, config?),
  create(data, config?),
  update(id, data, config?),
  delete(id, config?),
  customEndpoint(path, method, params?, data?, config?)
}
```

**Module services**:
- `services/questService.ts` — `getAllQuests()`, `getQuestById(id)`, `deleteQuestById(id)`
- `services/surveyService.ts` — Full CRUD + page/question operations
- `services/quizService.ts` — Minimal (most quiz API calls done inline or via Redux thunks)

### 5.5 Laravel Reverb Real-Time Communication

Quiz and Quest live sessions now use Laravel Echo with Reverb. The frontend subscribes to public participant-safe session channels and private host channels:

**Echo/Reverb client** (`src/lib/echo.ts`):
- App key: `NEXT_PUBLIC_REVERB_APP_KEY`
- Host: `NEXT_PUBLIC_REVERB_HOST`
- Port: `NEXT_PUBLIC_REVERB_PORT`
- Scheme: `NEXT_PUBLIC_REVERB_SCHEME`
- Auth endpoint: derived from the backend origin as `/broadcasting/auth`

| Emit Event | Purpose |
|------------|---------|
| `createQuiz` | Host creates quiz room |
| `joinQuiz` | Participant joins |
| `startQuiz` | Begin quiz |
| `changeQuestionQuiz` | Move to next question |
| `submitAnswer` | Participant submits answer |
| `completeQuiz` | Participant completes |
| `leaveQuiz` | Participant leaves |
| `endQuiz` | Host ends quiz |

| Listen Event | Purpose |
|--------------|---------|
| `quizJoined` | Confirmation of join (cached) |
| `participantJoinedQuiz` | New participant notification |
| `quizStartedAll` | Quiz started broadcast |
| `questionChangedQuizAll` | Question change broadcast |
| `answerSubmittedToQuizCreator` | Answer received by host |
| `answerProcessedQuiz` | Answer processed confirmation |
| `quizCompletedAll` | Quiz complete broadcast |
| `quizEndedAll` | Quiz ended broadcast |

**Quest Socket** (`socket/quest-socket.ts`):
Same configuration. Additional events: `submitTaskWithRanking`, `submitTaskForQuickForm`, `questLeaderboard`, `leaderboardUpdatedQuestAll`, `abandonQuest`.

Both sockets implement:
- localStorage caching for join payloads (survives reconnection)
- Visibility change detection (re-sync on tab focus)
- Network status listeners (auto-reconnect)

### 5.6 Type System

**Core types** (`types/types.ts`):
```typescript
OptionItem      { id, text, color, placeholder, isSelected }
QuizItem        { id, title, options[], timeLimit, points, layout_id, image_url, questionType }
User            { id, full_name, email, profile_picture, ... }
Quiz            { id, title, description, visibility, join_link, join_code, is_published, duration, ... }
ApiQuestion     { id, serial_number, question_text, question_type, time_limit_seconds, options, points }
TransformedQuestion  { question_text, question_type, options: {choices[], correct_answer}, ... }
```

**Survey types** (`types/surveyTypes.ts`):
```typescript
SurveyItem      { id, title, options[], questionType, page_id, is_required, conditional_logic... }
SurveyPage      { id, page_number, title, conditional fields... }
SurveyQuestion  extends SurveyItem with metadata
SurveyPageQuestions  { [pageId: string]: SurveyQuestion[] }
```

**Live/Quest types** (`types/liveTypes.ts`):
```typescript
TaskType = 'single_choice' | 'truefalse' | 'ranking' | 'sorting' | 'scales' | 'wordcloud' | 'shortanswer' | 'longanswer' | 'quick_form'
Task            { id, task_type, serial_number, is_required, task_data }
Quest           { id, title, tasks[], sequential_progression, timezone, join_link }
ResultDatum     { task_id, data: string[] | number[] }
PreparedChart   { type: 'bar'|'pie'|'donut'|'wordcloud', data, categories/words }
```

**Quick Form types** (`types/quickForm.types.ts`):
```typescript
UIQuestion      { id: string, type, label, serial_number: string, options: UIOption[] }
UIOption        { id: string, text: string }
QuickFormTaskState  { quest_id, task_id, title, serial_number, questions: UIQuestion[] }
```

**Other type files**: `billing.ts`, `question.ts`, `plan.ts`, `api.ts`, `content.ts`, `public.ts`, `scoreboard.ts`

### 5.7 Custom Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useIsMobile()` | `hooks/use-mobile.ts` | Returns `true` if viewport < 850px. Uses `matchMedia`. |
| `useDebounce(value, delay?)` | `hooks/useDebounce.ts` | Returns debounced value. Default delay: 2000ms. |
| `useClickOutside<T>(callback)` | `hooks/use-click-outside.ts` | Returns ref. Fires callback on click outside the ref element. |
| `useLatestQuestSession(questId)` | `hooks/useLatestQuestSession.ts` | Fetches quest, sorts sessions by `created_at` desc, returns `{ latestSessionId, latestSession, loading, error, refresh }`. |
| `useSurveyAutoSave(question, surveyId)` | `hooks/useSurveyAutoSave.ts` | Auto-saves survey question every 800ms via POST to `/survey-questions/update/{id}`. Returns `{ isSaving, saveError, lastSavedAt, flushSave() }`. |

### 5.8 Component Library & UI Patterns

**UI Framework**: Ant Design (`antd`) for complex components (tables, modals, selects, etc.) + Tailwind CSS for layout and custom styling.

**Custom color palette** (from `tailwind.config.ts`):
- Primary: `#F79945` (orange)
- Secondary: `#BC5EB3` (purple)
- Extensive dark mode support via `class` strategy

**Reusable patterns**:
- `GlobalPagination` — Wraps pagination with consistent styling
- `GlobalTimer` / `SharedQuestTimer` — Countdown timers for live sessions
- `QRCodeGenerator` — Generates QR code for join links
- `SafeHTMLRendererProps` — Renders HTML content sanitized with DOMPurify
- `globalModal` / `globalBigModal` — Standard modal wrappers
- `ToastProvider` — Toast notification system

**Live UI components** (`components/Liveui/`):
These are the real-time interaction components used during live quiz/quest sessions. Each question type has its own component:
- Quiz: `ChoiceComponent`, `MultipleChoiceComponent`, `TrueFalseComponent`, `FillInTheBlanksComponent`, `ShortAnswerComponent`
- Quest: `QuestChoiceComponent`, `QuestRankingComponent`, `QuestScalesChoiceComponent`, `QuestShortAnswerComponent`, `QuestContantComponent`
- Quick Form: `QuickFormPreview`, `QuickFromCreateorView`, `QuickFromAnswerView`
- Waiting rooms: `WatingRoomComponent` (Quest), `WatingRoomComponentQuiz`

### 5.9 Content Editor System

**Location**: `components/editor/`

A block-based content editor built on **Tiptap** (ProseMirror):

| Component | Purpose |
|-----------|---------|
| `ContentEditor.tsx` | Main editor orchestrator |
| `TemplateSelector.tsx` | Choose from layout templates |
| `TemplateCard.tsx` | Individual template card |
| `TextBlock.tsx` | Rich text block (Tiptap) |
| `ImageBlock.tsx` | Image upload/display block |
| `HeadingBlock.tsx` | Heading block |
| `TextImageBlock.tsx` | Side-by-side text + image |
| `ColumnsBlock.tsx` | Multi-column layout |
| `BlockControls.tsx` | Add/remove/reorder block controls |
| `ContentBlock.tsx` | Block type router |
| `slash-commands.tsx` | Slash command menu for Tiptap |

**Redux state** (`contentEditorSlice`): Tracks `contentBlocks[]`, `activeBlock`, `title`, `isEditing`. Supports add/update/delete/reorder/duplicate blocks, column management, image upload/remove.

**Templates** (`constants/templates.ts`): Predefined layouts — Image+Text, Text+Image, Two Columns, Three Columns, Image Gallery.

### 5.10 AI Features (OpenAI)

**Endpoint**: `app/api/generate-quiz/route.ts`

- Uses OpenAI GPT-4o model
- Generates quiz questions from PDF pages or text content
- Input: `selectedPages`, `topic`, `questionCount`, `questionType`, `difficulty`, `textData`, `audienceLevel`, `focusArea`
- Output: JSON array of quiz questions
- Requires `OPENAI_API_KEY` environment variable

---

## 6. Data Flow: End-to-End Walkthroughs

### 6.1 Quiz Creation → Live Hosting → Participation

```
CREATOR                              BACKEND                         PARTICIPANT
  │                                    │                                │
  ├─ POST /quizes/store ──────────────►│ Create Quiz + generate         │
  │    {title, visibility, ...}        │ join_link, join_code           │
  │◄── {quiz data} ───────────────────┤                                │
  │                                    │                                │
  ├─ POST /questions/store (×N) ──────►│ Create Questions               │
  │    {quiz_id, question_text, ...}   │                                │
  │                                    │                                │
  ├─ POST /quizes/host-live/{id} ────►│ Create QuizSession             │
  │    {title, timezone}               │ session_id = QUIZ-{id}-...     │
  │◄── {session, join_link, code} ────┤                                │
  │                                    │                                │
  ├─ socket.emit('createQuiz') ──────►│         [SOCKET SERVER]         │
  │                                    │                                │
  │                                    │◄── POST /quiz-attempts/join ──┤
  │                                    │    {join_code or join_link}    │
  │                                    │── {participant_id} ──────────►│
  │                                    │                                │
  │◄── socket: participantJoinedQuiz ──┤── socket: quizJoined ────────►│
  │                                    │                                │
  ├─ socket.emit('startQuiz') ───────►│                                │
  │                                    │── socket: quizStartedAll ────►│
  │                                    │                                │
  ├─ socket.emit('changeQuestion') ──►│                                │
  │                                    │── socket: questionChanged ───►│
  │                                    │                                │
  │                                    │◄── POST /record-answer ───────┤
  │◄── socket: answerSubmitted ────────┤── socket: answerProcessed ───►│
  │                                    │                                │
  ├─ POST /end-host-live/{id} ───────►│ End session                    │
  ├─ socket.emit('endQuiz') ─────────►│── socket: quizEndedAll ──────►│
```

### 6.2 Survey Creation → Publication → Response

```
CREATOR                              BACKEND                         RESPONDENT
  │                                    │                                │
  ├─ POST /surveys/store ────────────►│ Create Survey + default page   │
  │◄── {survey + page data} ─────────┤                                │
  │                                    │                                │
  ├─ POST /survey-pages/store (×N) ──►│ Additional pages               │
  ├─ POST /survey-questions/store ───►│ Questions per page             │
  │    (auto-saved every 800ms)        │                                │
  │                                    │                                │
  ├─ POST /surveys/update/{id} ──────►│ Set is_published=true          │
  │    {is_published: true}            │ (Survey now accessible)        │
  │                                    │                                │
  │                                    │◄── GET /surveys-check/{link} ─┤
  │                                    │── {survey data} ─────────────►│
  │                                    │                                │
  │                                    │◄── POST /survey-attempts/start┤
  │                                    │── {response_id, page_1} ─────►│
  │                                    │                                │
  │                                    │◄── POST /record-answer ───────┤
  │                                    │◄── POST /next-page ───────────┤
  │                                    │    (evaluates conditionals)    │
  │                                    │── {next_page + questions} ───►│
  │                                    │                                │
  │                                    │◄── POST /submit ──────────────┤
  │                                    │    (marks submitted_at)        │
```

### 6.3 Quest Creation → Live Hosting → Task Completion

```
CREATOR                              BACKEND                         PARTICIPANT
  │                                    │                                │
  ├─ POST /quests/store ─────────────►│ Create Quest                   │
  ├─ POST /quest-tasks/store (×N) ───►│ Create Tasks                   │
  │    (with dependencies if needed)   │ + task_dependencies            │
  │                                    │                                │
  ├─ POST /quests/host-live/{id} ────►│ Create QuestSession            │
  │◄── {session, join_link, code} ────┤                                │
  │                                    │                                │
  ├─ socket.emit('createQuest') ─────►│         [SOCKET SERVER]         │
  │                                    │                                │
  │                                    │◄── POST /quest-attempts/join ─┤
  │◄── socket: participantJoined ─────┤── socket: questJoined ────────►│
  │                                    │                                │
  ├─ socket.emit('startQuest') ──────►│── socket: questStartedAll ───►│
  │                                    │                                │
  │                                    │◄── POST /complete-task ────────┤
  │                                    │    (checks prerequisites if    │
  │                                    │     sequential_progression)    │
  │                                    │── {completion_data} ─────────►│
  │◄── socket: answerSubmitted ────────┤                                │
  │                                    │                                │
  │◄── socket: leaderboardUpdated ────┤── socket: leaderboard ────────►│
  │                                    │                                │
  ├─ POST /end-host-live/{id} ───────►│ End session                    │
  ├─ socket.emit('endQuest') ────────►│── socket: questEndedAll ──────►│
```

---

## 7. Entity Relationship Map

```
                            ┌─────────────┐
                            │    User      │
                            │  (users)     │
                            └──────┬───────┘
                                   │ creator/owner
              ┌────────────────────┼────────────────────┐
              │                    │                     │
       ┌──────▼──────┐     ┌──────▼──────┐      ┌──────▼──────┐
       │    Quiz     │     │   Survey    │      │   Quest     │
       │  (quizes)   │     │ (surveys)   │      │  (quests)   │
       └──────┬──────┘     └──────┬──────┘      └──────┬──────┘
              │                   │                     │
     ┌────────┤            ┌──────┤              ┌──────┤
     │        │            │      │              │      │
┌────▼───┐ ┌──▼────┐ ┌────▼──┐ ┌─▼────────┐ ┌──▼────┐ ┌──▼────────┐
│Question│ │Session│ │ Page  │ │ Response │ │ Task  │ │  Session  │
│        │ │       │ │       │ │          │ │       │ │           │
└────┬───┘ └──┬────┘ └──┬────┘ └──┬───────┘ └──┬───┘ └──┬────────┘
     │        │         │         │             │        │
     │   ┌────▼────┐    │    ┌────▼───┐    ┌───▼────┐ ┌─▼──────────┐
     │   │Particip.│    │    │Answer  │    │Depend. │ │Participant │
     │   │         │    │    │        │    │(M:N)   │ │            │
     │   └────┬────┘    │    └────────┘    └────────┘ └──┬─────────┘
     │        │         │                                │
     │   ┌────▼────┐    │                           ┌────▼────────┐
     └──►│ Answer  │    └──►┌──────────┐            │Task         │
         │         │        │ Question │            │Completion   │
         └─────────┘        └──────────┘            └─────────────┘

                    ┌─────────────────────────┐
                    │   Question/Task Banks    │
                    │  (per-module, reusable)  │
                    │                          │
                    │  Categories (hierarchical│
                    │  with parent/child)      │
                    │  └── Bank Items          │
                    └─────────────────────────┘
```

---

## 8. API Response Contract

All backend responses use `ApiResponseTrait`. The standard shape:

**Success** (200/201):
```json
{
  "status": true,
  "message": "Quiz created successfully",
  "data": { ... }
}
```

**Error** (4xx/5xx):
```json
{
  "status": false,
  "message": "Validation failed",
  "data": {
    "title": ["The title field is required."],
    "email": ["The email has already been taken."]
  }
}
```

**Available response methods** in `ApiResponseTrait`:
| Method | HTTP Code | When Used |
|--------|-----------|-----------|
| `successResponse()` | 200 | Generic success |
| `okResponse()` | 200 | OK with data |
| `createdResponse()` | 201 | Resource created |
| `noContentResponse()` | 204 | Delete success |
| `badRequestResponse()` | 400 | Client error |
| `unauthorizedResponse()` | 401 | Not authenticated |
| `forbiddenResponse()` | 403 | Not authorized (ownership) |
| `notFoundResponse()` | 404 | Resource not found |
| `unprocessableResponse()` | 422 | Validation errors |
| `serverErrorResponse()` | 500 | Server error |

---

## 9. Naming Conventions & Patterns

### Backend (Laravel)

| Element | Convention | Example |
|---------|-----------|---------|
| Models | PascalCase, singular | `Quiz`, `QuestTask`, `SurveyQuestion` |
| Tables | snake_case, plural | `quizes` (note: not "quizzes"), `quest_tasks`, `survey_questions` |
| Controllers | PascalCase + Controller | `QuizController`, `QuestionBankCategoryController` |
| Form Requests | PascalCase + Request | `StoreRequest`, `HostLiveStoreRequest` |
| Migrations | Timestamped, snake_case | `2025_05_14_092507_create_quizes_table.php` |
| Routes | kebab-case paths | `/quizes/host-live/{id}`, `/quiz-attempts/record-answer` |
| API prefix | `/api/v1/` | Versioned |
| JSON fields | snake_case | `join_link`, `is_published`, `question_text` |
| Helpers | snake_case functions | `generate_quiz_join_link()` |

### Frontend (Next.js)

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase files | `QuestPlayComponent.tsx`, `GlobalPagination.tsx` |
| Pages | `page.tsx` in route dirs | `app/(protected)/quiz-creator/page.tsx` |
| Redux slices | camelCase + Slice | `authSlice.ts`, `quizSlice.ts` |
| Types | PascalCase | `QuizItem`, `SurveyPage`, `TaskType` |
| Hooks | use + PascalCase | `useDebounce`, `useSurveyAutoSave` |
| Utils | camelCase files | `axiosInstance.ts`, `quizUtils.ts` |
| Services | camelCase + Service | `questService.ts`, `surveyService.ts` |
| CSS | Tailwind utility classes | Custom colors: `text-primary`, `bg-secondary` |
| Path alias | `@/*` → `src/*` | `import { api } from '@/utils/axiosInstance'` |
| Route groups | parenthesized | `(auth)`, `(protected)`, `(public)` |

### Shared Patterns

1. **Module symmetry**: Quiz, Survey, and Quest follow identical patterns — CRUD controller, hosting, attempts, bank categories, bank items, sessions, participants, exports.

2. **JSON columns for flexibility**: `options`, `answer_data`, `task_data`, `completion_data`, `anonymous_details`, `display_conditions`, `progress_data` — all stored as JSON.

3. **Origin tracking**: When content is copied/duplicated, `origin_owner_id`, `origin_owner_name`, `origin_owner_profile_picture` are set on the copy.

4. **Soft deletes everywhere**: All main entities use soft deletes with `deleted_by` tracking.

5. **Join mechanics**: Every hostable entity gets a `join_link` (alphanumeric segments) and `join_code` (6-digit number).

---

## 10. Known Quirks & Technical Debt

| Item | Description | Impact |
|------|-------------|--------|
| `quizes` table name | Misspelled (should be `quizzes`). This is used consistently everywhere — model, migrations, routes. | Low — just cosmetic, but be aware when writing raw SQL or new migrations. |
| `WatingRoom` typo | Components named `WatingRoomComponent` (missing "i"). | Low — cosmetic. |
| `QuickFrom` typos | Several files use "From" instead of "Form": `QuickFromTransform.ts`, `QuickFromAnswerView.tsx`, `QuickFromCreateorView.tsx`. | Low — cosmetic. |
| `ledaerboard` typo | File `ledaerboardAnswersSlice.ts` has a typo. | Low — cosmetic. |
| Duplicate `QuickFormPreview` | Both `QuickFormPreview.tsx` and `QuickFormPreview copy.tsx` exist. | Medium — dead code, should remove the copy. |
| Survey uses `Quiz` type | `surveyInformationSlice.ts` types its state as `Quiz | null` instead of a Survey-specific type. | Medium — works because shapes overlap, but can cause confusion. |
| `questInformation` uses `Quiz` type | Same issue — quest metadata slice typed as `Quiz`. | Medium — same concern. |
| Zone.Identifier files | Windows → WSL file transfer left `.Zone.Identifier` companion files everywhere. | Low — should be gitignored and cleaned up. |
| Legacy realtime removed | Live quiz/quest flows now use Laravel Reverb from the backend instead of an external websocket service. | Medium — continue load testing Reverb/Redis before production. |
| No Docker setup | No `docker-compose.yml` despite README references. | Medium — manual setup required. |
| Quiz service sparse | `quizService.ts` is mostly empty — quiz API calls are scattered across components and Redux thunks. Survey service is comprehensive by comparison. | Medium — inconsistent patterns. |
| Multiple charting libraries | ApexCharts, Recharts, Highcharts, and D3 are all used. | Medium — bundle size, inconsistent chart styles. |
| Two DnD libraries | Both `@dnd-kit` and `@hello-pangea/dnd` are used. | Low — different use cases, but could be consolidated. |
| Both `moment` and `dayjs` | Two datetime libraries with overlapping functionality. | Low — pick one to reduce bundle. |

---

## 11. Environment & Configuration

### Backend `.env` Key Variables
| Variable | Purpose |
|----------|---------|
| `APP_KEY` | Laravel encryption key (auto-generated) |
| `APP_URL` | Backend URL (http://localhost:8000) |
| `FRONTEND_URL` | Frontend URL (http://localhost:2000 locally) |
| `CORS_ALLOWED_ORIGINS` | Browser origin allow-list for Laravel HTTP routes, including `/broadcasting/auth` |
| `SANCTUM_STATEFUL_DOMAINS` | Leave empty for bearer-token frontend auth; only set when implementing cookie-based Sanctum SPA auth |
| `DB_CONNECTION` | `sqlite` or `mysql` |
| `MAIL_MAILER` | `log` (dev) or `smtp` (prod) |
| `REVERB_ALLOWED_ORIGINS` | Browser origin allow-list for Reverb websocket clients (e.g. `http://localhost:2000,http://127.0.0.1:2000`) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth |
| `MICROSOFT_CLIENT_ID/SECRET` | Microsoft OAuth |
| `SUPER_ADMIN_EMAIL/PASSWORD` | Filament admin seeder |

### Frontend `.env` Key Variables
| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Points to backend API (http://localhost:8000/api/v1) |
| `NEXT_PUBLIC_REVERB_APP_KEY` | Laravel Reverb app key |
| `NEXT_PUBLIC_REVERB_HOST` | Reverb websocket host |
| `NEXT_PUBLIC_REVERB_PORT` | Reverb websocket port |
| `NEXT_PUBLIC_REVERB_SCHEME` | `http` locally, `https` in production |
| `APP_URL` | Frontend URL (http://localhost:2000) |
| `OPENAI_API_KEY` | For AI quiz generation |

### Config Files to Know
| File | Purpose |
|------|---------|
| `backend/config/auth.php` | Guards (web + api), providers, password resets |
| `backend/config/permission.php` | Spatie role/permission table names, cache TTL |
| `backend/config/filesystems.php` | Storage disks (local, public, s3) |
| `backend/config/services.php` | Third-party service credentials |
| `frontend/next.config.ts` | Image domains, webpack config, ESLint settings |
| `frontend/tailwind.config.ts` | Custom colors, spacing, shadows, animations, breakpoints |
| `frontend/tsconfig.json` | `@/*` path alias, strict mode, ES2017 target |

---

## 12. What Does NOT Exist Yet

These are gaps in the current codebase that future development will likely need to address:

| Area | Status | Notes |
|------|--------|-------|
| **Reverb Server** | Backend-managed | Run Laravel Reverb and Redis queue workers for live quiz/quest sessions. |
| **Database** | Not created | No `database.sqlite` or MySQL database exists yet. Run migrations after setup. |
| **Docker / Containerization** | Not set up | No `docker-compose.yml`. Needs manual environment setup (see SETUP_GUIDE.md). |
| **CI/CD Pipeline** | Not configured | No GitHub Actions, no deployment scripts. |
| **Automated Tests** | Minimal | Pest PHP test framework installed but few test files. No frontend tests. |
| **Survey Socket** | Not implemented | Quiz and Quest have socket managers. Surveys are form-based with no real-time component currently. |
| **Payment/Billing Backend** | Frontend only | Billing views exist in frontend (`views/web/billing/`) but no Stripe/payment backend integration. |
| **Pricing Plans Backend** | Frontend only | Plan comparison UI exists but no subscription/plan management API. |
| **Push Notifications** | Not implemented | No web push or in-app notification system. |
| **Rate Limiting** | Not configured | No API rate limiting beyond Laravel defaults. |
| **API Documentation** | Not generated | No Swagger/OpenAPI docs. This guide serves as the reference. |
| **Internationalization (i18n)** | Not implemented | App is English-only. `APP_LOCALE=en` set but no translation files. |
| **Search/Filtering (Frontend)** | Partial | Backend supports filtering, but frontend search/filter UIs may be incomplete. |
| **Survey Origin Tracking Migration** | Missing | Survey model references `origin_owner_*` fields but the migration may not exist. Verify before using. |
| **Git Repository** | Not initialized | The project directory is not a git repository yet. |

---

## Appendix: Quick Reference for Common Tasks

### Adding a New Question/Task Type

1. **Backend**: Add the type string to validation rules in the relevant `StoreRequest`
2. **Backend**: No schema change needed — `options`/`task_data` are JSON columns
3. **Frontend**: Add to `TaskType` enum in `types/liveTypes.ts`
4. **Frontend**: Create a new component in `components/Liveui/`
5. **Frontend**: Add the component to the type router in `QuestPlayComponent.tsx` or `QuizPlayComponent.tsx`
6. **Frontend**: Add chart handling in `utils/prepareChart.ts`

### Adding a New API Endpoint

1. Create/update the Controller method in `app/Http/Controllers/api/v1/{Module}/`
2. Create a FormRequest in `app/Http/Requests/{Module}/` if validation needed
3. Add the route in `routes/api/v1/{Module}/{resource}.php`
4. Frontend: Call via `axiosInstance` or add to the relevant service file
5. Add types for request/response in `types/`

### Adding a New Redux Slice

1. Create the slice in `stores/features/` or `stores/survey/`
2. Add to the store in `stores/store.ts`
3. If it needs persistence, add the key to the `persistConfig.whitelist` array

### Adding a New Migration

1. `php artisan make:migration create_{table}_table` — or place in the appropriate subdirectory (`database/migrations/Quiz/`, `Survey/`, or `Quest/`)
2. Migrations from subdirectories are auto-loaded via `AppServiceProvider`
3. Run `php artisan migrate`

### Adding a New Filament Resource

1. Create in `app/Filament/Resources/`
2. Auto-discovered by `AdminPanelProvider` (discovery enabled for `app/Filament/`)
3. Uses web guard — only accessible to Super Admin role
