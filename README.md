# Klyp

Anonymous, login-free file & text transfer. Send files or text, get a **4-digit PIN**, share it — the receiver enters the PIN to download. Everything self-destructs after **30 minutes**.

**Flow:** Send → Get PIN → Share PIN → Receive → Download → Expire

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **PostgreSQL** on [Neon](https://neon.tech) via **Drizzle ORM**
- **Cloudflare R2** for private file storage with short-lived signed URLs
- Deployed on **Vercel** — no authentication anywhere

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run db:push              # create the tables
npm run dev                  # http://localhost:3000
```

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres connection string (use the **pooled** connection string) |
| `S3_ENDPOINT` | for files | S3-compatible endpoint URL (see below — Backblaze B2 is free) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | for files | S3-compatible access key pair |
| `S3_BUCKET` | for files | Private bucket name |
| `S3_REGION` / `S3_FORCE_PATH_STYLE` | optional | Provider-specific S3 settings |
| `R2_ACCOUNT_ID` (legacy) | for files | Cloudflare account ID — still works, endpoint derived from it |
| `PIN_HASH_PEPPER` | recommended | Server-side secret mixed into PIN hashes |
| `CRON_SECRET` | optional | Bearer secret for `/api/cleanup` |

**Storage setup — no Cloudflare subscription needed:** the app speaks plain S3, so any S3-compatible provider works. The easiest **completely free** option is [Backblaze B2](https://www.backblaze.com/sign-up/cloud-storage) — 10 GB storage + 1 GB/day egress free, **no credit card required**:

1. Sign up, create a **private** bucket (e.g. `klyp`), note the region (e.g. `us-west-004`).
2. App Keys → Add a New Application Key scoped to that bucket with Read & Write.
3. Set `S3_ENDPOINT=https://s3.<region>.backblazeb2.com` plus the key ID/secret and bucket name.

Keep the bucket private — downloads only happen through 10-minute signed URLs.

Also works (free tiers vary): Filebase (5 GB, no card), iDrive e2 (10 GB), Scaleway (75 GB, card required), or Cloudflare R2 via the legacy `R2_*` variables. Text-only transfers need no storage at all.

## Testing

With the server running (`npm start` or `npm run dev`), run the API smoke test:

```bash
bash scripts/e2e-test.sh http://localhost:3000   # or your port
```

It creates a text transfer, verifies the PIN flow, then does a full file round-trip: presigned PUT directly to the bucket → complete → verify → signed download → byte-for-byte comparison.

## How it works

### Sending

1. Pick up to 10 files (50 MB each, 100 MB total) or paste text.
2. `POST /api/transfer/create` stores the transfer, a peppered scrypt **hash** of the PIN (never the PIN), and an expiry 30 minutes out. Raw file bytes never pass through the server.
3. Files upload **directly from the browser to the bucket** using presigned PUT URLs from `POST /api/transfer/:id/upload` — this avoids serverless request-body limits on large files.
4. `POST /api/transfer/:id/complete` verifies every object exists in the bucket, saves file metadata, and marks the transfer ready.

### Receiving

1. Enter the PIN at `/receive` → `POST /api/transfer/verify` hashes it the same way, finds the transfer, and returns `{ transferId, accessToken }`.
2. `/transfer/:id?token=…` validates id + access token, then shows text and files with a live countdown.
3. `GET /api/file/:id` mints a fresh 10-minute signed download URL per file.

### Expiry

- The 30-minute `expires_at` is checked on every access.
- `GET /api/cleanup` deletes expired transfers: R2 objects first, then rows. Vercel Cron calls it every 5 minutes (see `vercel.json`); you can also `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cleanup`.

### Security

- PINs are stored only as scrypt hashes with a server-side pepper; verification is timing-safe.
- Rate limiting on create / verify / download / upload endpoints, plus a **failed-PIN attempt limit (5 per 15 min per IP)**.
- File names are sanitized; sizes and count are validated client- and server-side.
- Bucket stays private; all access goes through short-lived signed URLs.
- Raw PINs and file contents are never logged.

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
lib/
  db.ts        Drizzle client (Neon serverless driver)
  r2.ts        R2 upload/download/delete helpers
  pin.ts       PIN generation + peppered scrypt hashing
  rate-limit.ts in-memory limiter + failed attempts
  transfers.ts shared transfer lookup/view logic
  cleanup.ts   expiry sweeper
db/schema.ts   transfers + files tables
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL migration files |
| `npm run db:push` | Push schema straight to the database |

## Deploying to Vercel

1. Push to GitHub and import the repo at vercel.com.
2. Add the environment variables from `.env.example` (Production + Preview).
3. Deploy. The cron job in `vercel.json` registers automatically on Hobby plans (once per day at 09:00 UTC). To sweep every 5 minutes, upgrade to Pro or run the cleanup endpoint externally.
"# klyp" 
