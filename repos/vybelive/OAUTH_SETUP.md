# VYBE LIVE — OAuth Provider Setup Guide

Each platform (YouTube, Facebook, Instagram, Twitch) requires a separate OAuth app registration.
All secrets go into **Replit → Tools → Secrets** — never hard-code them.

---

## Required Replit Secrets

| Secret | Provider | Where to find |
|--------|----------|--------------|
| `OAUTH_ENCRYPTION_KEY` | Internal | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | Google | Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google | Cloud Console → Credentials |
| `META_APP_ID` | Meta | developers.facebook.com → App Dashboard |
| `META_APP_SECRET` | Meta | App Dashboard → Settings → Basic |
| `TWITCH_CLIENT_ID` | Twitch | dev.twitch.tv → Console → Applications |
| `TWITCH_CLIENT_SECRET` | Twitch | Same console |

Generate the encryption key first — without it, `/oauth/:platform/init` returns 503:

```bash
openssl rand -hex 32
```

---

## Redirect URI pattern

All platforms use the same URI format. Replace `<your-domain>` with your Replit deployment domain
(visible in Replit → Deploy → Domains, or in `REPLIT_DOMAINS` at runtime).

| Platform | Redirect URI |
|----------|-------------|
| YouTube | `https://<your-domain>/api/oauth/youtube/callback` |
| Facebook | `https://<your-domain>/api/oauth/facebook/callback` |
| Instagram | `https://<your-domain>/api/oauth/facebook/callback` *(same as Facebook — shared Meta app)* |
| Twitch | `https://<your-domain>/api/oauth/twitch/callback` |

**Development redirect URIs** (Replit workspace, not deployed):
- Domain from `REPLIT_DEV_DOMAIN` env var, e.g. `https://abc123.picard.replit.dev/api/oauth/youtube/callback`
- The server resolves this automatically — no config change needed.

---

## Google / YouTube

### 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `vybe-live-prod`)
3. Select the project

### 2. Enable APIs

Enable both in **APIs & Services → Library**:
- **YouTube Data API v3**
- **YouTube Live Streaming API**

### 3. Create OAuth credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `VYBE LIVE`
4. Authorized redirect URIs — add:
   ```
   https://<prod-domain>/api/oauth/youtube/callback
   https://<dev-domain>/api/oauth/youtube/callback
   ```
5. Click **Create**
6. Copy **Client ID** → `GOOGLE_CLIENT_ID`
7. Copy **Client Secret** → `GOOGLE_CLIENT_SECRET`

### 4. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. App name: `VYBE LIVE`
4. Scopes to add:
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.upload`
   - `openid`, `email`, `profile`
5. Add test users (yourself) while in **Testing** mode
6. Submit for verification before moving to production *(Google requires verified apps for YouTube scopes)*

### What VYBE LIVE does with YouTube access
- Creates a `liveStream` (RTMP ingest endpoint + stream key)
- Creates a `liveBroadcast` (the public YouTube Live event)
- Binds them together
- Passes the RTMP URL + stream key to Agora Cloud Push

---

## Meta — Facebook + Instagram

Facebook and Instagram share a single Meta app. One registration covers both platforms.

### 1. Create a Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. **My Apps → Create App**
3. App type: **Business** (required for Live Video permissions)
4. App name: `VYBE LIVE`
5. Note your **App ID** → `META_APP_ID`
6. **Settings → Basic** → copy **App Secret** → `META_APP_SECRET`

### 2. Add products

In the App Dashboard sidebar, add:
- **Facebook Login** (for OAuth + token exchange)
- **Instagram Graph API** (for Instagram connection)

### 3. Configure Facebook Login

1. **Facebook Login → Settings**
2. Valid OAuth Redirect URIs — add:
   ```
   https://<prod-domain>/api/oauth/facebook/callback
   https://<dev-domain>/api/oauth/facebook/callback
   ```
3. Save changes

### 4. Request permissions

In **App Review → Permissions and Features**, request:
- `pages_show_list`
- `pages_read_engagement`
- `publish_video` *(required for Facebook Live)*
- `public_profile`
- `instagram_basic`
- `instagram_content_publish`

> **Note:** `publish_video` requires Meta app review. In development, add yourself as a Test User and test with your own Facebook account. Production multistreaming requires review approval.

### 5. Go Live settings

For Facebook Live to work properly:
- Your Facebook account or Page must have Live Video enabled
- The app must be in **Live mode** (not Development) for non-test users

### What VYBE LIVE does with Meta access
- Creates a Facebook `live_video` object, which returns a secure RTMP URL
- Passes the RTMP URL to Agora Cloud Push
- Instagram Live does not have a public 3rd-party RTMP API — Instagram connections allow clip publishing and future integration

---

## Twitch

### 1. Register a Twitch application

1. Go to [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
2. **Register Your Application**
3. Name: `VYBE LIVE`
4. OAuth Redirect URLs — add:
   ```
   https://<prod-domain>/api/oauth/twitch/callback
   https://<dev-domain>/api/oauth/twitch/callback
   ```
5. Category: **Broadcasting Suite**
6. Click **Create**
7. Copy **Client ID** → `TWITCH_CLIENT_ID`
8. Click **New Secret** → copy → `TWITCH_CLIENT_SECRET`

### Required Twitch scopes

- `channel:read:stream_key` — fetch stream key for RTMP push
- `channel:manage:broadcast` — update stream title/category
- `user:read:email` — profile fetch

### What VYBE LIVE does with Twitch access
- Fetches the Twitch stream key via Helix API (`/streams/key`)
- Uses the standard RTMP ingest: `rtmp://live.twitch.tv/app/<stream_key>`
- Passes these to Agora Cloud Push

> **Note:** Twitch stream keys are permanent until manually reset by the user. VYBE LIVE fetches the key on every push start to handle resets.

---

## Testing the OAuth flow in development

### 1. Confirm the server is running and secrets are set

```bash
curl https://<dev-domain>/api/healthz
# → {"status":"ok"}

# Check redirect URIs logged at startup:
# Look for "OAuth redirect URI validation" in API server logs
```

### 2. Trigger an OAuth init (authenticated)

```bash
TOKEN="<your-jwt-access-token>"
curl -H "Authorization: Bearer $TOKEN" \
  https://<dev-domain>/api/oauth/youtube/init
# → {"url":"https://accounts.google.com/o/oauth2/v2/auth?...", "redirectUri":"..."}
```

### 3. Complete the flow in the app

- Open the Connected Accounts screen in the mobile app
- Tap **Connect** on any platform
- Complete the OAuth flow in the browser
- The app returns to the Connected Accounts screen with the platform marked **Connected**

### 4. Verify the connection was stored

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://<dev-domain>/api/oauth/connections
# → [{platform: "youtube", status: "connected", accountName: "...", ...}]
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `503 OAuth not configured` | Missing client ID/secret | Add secrets to Replit → Secrets |
| `503 OAUTH_ENCRYPTION_KEY not configured` | Missing encryption key | Generate with `openssl rand -hex 32` |
| `400 Invalid state` | OAuth callback took >10 minutes, or CSRF | Retry the OAuth flow |
| `OAuth redirect_uri_mismatch` (Google) | Redirect URI not registered | Add the exact URI shown in API startup logs to Google Console |
| `redirect_uri_mismatch` (Meta) | Same as above | Add URI to Meta app → Facebook Login → Valid OAuth Redirect URIs |
| Token exchange fails | Wrong client secret | Re-copy secret from provider dashboard |
| Twitch: `403 Unauthorized` | Scope not granted | Re-auth with correct scopes |
| Facebook Live fails | `publish_video` not approved | Use a test user; submit for app review for production |
