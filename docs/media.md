# Media — Architectură & Testare

## Arhitectura media

```
Inbound (WhatsApp → server → Firestore + Storage)
  Baileys msg → downloadMediaMessage → buffer
    → uploadMediaToStorage(buffer, convoId, msgId, mime) → Firebase Storage
    → syncMessageToFirestore cu media{path, bucket, mime, size, name}
    → disc local /public/media/ (fallback)

Outbound (Flutter → server → WhatsApp + Firestore + Storage)
  POST /messages/:jid/media (multipart/form-data)
    → multer → buffer
    → resolveCanonicalJid(jid) → canonical
    → sock.sendMessage(canonical, {image/video/doc: buffer})
    → uploadMediaToStorage → media{}
    → syncMessageToFirestore → conversations/{accountId_canonicalJid}/messages/{msgId}

Signed URL (Flutter → server)
  GET /api/media/url/:convoId/:msgId
    → verifyFirebaseToken (ID token)
    → Firestore lookup → media.path
    → getSignedUrl(path, 1h) → returned to Flutter
```

## Structura Firestore

```
conversations/{accountId_canonicalJid}/messages/{msgId}:
  id: string
  text: string
  fromMe: boolean
  type: string
  timestamp: Timestamp
  media:
    path: "conversations/acct_jid/media/msgId.jpg"  # Storage object path
    bucket: "superparty-frontend.appspot.com"         # Storage bucket
    mime: "image/jpeg"
    size: 12345
    name: "photo.jpg"  # original filename (null for images from phone)
  mimetype: "image/jpeg"  # legacy flat field (cleared when media{} present)
```

## Endpoint-uri

| Endpoint                             | Middleware          | Funcție                               |
| ------------------------------------ | ------------------- | ------------------------------------- |
| `POST /messages/:jid/media`          | multer (25MB)       | Trimite media prin WhatsApp + Storage |
| `GET /api/media/url/:convoId/:msgId` | verifyFirebaseToken | Signed URL on-demand (1h)             |
| `GET /media/:jid/:id`                | -                   | Fallback download din store (legacy)  |

## Anti-amestec

- Metric `canonical_mismatch_total` (Prometheus)
- Helper `logMediaOp(route, {...})` — logează JSON cu `inputJid`, `canonicalJid`, `convoId`, `msgId`, `storagePath`
- Guardrail: dacă `convoId != ${accountId}_${canonicalJid}` → warn + metric++

## Testare

### Pas 1: Inbound (receive)

```bash
# Trimite o imagine WhatsApp către cont
# Verifică loguri:
#   [Media] Uploaded to Storage: conversations/acct_jid/media/msgId.jpg
#   [MediaOp] ... mismatch: false
```

### Pas 2: Outbound (send)

```bash
curl -X POST "http://46.225.182.127:3001/messages/40712345678@s.whatsapp.net/media" \
  -F "file=@test.jpg" \
  -F "accountId=superparty_main" \
  -F "type=image" \
  -F "caption=Test media"
```

### Pas 3: Signed URL

```bash
curl -H "Authorization: Bearer <idToken>" \
  "http://46.225.182.127:3001/api/media/url/<convoId>/<msgId>"
# Ar trebui: {"url":"https://storage...signed...", "expiresIn":3600}
```

### Pas 4: Anti-amestec

```bash
curl http://46.225.182.127:3001/metrics | grep canonical_mismatch_total
# Trebuie: canonical_mismatch_total 0
```

### Pas 5: Script automat

```bash
DRY_RUN=true node server/scripts/test-media-canonical.js
```
