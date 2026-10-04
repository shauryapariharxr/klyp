/**
 * Runtime security test suite for klyp's API surface.
 * Usage: node scripts/security-test.mjs   (server must be running; KLYP_BASE to override)
 *
 * Covers: room isolation, cross-room signal injection, recipient validation,
 * signal backlog + drain caps, credential checks, input validation, request
 * body caps, rate limits, leave semantics, and security headers.
 */
const BASE = process.env.KLYP_BASE ?? "http://localhost:3123";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(path, body, ip, rawBody = null) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: rawBody ?? JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const join = (name, ip) => post("/api/local/join", { name }, ip);
const sync = (creds, ip, afterSeq = 0) =>
  post(
    "/api/local/sync",
    { deviceId: creds.deviceId, deviceToken: creds.deviceToken, afterSeq },
    ip,
  );
const signal = (creds, toDeviceId, payload, ip) =>
  post(
    "/api/local/signal",
    { deviceId: creds.deviceId, deviceToken: creds.deviceToken, toDeviceId, payload },
    ip,
  );
const leave = (creds, ip) =>
  post("/api/local/leave", { deviceId: creds.deviceId, deviceToken: creds.deviceToken }, ip);

const uuid = () => crypto.randomUUID();

console.log(`Security test suite → ${BASE}\n`);

// --- 1. Join + credentials -------------------------------------------------
const A = await join("RoomA-Sender", "203.0.113.10");
const A2 = await join("RoomA-Second", "203.0.113.10");
const B = await join("RoomB-Outsider", "198.51.100.20");

check("join returns 201 with deviceId+deviceToken",
  A.status === 201 && A.data?.deviceId && A.data?.deviceToken);
check("join returns 201 for second device", A2.status === 201 && B.status === 201);
check("join rejects missing name", (await join("", "203.0.113.10")).status === 400);
check("join rejects name over 24 chars", (await join("x".repeat(25), "203.0.113.10")).status === 400);

// --- 2. Room isolation -----------------------------------------------------
const syncA = await sync(A.data, "203.0.113.10");
const syncB = await sync(B.data, "198.51.100.20");
check("A sees only its room's second device",
  syncA.status === 200 &&
    syncA.data?.peers?.length === 1 &&
    syncA.data.peers[0].name === "RoomA-Second",
  JSON.stringify(syncA.data?.peers));
check("B (other network) sees nobody", syncB.data?.peers?.length === 0);

// --- 3. Cross-room signal injection (fixed vulnerability) ------------------
const xroom = await signal(A.data, B.data.deviceId, { kind: "offer", test: 1 }, "203.0.113.10");
check("cross-room signal is rejected 404", xroom.status === 404,
  `got ${xroom.status}`);

const unknownPeer = await signal(A.data, uuid(), { kind: "offer" }, "203.0.113.10");
check("signal to unknown recipient is 404", unknownPeer.status === 404);

// --- 4. Same-room signaling still works ------------------------------------
const okSig = await signal(A.data, A2.data.deviceId, { kind: "offer", test: 1 }, "203.0.113.10");
check("same-room signal is accepted 201", okSig.status === 201, `got ${okSig.status}`);
const drained = await sync(A2.data, "203.0.113.10");
check("recipient drains the signal with correct sender",
  drained.data?.signals?.length === 1 && drained.data.signals[0].from === A.data.deviceId);

// --- 5. Signal backlog cap + drain cap -------------------------------------
// Recipient has 0 pending (drained above). Phase 1 fills 90 concurrently (the
// in-flight max keeps the DB count race below the cap); phase 2 walks the
// boundary serially so exactly 10 more fit, then the cap rejects.
let backlogAccepted = 0;
let backlogRejected = 0;
{
  const phase1 = await Promise.all(
    Array.from({ length: 90 }, (_, i) =>
      signal(A.data, A2.data.deviceId, { kind: "offer", n: i }, "203.0.113.10"),
    ),
  );
  for (const r of phase1) {
    if (r.status === 201) backlogAccepted += 1;
    else if (r.status === 429) backlogRejected += 1;
  }
  for (let i = 0; i < 12; i++) {
    const r = await signal(A.data, A2.data.deviceId, { kind: "offer", n: 90 + i }, "203.0.113.10");
    if (r.status === 201) backlogAccepted += 1;
    else if (r.status === 429) backlogRejected += 1;
  }
}
check("backlog caps at 100 per recipient",
  backlogAccepted === 100 && backlogRejected === 2,
  `accepted=${backlogAccepted} rejected=${backlogRejected}`);

const drain1 = await sync(A2.data, "203.0.113.10", 0);
const drain2 = await sync(A2.data, "203.0.113.10", drain1.data?.cursor ?? 0);
const drain3 = await sync(A2.data, "203.0.113.10", drain2.data?.cursor ?? 0);
check("drain returns at most 50 per poll",
  drain1.data?.signals?.length === 50 && drain2.data?.signals?.length === 50,
  `${drain1.data?.signals?.length}/${drain2.data?.signals?.length}/${drain3.data?.signals?.length}`);
check("drain cursor advances to pick up the rest",
  drain3.data?.signals?.length === 0 && drain2.data?.cursor > drain1.data?.cursor);

// --- 6. Credential checks ---------------------------------------------------
const badToken = await sync(
  { deviceId: A.data.deviceId, deviceToken: "wrong-token-value-aaaaaaaaaaaa" },
  "203.0.113.10",
);
check("sync with wrong token is 404", badToken.status === 404);
const badLeave = await leave(
  { deviceId: A.data.deviceId, deviceToken: "wrong-token-value-aaaaaaaaaaaa" },
  "203.0.113.10",
);
const stillAlive = await sync(A.data, "203.0.113.10");
check("leave with wrong token is a no-op", badLeave.status === 200 && stillAlive.status === 200);

// --- 7. Input validation ----------------------------------------------------
const invalidJson = await post("/api/local/join", null, "203.0.113.10", "{not json");
check("invalid JSON is 400", invalidJson.status === 400);
const badUuid = await post(
  "/api/local/sync",
  { deviceId: "not-a-uuid", deviceToken: "x".repeat(20), afterSeq: 0 },
  "203.0.113.10",
);
check("malformed deviceId is 400", badUuid.status === 400);
const badSeq = await post(
  "/api/local/sync",
  { deviceId: A.data.deviceId, deviceToken: A.data.deviceToken, afterSeq: -5 },
  "203.0.113.10",
);
check("negative afterSeq is 400", badSeq.status === 400);
const hugeSeq = await sync(A.data, "203.0.113.10", Number.MAX_SAFE_INTEGER);
check("huge afterSeq returns empty signals", hugeSeq.data?.signals?.length === 0);

// --- 8. Request body caps ---------------------------------------------------
const bigJoin = await post("/api/local/join", null, "203.0.113.10", JSON.stringify({ name: "x" }) + " ".repeat(10 * 1024));
check("oversized join body is 413", bigJoin.status === 413, `got ${bigJoin.status}`);

const bigPayload = "y".repeat(70 * 1024); // > 64KB payload cap, < 128KB body cap
const payloadTooBig = await signal(A.data, A2.data.deviceId, { kind: "offer", sdp: bigPayload }, "203.0.113.10");
check("signal payload over 64KB is 413", payloadTooBig.status === 413, `got ${payloadTooBig.status}`);

const hugeBody = "z".repeat(200 * 1024);
const bodyTooBig = await post("/api/local/signal", null, "203.0.113.10", hugeBody);
check("oversized signal body is 413", bodyTooBig.status === 413, `got ${bodyTooBig.status}`);

// --- 9. Leave semantics ------------------------------------------------------
const leftOk = await leave(A2.data, "203.0.113.10");
check("leave with valid creds succeeds", leftOk.status === 200);
const afterLeave = await sync(A.data, "203.0.113.10");
check("left device disappears from peers",
  afterLeave.data?.peers?.every((p) => p.id !== A2.data.deviceId) === true);
const leftDrain = await sync(A2.data, "203.0.113.10");
check("left device must rejoin (404)", leftDrain.status === 404);

// --- 10. Rate limits ---------------------------------------------------------
// The in-memory limiter is synchronous, so parallel requests are still
// counted atomically.
const probeStatuses = await Promise.all(
  Array.from({ length: 32 }, (_, i) => join(`RateProbe${i}`, "192.0.2.99")),
);
check("join rate limit kicks in (429 within 32 requests)",
  probeStatuses.some((r) => r.status === 429));

// --- 11. Security headers ----------------------------------------------------
const homeRes = await fetch(`${BASE}/`);
check("X-Frame-Options: DENY", homeRes.headers.get("x-frame-options") === "DENY");
check("X-Content-Type-Options: nosniff",
  homeRes.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy: no-referrer",
  homeRes.headers.get("referrer-policy") === "no-referrer");

// Cleanup: leave the room A device so repeated runs start clean.
await leave(A.data, "203.0.113.10");
await leave(B.data, "198.51.100.20");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
