# Social Publishing Setup Guide

VYBE LIVE publishes clips via real platform OAuth APIs. Publishing requires:
1. An OAuth token stored for the target platform
2. A real `videoUrl` on the clip (set by the FFmpeg pipeline)

## Supported Platforms

| Platform | API Used | Content Type |
|----------|----------|--------------|
| `youtube_shorts` | YouTube Data API v3 (videos.insert) | Shorts (vertical ≤60s) |
| `instagram` | Instagram Graph API (media + publish) | Reels |
| `facebook` | Facebook Graph API (videos) | Reels |

**Not supported** (no public content-upload API): TikTok, Twitch, Kick.

## Required Secrets

### OAUTH_ENCRYPTION_KEY (required for OAuth token storage)

AES-256-GCM key used to encrypt OAuth tokens at rest. Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the 64-character hex string to Replit Secrets as `OAUTH_ENCRYPTION_KEY`.

**Without this:** All OAuth connect flows will throw on token encryption. The server logs a clear error pointing to this key.

### YouTube (youtube_shorts)

1. Create a Google Cloud project → enable **YouTube Data API v3**
2. Create OAuth 2.0 credentials (Web application)
3. Add to Replit Secrets:
   ```
   YOUTUBE_CLIENT_ID=...
   YOUTUBE_CLIENT_SECRET=...
   ```
4. Add `https://<your-replit-domain>/api/oauth/youtube/callback` as an authorized redirect URI

### Facebook (facebook)

1. Create a Meta App → enable **Facebook Login** + **Video API**
2. Add to Replit Secrets:
   ```
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   ```
3. Add `https://<your-replit-domain>/api/oauth/facebook/callback` as a valid OAuth redirect URI

### Instagram (instagram)

Uses the same Meta App as Facebook. Add to Replit Secrets:
```
INSTAGRAM_APP_ID=...      (same as FACEBOOK_APP_ID or separate Instagram app)
INSTAGRAM_APP_SECRET=...
```
Add `https://<your-replit-domain>/api/oauth/instagram/callback` as a redirect URI.

## OAuth Connect Flow

Users connect their platform accounts from **Settings → Connected Accounts** in the mobile app.

```
Mobile: GET /api/oauth/:platform/init
    │  Returns { authUrl }
    ▼
Browser: redirect user to authUrl
    │  User grants permission
    ▼
Platform callback: GET /api/oauth/:platform/callback?code=...
    │  Server exchanges code → access + refresh tokens
    │  Encrypts tokens with AES-256-GCM (OAUTH_ENCRYPTION_KEY)
    │  Stores in oauth_connections table
    ▼
Mobile: GET /api/oauth/connections
    │  Returns list of connected platforms
```

## Publishing a Clip

```
POST /api/clips/:clipId/publish
Body: {
  "platforms": ["youtube_shorts"],
  "caption": "Optional override caption"
}
```

- If `caption` is omitted, the platform-specific AI caption (`aiCaptionYoutube`, etc.) is used automatically
- Returns the updated Clip with `publishedPlatforms` updated
- Creates a row in `content_posts` with `platformPostId` and `platformPostUrl`

## Error Codes

| Blocker | HTTP | Meaning |
|---------|------|---------|
| `NO_OAUTH_CONNECTION` | 422 | Platform not connected. User must go to Settings → Connected Accounts. |
| `TOKEN_EXPIRED` | 422 | OAuth token expired. User must reconnect the platform. |
| `NO_VIDEO_URL` | 422 | Clip has no video file. Run clip extraction first. |

## Checking Connection Status

```
GET /api/oauth/connections
```

Returns all connected platforms with `status: "active" | "expired"` and `accountName`.

To disconnect:
```
DELETE /api/oauth/connections/:platform
```

## Token Refresh

OAuth access tokens are short-lived (1 hour for YouTube, varies for Meta). The publishing service automatically attempts a token refresh using the stored `encryptedRefreshToken` before returning a `TOKEN_EXPIRED` error. If the refresh fails, the user must reconnect.
