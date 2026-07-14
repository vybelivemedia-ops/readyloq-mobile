---
name: Auth security architecture
description: Production-safe JWT dual-token auth decisions — secrets, hashing, rotation, rate limiting
---

## Rules

**Secret derivation**: One `SESSION_SECRET` env var → two distinct signing keys via HMAC:
- `createHmac('sha256', SESSION_SECRET).update('vybe:access-token:v1').digest('hex')` → ACCESS_SECRET
- `createHmac('sha256', SESSION_SECRET).update('vybe:refresh-token:v1').digest('hex')` → REFRESH_SECRET

**Why:** Single env var, cryptographically independent secrets. Prevents token-type confusion attacks (refresh token used as access token).

**jti (JWT ID) is mandatory in every token.** Without it, two tokens issued within the same second (same payload) are byte-for-byte identical, making rotation fail silently — the "new" hash equals the old hash, and the old token is never invalidated.

**Token type claim**: `type: "access" | "refresh"` in every JWT payload. `requireAuth` rejects any token where `type !== "access"`, `verifyRefreshToken` rejects `type !== "refresh"`.

**Refresh token hashing**: SHA-256 (`crypto.createHash('sha256')`), NOT bcrypt. Bcrypt is for passwords (brute-force resistance). Tokens are high-entropy already; SHA-256 is correct and fast. Use `timingSafeEqual` for comparison.

**Rotation enforcement**: On refresh, compute SHA-256 of presented token, compare (timing-safe) against stored hash. Mismatch = replay attack → null the stored hash (force re-login) and return 401. Match → issue new pair, update stored hash atomically.

**Startup validation**: `index.ts` calls `process.exit(1)` if `SESSION_SECRET` missing or < 32 chars, before importing `app.ts`. The auth middleware module also throws at load time as a secondary guard.

**Rate limits** (express-rate-limit v8, `skipSuccessfulRequests: true` on login/refresh):
- POST /api/auth/login: 10 failed/15min/IP
- POST /api/auth/register: 5/hour/IP
- POST /api/auth/refresh: 30 failed/15min/IP

**CORS**: Allowlist built at runtime from `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, plus regex patterns for `*.replit.dev` and `*.expo.dev`. Localhost allowed in non-production. Body limit: 64kb.

**Helmet config**: `contentSecurityPolicy: false` (pure JSON API), `crossOriginEmbedderPolicy: false`, `crossOriginResourcePolicy: { policy: "cross-origin" }` (allow native mobile clients).

**Breaking change note**: Switching from bcrypt-hashed refresh tokens (old) to SHA-256 (new) + separate secrets invalidates all existing sessions. Users must re-login.
