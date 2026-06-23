<div align="center">

# 🤖 ReviewAI

**AI-powered code reviews that post inline comments on your GitHub pull requests — automatically.**

[![Next.js](https://img.shields.io/badge/Next.js_14-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Neon](https://img.shields.io/badge/Neon_Postgres-00E599?logo=postgresql&logoColor=white)](https://neon.tech/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

[Features](#-features) · [Architecture](#-architecture) · [How It Works](#-how-it-works) · [Tech Stack](#-tech-stack) · [Getting Started](#-getting-started) · [Project Structure](#-project-structure)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| **🔄 Automatic PR Reviews** | Triggers on every `pull_request.opened` and `pull_request.synchronize` event — zero manual intervention |
| **📝 Inline Comments** | Posts review comments directly on the correct diff lines in GitHub, not just a generic PR comment |
| **🎯 Diff-Aware Positioning** | Parses unified diff hunks to build a `(file, line) → GitHub diff position` map, eliminating 422 "position not resolved" errors |
| **🧠 LLM-Powered Analysis** | Uses Groq's Llama 3.3 70B model to analyze code for security vulnerabilities, logic bugs, unhandled errors, and performance issues |
| **📊 Quality Scoring** | Every PR gets a 0–100 code quality score with severity-tagged comments (🔴 Critical, 🟡 Warning, 🔵 Suggestion) |
| **🔐 GitHub App Auth** | Full GitHub App integration with installation-level auth, HMAC webhook signature verification, and OAuth login |
| **📈 Dashboard** | Real-time dashboard showing review history, metrics, score trends, and connected repositories |
| **🗄️ Persistent History** | All reviews, scores, and comments stored in Neon Postgres via Prisma ORM for historical tracking |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB                                         │
│                                                                              │
│   Developer opens PR ──► GitHub sends webhook ──► X-Hub-Signature-256       │
│                                                                              │
│   ◄── ReviewAI posts inline comments + summary via GitHub App API ◄──       │
└──────────────────────────┬───────────────────────────────────┬───────────────┘
                           │ webhook POST                      ▲ review POST
                           ▼                                   │
┌──────────────────────────────────────────────────────────────────────────────┐
│                          REVIEWAI (Next.js 14)                               │
│                                                                              │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐  │
│  │  Webhook Handler    │  │  Review Processor     │  │  Dashboard UI      │  │
│  │  /api/github/webhook│  │  reviewProcessor.ts   │  │  Server Components │  │
│  │                     │  │                       │  │                    │  │
│  │  • HMAC verify      │  │  1. Fetch PR files    │  │  • Auth (NextAuth) │  │
│  │  • Route by event:  │  │  2. Build annotated   │  │  • Reviews list    │  │
│  │    - installation   │──▶     diff + position   │  │  • Review detail   │  │
│  │    - install_repos  │  │     map               │  │  • Repositories    │  │
│  │    - pull_request   │  │  3. Call LLM (Groq)   │  │  • Settings        │  │
│  │  • Auto-register    │  │  4. Parse JSON        │  │  • Metrics cards   │  │
│  │    repositories     │  │  5. Map line → pos    │  │                    │  │
│  └─────────────────────┘  │  6. Save to DB        │  └────────────────────┘  │
│                           │  7. Post to GitHub    │                          │
│                           └──────────────────────┘                           │
│                                     │                        ▲               │
│                                     ▼                        │               │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                        Prisma ORM                                    │    │
│  │   User ◄──┐                                                          │    │
│  │           │ 1:N                                                      │    │
│  │   Repository ◄──┐                                                    │    │
│  │                  │ 1:N                                                │    │
│  │   Review ◄──┐                                                        │    │
│  │             │ 1:N                                                     │    │
│  │   ReviewComment (severity: CRITICAL | WARNING | SUGGESTION)          │    │
│  └──────────────────────────┬───────────────────────────────────────────┘    │
│                              │                                               │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐      ┌─────────────────────┐
                    │   Neon Postgres     │      │   Groq API          │
                    │   (Serverless DB)    │      │   Llama 3.3 70B     │
                    │   + pgBouncer pool  │      │   (Code Analysis)   │
                    └─────────────────────┘      └─────────────────────┘
```

---

## ⚙ How It Works

### The AI Review Pipeline

```
                    ┌─────────────────────────────────────────────────────┐
                    │              PR OPENED / UPDATED                     │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  1. FETCH PR FILES                                   │
                    │     • octokit.pulls.listFiles()                      │
                    │     • Filter: no lockfiles, no binaries, no .min.js  │
                    │     • Cap: 12,000 chars total patch length           │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  2. BUILD POSITION MAP + ANNOTATED DIFF              │
                    │                                                       │
                    │     Parse each file's unified diff patch:            │
                    │     @@ -10,5 +10,7 @@                               │
                    │        10:  import { Octokit } from "@octokit/rest"; │
                    │        11:  import { createAppAuth } from "...";     │
                    │       +12:  import { foo } from "bar";               │
                    │                                                       │
                    │     Build: Map<filename, Map<line, diffPosition>>    │
                    │     Example: ("github.ts", 12) → position 4         │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  3. LLM ANALYSIS (Groq — Llama 3.3 70B)             │
                    │                                                       │
                    │     System prompt tells the LLM:                     │
                    │     "The number before the colon is the exact file   │
                    │      line number you MUST use. Do NOT invent lines." │
                    │                                                       │
                    │     Returns: { summary, score, comments[] }          │
                    │     Each comment: { path, line, severity, comment }  │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  4. MAP LINE → GITHUB DIFF POSITION                  │
                    │                                                       │
                    │     For each LLM comment:                            │
                    │       positionMap.get("src/file.ts").get(42) → 7     │
                    │                                                       │
                    │     ✅ Resolved → inline review comment              │
                    │     ❌ Unresolved → fallback to PR body text         │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  5. POST TO GITHUB + SAVE TO DB                      │
                    │                                                       │
                    │     • octokit.pulls.createReview() with correct      │
                    │       position values — no more 422 errors           │
                    │     • prisma.review.create() with nested comments    │
                    │     • Dashboard updates in real-time                  │
                    └─────────────────────────────────────────────────────┘
```

### Diff Position Mapping — The Key Innovation

Most AI code review tools fail when posting inline comments because GitHub's API requires a **diff position** (1-indexed offset within the patch), not an absolute file line number. ReviewAI solves this with a three-step approach:

1. **Annotated Diffs** — Each diff line is prefixed with its real file line number before being sent to the LLM, so the model can only reference lines that actually exist in the diff
2. **Position Map** — `parsePatchPositions()` walks each unified diff patch and builds `Map<newSideLine, diffPosition>`, correctly handling hunk headers, additions, deletions, and context lines
3. **Resolution** — Before posting to GitHub, every LLM comment is resolved through the map. Unresolvable comments gracefully fall back to the review body text

---

## 🔧 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 14 (App Router) | Full-stack React with server components, API routes, server actions |
| **Language** | TypeScript | End-to-end type safety |
| **Database** | Neon Postgres + Prisma ORM | Serverless PostgreSQL with connection pooling, type-safe queries |
| **Auth** | NextAuth v4 (GitHub OAuth) | JWT sessions, GitHub OAuth with `read:user` and `repo` scopes |
| **GitHub** | @octokit/rest + @octokit/auth-app | GitHub App installation auth, webhook handling, PR review API |
| **AI/LLM** | Groq API (Llama 3.3 70B) | Fast inference for code analysis (~2s per review) |
| **Styling** | Tailwind CSS | Utility-first CSS with a custom minimal design system |
| **Deployment** | Vercel | Serverless functions with 60s timeout for review processing |

---

## 🗃 Database Schema

```
┌──────────────┐       ┌──────────────────┐       ┌────────────────┐       ┌──────────────────┐
│    User       │ 1───N │   Repository     │ 1───N │    Review      │ 1───N │  ReviewComment   │
├──────────────┤       ├──────────────────┤       ├────────────────┤       ├──────────────────┤
│ id (cuid)    │       │ id (cuid)        │       │ id (cuid)      │       │ id (cuid)        │
│ githubId ◄UK │       │ userId (FK)      │       │ repoId (FK)    │       │ reviewId (FK)    │
│ login        │       │ repoFullName     │       │ prNumber       │       │ filePath         │
│ avatarUrl    │       │ installationId   │       │ prTitle        │       │ lineNumber       │
│ accessToken  │       │ active           │       │ prUrl          │       │ severity (enum)  │
│ createdAt    │       │ createdAt        │       │ summary        │       │ comment (text)   │
└──────────────┘       │                  │       │ score (0-100)  │       │ createdAt        │
                       │ ◄UK(userId,      │       │ rawResponse    │       └──────────────────┘
                       │    repoFullName) │       │ createdAt      │
                       └──────────────────┘       └────────────────┘

                       Severity enum: CRITICAL | WARNING | SUGGESTION
```

---

## 📁 Project Structure

```
reviewai/
├── prisma/
│   └── schema.prisma                          # Database schema (4 models + enum)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts    # NextAuth GitHub OAuth endpoint
│   │   │   └── github/webhook/route.ts        # Webhook handler (388 lines)
│   │   │       ├── HMAC signature verification
│   │   │       ├── installation.created → register repos
│   │   │       ├── installation_repositories → add/remove repos
│   │   │       └── pull_request → auto-register + processReview()
│   │   ├── (auth)/
│   │   │   └── login/page.tsx                 # GitHub OAuth login page
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                     # Sidebar + session guard
│   │   │   ├── SidebarNav.tsx                 # Client-side nav with active states
│   │   │   ├── dashboard/page.tsx             # Metrics, recent reviews, repos
│   │   │   ├── reviews/
│   │   │   │   ├── page.tsx                   # All reviews list with filters
│   │   │   │   └── [id]/page.tsx              # Review detail with inline comments
│   │   │   ├── repositories/
│   │   │   │   ├── page.tsx                   # Connected repos + toggle active
│   │   │   │   └── ToggleSwitch.tsx           # Server action toggle component
│   │   │   └── settings/page.tsx              # Account info + sign out
│   │   ├── layout.tsx                         # Root layout (Inter font, metadata)
│   │   └── globals.css                        # Tailwind imports
│   ├── lib/
│   │   ├── auth.ts                            # NextAuth config + session types
│   │   ├── github.ts                          # Octokit helpers + diff position mapping
│   │   │   ├── getPRFiles()                   # Fetch & filter PR changed files
│   │   │   ├── parsePatchPositions()          # Parse patch → line:position map
│   │   │   ├── buildDiffPositionMap()         # Full map for all files
│   │   │   ├── buildAnnotatedDiff()           # Line-numbered diff for LLM
│   │   │   └── postReviewComments()           # Post with resolved positions
│   │   ├── grok.ts                            # Groq API client (Llama 3.3 70B)
│   │   ├── prisma.ts                          # Singleton Prisma client
│   │   ├── reviewProcessor.ts                 # Full AI review pipeline orchestrator
│   │   └── utils.ts                           # relativeTime(), getInitials()
│   └── types/
│       └── review.ts                          # Webhook payload TypeScript interfaces
├── .env.example                               # Required environment variables
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) Postgres database (free tier works)
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with the permissions below
- A [Groq API key](https://console.groq.com) (free tier: 30 req/min)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/reviewai.git
cd reviewai
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon pooled connection string (`?pgbouncer=true&connect_timeout=30`) |
| `DIRECT_URL` | Neon direct (non-pooled) connection for Prisma migrations |
| `NEXTAUTH_SECRET` | Random JWT secret — generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` for local, your domain for production |
| `GITHUB_CLIENT_ID` | From your GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | From your GitHub OAuth App |
| `GITHUB_WEBHOOK_SECRET` | The secret you set when creating the GitHub App |
| `GITHUB_APP_ID` | Your GitHub App's numeric ID |
| `GITHUB_PRIVATE_KEY` | Base64-encoded PEM private key from the GitHub App |
| `GROQ_API_KEY` | Your Groq API key from [console.groq.com](https://console.groq.com) |

### 3. Database Setup

```bash
npx prisma generate
npx prisma db push
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — sign in with GitHub.

---

## 🔑 GitHub App Setup

### Create the App

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.

| Setting | Value |
|---|---|
| **Homepage URL** | `http://localhost:3000` |
| **Callback URL** | `http://localhost:3000/api/auth/callback/github` |
| **Webhook URL** | Your public URL + `/api/github/webhook` |
| **Webhook secret** | A strong random string → `GITHUB_WEBHOOK_SECRET` |

### Required Permissions

| Permission | Access | Why |
|---|---|---|
| **Contents** | Read-only | Read file contents for diff analysis |
| **Metadata** | Read-only | Required by GitHub for all apps |
| **Pull requests** | Read & write | Read PR diffs, post review comments |
| **Issues** | Read & write | Post fallback comments as issue comments |

### Subscribe to Events

- ✅ **Pull request** — triggers the review pipeline
- ✅ **Installation** — auto-registers repositories (optional but recommended)

### After Creation

1. Copy the **App ID** → `GITHUB_APP_ID`
2. Generate a **Private key** → base64-encode it:
   ```bash
   # Linux
   cat your-app.pem | base64 -w 0

   # macOS
   cat your-app.pem | base64

   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("your-app.pem"))
   ```
3. Note the **Client ID** and **Client Secret** from the OAuth section

### Local Webhook Development

GitHub can't reach `localhost`, so use [smee.io](https://smee.io) to proxy:

```bash
npm install -g smee-client
smee -u https://smee.io/YOUR_CHANNEL_ID -t http://localhost:3000/api/github/webhook
```

Set the **Webhook URL** in your GitHub App settings to your smee.io channel URL.

---

## 🖥 Dashboard Pages

| Page | Route | Description |
|---|---|---|
| **Dashboard** | `/dashboard` | Metrics cards (PRs reviewed, issues found, avg score, review time), recent reviews table, connected repos |
| **Reviews** | `/reviews` | Full review history with PR title, repo, severity badges, scores, and timestamps |
| **Review Detail** | `/reviews/[id]` | Deep dive into a single review — summary, score, and all comments grouped by file with severity indicators |
| **Repositories** | `/repositories` | Connected repos with toggle switches (active/inactive), PR count, and GitHub App install link |
| **Settings** | `/settings` | Account info (name, email, plan) and sign out |

---

## 🔒 Security

- **HMAC-SHA256 webhook verification** — every incoming webhook is verified against `GITHUB_WEBHOOK_SECRET` using timing-safe comparison
- **GitHub App installation auth** — per-repository tokens scoped to only the installed repos, not personal access tokens
- **JWT sessions** — NextAuth uses signed JWTs with `NEXTAUTH_SECRET`, no session database required
- **Server components** — all data fetching happens server-side; no API keys or tokens are exposed to the browser
- **Neon connection pooling** — pgBouncer with `connect_timeout=30` handles serverless cold starts gracefully

---

## 📝 Example Review Output

When ReviewAI processes a pull request, it posts a review that looks like this on GitHub:

```
## 🤖 ReviewAI Summary

This PR adds a new user authentication flow. The implementation is solid overall
but has a potential SQL injection vulnerability in the query builder and a missing
null check on the session object.

**Code quality score: 72/100**
```

With inline comments placed directly on the relevant diff lines:

```
🔴 CRITICAL: The `userInput` variable is interpolated directly into the SQL query
string without parameterization. Use prisma's parameterized queries instead:
`prisma.$queryRaw\`SELECT * FROM users WHERE id = ${userId}\``

🟡 WARNING: `session.user` could be null here. Add a null check before accessing
`session.user.id` to prevent a runtime TypeError.

🔵 SUGGESTION: Consider extracting this repeated validation logic into a shared
`validateInput()` utility function to reduce duplication across handlers.
```

---

## 🛣 Roadmap

- [x] GitHub App with webhook signature verification
- [x] OAuth login with NextAuth + Prisma user persistence
- [x] Full AI review pipeline (fetch diff → LLM analysis → store → post)
- [x] Diff-aware position mapping for accurate inline comments
- [x] Installation event handling for automatic repo registration
- [x] Dashboard with metrics, review history, and repo management
- [x] Review detail page with file-grouped, severity-tagged comments
- [ ] Custom review rules per repository (e.g., "focus on security", "check for TypeScript strict mode")
- [ ] Webhook retry queue (Upstash QStash) for Vercel free tier
- [ ] Multi-model support (GPT-4, Claude, Gemini)
- [ ] Team/organization support with shared dashboards
- [ ] PR comment threading — reply to reviewer feedback
- [ ] GitHub Checks API integration for pass/fail status

---

## 📄 License

MIT

---

<div align="center">

Built with Next.js, TypeScript, and Prisma · AI-powered by Groq

</div>
