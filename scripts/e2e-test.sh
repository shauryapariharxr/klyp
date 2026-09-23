#!/bin/bash
# End-to-end smoke test for klyp against live Supabase + iDrive e2.
# Usage: bash scripts/e2e-test.sh [BASE_URL]   (default http://localhost:3123)
BASE="${1:-http://localhost:3123}"
J="content-type: application/json"

jq_get() { node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const v=j$1;console.log(v===undefined||v===null?'':v)}catch(e){console.log('')}})"; }

fail() { echo "❌ $1"; exit 1; }
pass() { echo "✅ $1"; }

echo "=========== TEXT-ONLY FLOW ==========="
CREATE=$(curl -s -X POST "$BASE/api/transfer/create" -H "$J" -d '{"text":"hello from klyp e2e"}')
echo "create → $CREATE"
TID=$(echo "$CREATE" | jq_get "['transferId']")
PIN=$(echo "$CREATE" | jq_get "['pin']")
[ -n "$TID" ] && [ -n "$PIN" ] || fail "create failed"

VERIFY=$(curl -s -X POST "$BASE/api/transfer/verify" -H "$J" -d "{\"pin\":\"$PIN\"}")
echo "verify → $VERIFY"
VTOKEN=$(echo "$VERIFY" | jq_get "['accessToken']")
[ -n "$VTOKEN" ] || fail "verify failed: $VERIFY"
VIEW=$(curl -s "$BASE/api/transfer/$TID?token=$VTOKEN")
echo "view → $VIEW"
TEXT=$(echo "$VIEW" | jq_get "['textContent']")
[ "$TEXT" = "hello from klyp e2e" ] && pass "text-only flow (PIN $PIN)" || fail "text mismatch: '$TEXT'"

WRONG=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/transfer/verify" -H "$J" -d '{"pin":"0000"}')
[ "$WRONG" = "404" ] && pass "wrong PIN rejected (404)" || fail "wrong PIN returned $WRONG"

echo ""
echo "=========== FILE FLOW (iDrive e2) ==========="
echo "klyp e2e file content $(date)" > /tmp/klyp-e2e-upload.txt

CREATE2=$(curl -s -X POST "$BASE/api/transfer/create" -H "$J" -d '{"hasFiles":true}')
TID2=$(echo "$CREATE2" | jq_get "['transferId']")
PIN2=$(echo "$CREATE2" | jq_get "['pin']")
TOKEN2=$(echo "$CREATE2" | jq_get "['accessToken']")
[ -n "$TID2" ] || fail "file transfer create failed: $CREATE2"

UPPLAN=$(curl -s -X POST "$BASE/api/transfer/$TID2/upload" -H "$J" \
  -d "{\"accessToken\":\"$TOKEN2\",\"files\":[{\"fileName\":\"e2e-test.txt\",\"fileSize\":100,\"mimeType\":\"text/plain\"}]}")
echo "upload urls → ${UPPLAN:0:120}..."
UPLOAD_URL=$(echo "$UPPLAN" | jq_get "['uploadUrls'][0]['uploadUrl']")
STORAGE_KEY=$(echo "$UPPLAN" | jq_get "['uploadUrls'][0]['storageKey']")
[ -n "$UPLOAD_URL" ] || fail "presigned upload URL failed: $UPPLAN"
pass "presigned PUT URL obtained"

FILESIZE=$(wc -c < /tmp/klyp-e2e-upload.txt | tr -d ' ')
PUTCODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  -H "content-type: text/plain" --data-binary @/tmp/klyp-e2e-upload.txt)
[ "$PUTCODE" = "200" ] && pass "direct browser→e2 upload (PUT $PUTCODE)" || fail "PUT to e2 failed with $PUTCODE (CORS/creds issue?)"

COMPLETE=$(curl -s -X POST "$BASE/api/transfer/$TID2/complete" -H "$J" \
  -d "{\"accessToken\":\"$TOKEN2\",\"uploaded\":[{\"fileName\":\"e2e-test.txt\",\"fileSize\":$FILESIZE,\"mimeType\":\"text/plain\",\"storageKey\":\"$STORAGE_KEY\"}]}")
echo "complete → $COMPLETE"

VERIFY2=$(curl -s -X POST "$BASE/api/transfer/verify" -H "$J" -d "{\"pin\":\"$PIN2\"}")
VTOKEN2=$(echo "$VERIFY2" | jq_get "['accessToken']")
[ -n "$VTOKEN2" ] || fail "file verify failed: $VERIFY2"
VIEW2=$(curl -s "$BASE/api/transfer/$TID2?token=$VTOKEN2")
echo "view → ${VIEW2:0:150}..."
FILEID=$(echo "$VIEW2" | jq_get "['files'][0]['id']")
DLURL=$(echo "$VIEW2" | jq_get "['files'][0]['downloadUrl']")
[ -n "$FILEID" ] && [ -n "$DLURL" ] || fail "no download URL in view: $VIEW2"
pass "verified transfer has signed download URL"

curl -s -o /tmp/klyp-e2e-download.txt "$DLURL"
diff /tmp/klyp-e2e-upload.txt /tmp/klyp-e2e-download.txt > /dev/null 2>&1 \
  && pass "downloaded content matches uploaded content" \
  || fail "downloaded content differs"

echo ""
echo "🎉 ALL E2E TESTS PASSED"
