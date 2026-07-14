---
name: Replit App Storage — Signed URLs
description: How to generate presigned GET/PUT URLs for Replit App Storage (GCS-backed) without service account credentials.
---

## Rule
Never call `file.getSignedUrl()` from `@google-cloud/storage` on Replit. Use the sidecar endpoint instead.

## Why
The `objectStorageClient` in `objectStorage.ts` authenticates via external_account credentials pointing at the Replit sidecar (`http://127.0.0.1:1106`). These credentials work for read/write operations but do NOT have the `iam.serviceAccounts.signBlob` permission required by V4 signed URLs. Calling `file.getSignedUrl()` throws a 403 in production.

## How to apply
Use the sidecar's dedicated signing endpoint for all presigned URL generation:

```typescript
const res = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bucket_name: BUCKET_ID,   // DEFAULT_OBJECT_STORAGE_BUCKET_ID
    object_name: objectPath,  // path within bucket, no leading slash
    method: "PUT",            // or "GET"
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  }),
  signal: AbortSignal.timeout(30_000),
});
const { signed_url } = await res.json();
```

Direct read/write via `objectStorageClient.bucket(id).file(path).save()` and `.createReadStream()` work fine — only signing is broken via the GCS SDK.
