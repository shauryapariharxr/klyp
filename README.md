# Klyp

<p align="center">
  <a href="https://klyp-woad.vercel.app">Live app</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#security">Security</a>
</p>

**Klyp** is anonymous, login-free file & text transfer, two ways:

1. **PIN transfers** — send files or text, get a **4-digit PIN**, share it anywhere; the receiver enters the PIN to open the transfer. Everything self-destructs after **15 minutes**.
2. **klyp Local** — same-Wi-Fi **peer-to-peer** transfer between devices in the same room. Files travel directly browser-to-browser over WebRTC and never touch the server or any storage.

```
PIN mode:   Send  →  Get PIN  →  Share PIN  →  Receive  →  Download  →  Gone after 15 min
Local mode: Join  →  See nearby devices  →  Tap one  →  Accept  →  Direct Wi-Fi transfer
```

## Features

- **No accounts, no emails** — nothing to sign up for, on either side
- **Files or text** — up to 10 files (25 MB each, 50 MB total) or a 10,000-character note
- **Browser-direct uploads** — file bytes go straight to object storage via presigned PUT URLs; they never pass through the server
- **4-digit PIN handoff** — the receiver types the PIN; a scoped access token unlocks the transfer
- **15-minute expiry** — enforced on every access, swept automatically
- **Private bucket** — downloads only happen through 10-minute signed URLs
- **klyp Local** — device-to-device transfer on the same Wi-Fi, with drag-and-drop on desktop, live progress (rate + ETA), and accept/decline prompts

## Stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router) + TypeScript |
| UI | Tailwind CSS 4, glassmorphism on a parallax starfield |
| Database | PostgreSQL ([Supabase](https://supabase.com)) via [Drizzle ORM](https://orm.drizzle.team) |
| Storage | Supabase Storage via its S3 gateway (any S3-compatible provider works: B2/R2/iDrive e2/Scaleway) |
| Peer-to-peer | WebRTC `RTCDataChannel` with database-backed signaling |
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

> If `npm run db:push` hangs on the Supabase transaction pooler, create the two klyp Local tables with `node scripts/apply-local-schema.js` instead (the PIN-transfer tables can also be created with `npm run db:generate` + your own SQL runner).

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

**Free storage in 2 minutes (default: Supabase Storage):** in your Supabase dashboard, Storage → New bucket → name it `klyp` and keep it **private**; then Storage → Settings → S3 connection info → copy the endpoint (`https://<project-ref>.storage.supabase.co/storage/v1/s3`) and region, click **Generate S3 access key**, and fill in `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`. Keep `S3_FORCE_PATH_STYLE=1`. Any other S3-compatible provider (Backblaze B2, iDrive e2, Scaleway…) works with the same variables — for those, run `node scripts/set-cors.js` once so browsers may use presigned URLs. Text-only transfers and klyp Local need no storage at all.

## How it works

### PIN transfers — sending

1. Pick up to 10 files or paste text.
2. `POST /api/transfer/create` stores the transfer, a peppered scrypt **hash** of the PIN (never the PIN), and an expiry 15 minutes out.
3. Files upload **directly from the browser to the bucket** using presigned PUT URLs from `POST /api/transfer/:id/upload` — this sidesteps serverless request-body limits.
4. `POST /api/transfer/:id/complete` verifies every object exists in the bucket, saves file metadata, and marks the transfer ready.

### PIN transfers — receiving

1. Enter the PIN at `/receive` → `POST /api/transfer/verify` hashes it the same way and returns `{ transferId, accessToken }`.
2. `/transfer/:id?token=…` validates id + token, then shows text and files with a live countdown.
3. `GET /api/file/:id` mints a fresh 10-minute signed download URL per file.

### PIN transfers — expiry

- The 15-minute `expires_at` is checked on **every** access.
- `GET /api/cleanup` deletes expired transfers (storage objects first, then rows, including orphans from abandoned uploads). Vercel Cron calls it on a schedule via `vercel.json`; you can also trigger it manually:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cleanup
  ```

### klyp Local — same-Wi-Fi, zero cloud

- **Rooms by network.** Devices are grouped by a SHA-256 hash of their public IP (`lib/local.ts`), so only devices behind the same router ever see each other. Raw IPs are never stored.
- **Presence.** Joining at `/local` registers a device row with a random device token; each browser polls `POST /api/local/sync` every 2 s, which doubles as the heartbeat, peer list, and signal drain in one round trip. Devices vanish after 20 s without a heartbeat.
- **Signaling.** WebRTC offers/answers (with ICE candidates inlined — no trickle) flow through `POST /api/local/signal` as ≤64 KB JSON payloads queued per device in `local_signals`, drained and deleted atomically on the next poll.
- **The transfer itself is peer-to-peer.** File bytes are chunked (16 KB) over an `RTCDataChannel` with buffered-amount flow control — the server only ever sees signaling metadata. The receiver reassembles the blob and saves it locally.
- **Consent.** Every incoming transfer shows an accept/decline prompt; a busy receiver answers `busy` automatically.

## Security

### PIN transfers

- **PINs are never stored** — only scrypt hashes with a server-side pepper; comparison is timing-safe.
- **Failed-PIN lockout** — 5 wrong PINs per IP locks verification for 15 minutes, on top of general rate limits (create / verify / download / upload).
- **Security headers** — `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (see `next.config.ts`).
- **Input validation** — every endpoint validates via [zod](https://zod.dev); file names are sanitized, sizes and count enforced client- and server-side.
- **Private bucket** — all access goes through short-lived signed URLs.
- **No secrets in logs** — raw PINs and file contents are never logged.

### klyp Local

- **Room isolation** — the room key is a salted SHA-256 of the client IP; peer lists and signals never cross rooms, and signals to devices outside your room are rejected with an indistinguishable 404 (no device enumeration).
- **Capability tokens** — every sync/signal/leave call requires the random per-device token issued at join; wrong tokens get 404 and the client re-joins.
- **Bounded signaling** — payloads are capped at 64 KB, the request body is byte-capped, each recipient holds at most 100 queued signals, and each poll drains at most 50 — one chatty peer cannot bloat the database or a victim's poll response.
- **Rate limits on everything** — join 30/min, signal 120/min, sync 300/min, leave 60/min per IP, plus capped JSON bodies (4–128 KB) on all endpoints so no request can force the server to buffer an unbounded payload.
- **Presence pruning** — devices and undelivered signals are pruned automatically (10 min / 5 min TTLs), so abandoned sessions leave nothing behind.
- **Reproducible checks** — `node scripts/security-test.mjs` runs 29 runtime assertions (auth, isolation, injection, caps, rate limits, headers) against a running server and exits non-zero on any failure.

> The in-memory rate limiter is per serverless instance — fine for an MVP. For strict global limits, back it with Upstash Redis or similar.

## Project structure

```
app/
  page.tsx                        landing
  send/page.tsx                   upload + PIN generation
  receive/page.tsx                PIN entry
  transfer/[id]/page.tsx          view + download
  transfer/transfer-view.tsx      client view
  local/page.tsx                  klyp Local UI (join, peers, drag-drop, progress)
  expired/page.tsx                expiry notice
  api/transfer/create/route.ts
  api/transfer/verify/route.ts
  api/transfer/[id]/route.ts
  api/transfer/[id]/upload/route.ts
  api/transfer/[id]/complete/route.ts
  api/file/[id]/route.ts
  api/cleanup/route.ts
  api/health/route.ts             deployment diagnostic (booleans only)
  api/local/join/route.ts
  api/local/sync/route.ts
  api/local/signal/route.ts
  api/local/leave/route.ts
  components/                     Logo, PinInput, CopyButton, Countdown, GitHubButton
lib/
  db.ts            Drizzle client (postgres-js driver)
  storage.ts       S3 presign / download / delete helpers
  pin.ts           PIN generation + peppered scrypt hashing
  token.ts         access-token generation + timing-safe compare
  rate-limit.ts    in-memory limiter + failed-PIN attempts
  transfers.ts     shared transfer lookup/view logic
  cleanup.ts       expiry sweeper
  limits.ts        size/count/TTL constants + filename sanitizer
  http.ts          client IP + size-capped JSON body reader
  local.ts         rooms, device auth, signal queue (server side)
  local-engine.ts  WebRTC engine + signaling poller (browser side)
  format.ts        byte/time formatting helpers
db/schema.ts       transfers, files, local_devices, local_signals tables
scripts/           operational + test scripts (see below)
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL migration files |
| `npm run db:push` | Push schema straight to the database |
| `node scripts/apply-local-schema.js` | Create the two klyp Local tables via SQL (fallback when `db:push` hangs on the pooler) |
| `node scripts/set-cors.js` | One-time CORS setup for non-Supabase S3 providers |
| `bash scripts/e2e-test.sh [base-url]` | Full API smoke test: text + file round-trip, byte-for-byte |
| `node scripts/security-test.mjs` | 29 runtime security assertions (rooms, auth, caps, rate limits, headers) |
| `node scripts/verify-cleanup.js [base-url]` | Prove expired transfers are deleted from storage **and** the database |
| `node scripts/load-test.js [base-url]` | Load test: static pages, PIN verify churn, create-transfer |

All test scripts default to `http://localhost:3123`; pass a base URL to target another deployment. They need the env vars from `.env.local`.

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com](https://vercel.com).
2. Add the environment variables from `.env.example` (Production + Preview).
3. Deploy. The cron job in `vercel.json` registers automatically (Hobby: once/day; to sweep more often, upgrade or hit the cleanup endpoint externally).
4. Open `/api/health` after deploying — it reports (booleans only) whether the deployment can see each required env var.

---

Built by [shauryapariharxr](https://github.com/shauryapariharxr).
