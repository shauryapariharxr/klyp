# Klyp

<p align="center">
  <a href="https://klyp-woad.vercel.app">Live app</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#security">Security</a>
</p>

**Klyp** is anonymous, login-free file & text transfer. Send files or text, get a **4-digit PIN**, share it — the receiver enters the PIN to open the transfer. Everything self-destructs after **30 minutes**.

```
Send  →  Get PIN  →  Share PIN  →  Receive  →  Download  →  Gone
```

## Features

- **No accounts, no emails** — nothing to sign up for, on either side
- **Files or text** — up to 10 files (50 MB each, 100 MB total) or a 10,000-character note
- **Browser-direct uploads** — file bytes go straight to object storage via presigned PUT URLs; they never pass through the server
- **4-digit PIN handoff** — the receiver types the PIN; a scoped access token unlocks the transfer
- **30-minute expiry** — enforced on every access, swept automatically
- **Private bucket** — downloads only happen through 10-minute signed URLs

## Stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router) + TypeScript |
| UI | Tailwind CSS 4, glassmorphism on a parallax starfield |
| Database | PostgreSQL ([Supabase](https://supabase.com)) via [Drizzle ORM](https://orm.drizzle.team) |
| Storage | Any S3-compatible provider (developed on iDrive e2; B2/R2/Filebase/Scaleway all work) |
| Hosting | Vercel |

## Quick start

```bash
git clone https://github.com/shauryapariharxr/klyp.git
cd klyp
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run db:push              # create the tables
npm run dev                  # http://localhost:3000
```

### Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (Supabase: use the **transaction pooler**, port 6543) |
| `S3_ENDPOINT` | for files | S3-compatible endpoint URL |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | for files | S3 access key pair |
| `S3_BUCKET` | for files | **Private** bucket name |
| `S3_REGION` / `S3_FORCE_PATH_STYLE` | optional | Provider-specific S3 settings |
| `R2_ACCOUNT_ID` (legacy) | for files | Cloudflare account ID — endpoint is derived from it |
| `PIN_HASH_PEPPER` | yes (prod) | Server-side secret mixed into PIN hashes — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | optional | Bearer secret for `/api/cleanup` |

**Free storage in 3 minutes:** create a private [Backblaze B2](https://www.backblaze.com/sign-up/cloud-storage) bucket (10 GB + 1 GB/day egress free, no card), add an Application Key scoped to it, and point `S3_ENDPOINT` at `https://s3.<region>.backblazeb2.com`. Text-only transfers need no storage at all.

## How it works

### Sending

1. Pick up to 10 files or paste text.
2. `POST /api/transfer/create` stores the transfer, a peppered scrypt **hash** of the PIN (never the PIN), and an expiry 30 minutes out.
3. Files upload **directly from the browser to the bucket** using presigned PUT URLs from `POST /api/transfer/:id/upload` — this sidesteps serverless request-body limits.
4. `POST /api/transfer/:id/complete` verifies every object exists in the bucket, saves file metadata, and marks the transfer ready.

### Receiving

1. Enter the PIN at `/receive` → `POST /api/transfer/verify` hashes it the same way and returns `{ transferId, accessToken }`.
2. `/transfer/:id?token=…` validates id + token, then shows text and files with a live countdown.
3. `GET /api/file/:id` mints a fresh 10-minute signed download URL per file.

### Expiry

- The 30-minute `expires_at` is checked on **every** access.
- `GET /api/cleanup` deletes expired transfers (storage objects first, then rows). Vercel Cron calls it on a schedule via `vercel.json`; you can also trigger it manually:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cleanup
  ```

## Security

- **PINs are never stored** — only scrypt hashes with a server-side pepper; comparison is timing-safe.
- **Failed-PIN lockout** — 5 wrong PINs per IP locks verification for 15 minutes, on top of general rate limits (create / verify / download / upload).
- **Security headers** — `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (see `next.config.ts`).
- **Input validation** — every endpoint validates via [zod](https://zod.dev); file names are sanitized, sizes and count enforced client- and server-side.
- **Private bucket** — all access goes through short-lived signed URLs.
- **No secrets in logs** — raw PINs and file contents are never logged.

> The in-memory rate limiter is per serverless instance — fine for an MVP. For strict global limits, back it with Upstash Redis or similar.

## Project structure

```
app/
  page.tsx                     landing
  send/page.tsx                upload + PIN generation
  receive/page.tsx             PIN entry
  transfer/[id]/page.tsx       view + download
  transfer/transfer-view.tsx   client view
  expired/page.tsx             expiry notice
  api/transfer/create/route.ts
  api/transfer/verify/route.ts
  api/transfer/[id]/route.ts
  api/transfer/[id]/upload/route.ts
  api/transfer/[id]/complete/route.ts
  api/file/[id]/route.ts
  api/cleanup/route.ts
  components/                  Logo, PinInput, CopyButton, GitHubButton
lib/
  db.ts          Drizzle client (postgres-js driver)
  storage.ts     S3 presign / download / delete helpers
  pin.ts         PIN generation + peppered scrypt hashing
  token.ts       access-token generation + timing-safe compare
  rate-limit.ts  in-memory limiter + failed-PIN attempts
  transfers.ts   shared transfer lookup/view logic
  cleanup.ts     expiry sweeper
  limits.ts      size/count/TTL constants + filename sanitizer
db/schema.ts     transfers + files tables
scripts/         e2e-test.sh, load-test.js, set-cors.js
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL migration files |
| `npm run db:push` | Push schema straight to the database |
| `bash scripts/e2e-test.sh <base-url>` | Full API smoke test: text + file round-trip, byte-for-byte |
| `node scripts/load-test.js <base-url>` | Load test: static pages, PIN verify churn, create-transfer |

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com](https://vercel.com).
2. Add the environment variables from `.env.example` (Production + Preview).
3. Deploy. The cron job in `vercel.json` registers automatically (Hobby: once/day; to sweep more often, upgrade or hit the cleanup endpoint externally).

---

Built by [shauryapariharxr](https://github.com/shauryapariharxr).
