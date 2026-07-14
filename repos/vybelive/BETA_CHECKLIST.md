# VYBE LIVE — Closed Beta Launch Checklist

## 1. Replit Secrets (Required Before Any OAuth Works)

| Secret | Where to get it | Used for |
|--------|----------------|----------|
| `SESSION_SECRET` | Generate: `openssl rand -hex 32` | JWT signing — server won't start without this |
| `OAUTH_ENCRYPTION_KEY` | Generate: `openssl rand -hex 32` | AES-256-GCM encryption of OAuth tokens at rest |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials | YouTube OAuth |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials | YouTube OAuth |
| `META_APP_ID` | Meta for Developers → Your App → Settings → Basic | Facebook + Instagram OAuth |
| `META_APP_SECRET` | Meta for Developers → Your App → Settings → Basic | Facebook + Instagram OAuth |
| `TWITCH_CLIENT_ID` | Twitch Developer Console → Your App | Twitch OAuth |
| `TWITCH_CLIENT_SECRET` | Twitch Developer Console → Your App | Twitch OAuth |
| `AGORA_CUSTOMER_ID` | Agora Console → RESTful API | Agora Cloud Push (multistream engine) |
| `AGORA_CUSTOMER_SECRET` | Agora Console → RESTful API | Agora Cloud Push (multistream engine) |

> `META_APP_ID` / `META_APP_SECRET` are shared between Facebook and Instagram OAuth.
> `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` are required in the mobile EAS build environment.

---

## 2. Google Cloud Console Setup (YouTube OAuth)

1. Create a project at https://console.cloud.google.com
2. Enable **YouTube Data API v3** and **YouTube Live Streaming API**
3. Create OAuth 2.0 credentials (Web application type)
4. Add authorized redirect URIs:
   - `https://<your-replit-domain>/api/oauth/youtube/callback`
   - `https://getvybe.live/api/oauth/youtube/callback` (production)
5. Add test users (required while app is in "Testing" status)
6. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Replit Secrets

---

## 3. Meta for Developers Setup (Facebook + Instagram OAuth)

1. Create an app at https://developers.facebook.com → Business type
2. Add products: **Facebook Login** and **Instagram Basic Display**
3. Add OAuth redirect URIs under Facebook Login → Settings:
   - `https://<your-replit-domain>/api/oauth/facebook/callback`
   - `https://<your-replit-domain>/api/oauth/instagram/callback`
4. Required permissions: `pages_show_list`, `pages_read_engagement`, `publish_video`, `instagram_basic`, `instagram_content_publish`
5. Add test users under App Roles → Test Users (while in development mode)
6. Set `META_APP_ID` and `META_APP_SECRET` in Replit Secrets

---

## 4. Twitch Developer Console Setup

1. Register an application at https://dev.twitch.tv/console/apps
2. Set OAuth Redirect URL: `https://<your-replit-domain>/api/oauth/twitch/callback`
3. Category: Broadcasting
4. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in Replit Secrets

---

## 5. Agora Console Setup (Multistream Engine)

1. Create a project at https://console.agora.io
2. Enable **Media Push** (RTMP Converter) for the project
3. Note your **App ID** and **App Certificate** (set in Expo EAS environment, not Replit Secrets)
4. Go to RESTful API tab → generate Customer ID + Customer Secret
5. Set `AGORA_CUSTOMER_ID` and `AGORA_CUSTOMER_SECRET` in Replit Secrets

---

## 6. Environment Variables (Non-Secret, Expo)

Set in the EAS build profile or Expo workflow:

```
EXPO_PUBLIC_DOMAIN=<your-replit-domain>   # e.g. abc123.repl.co — no https:// prefix
```

---

## 7. Database

- Run `pnpm --filter @workspace/db run push` after any schema changes
- All required tables exist in `lib/db/src/schema/index.ts`

---

## 8. Pre-Launch Verification

Run through this in the simulator before inviting beta users:

- [ ] API server starts without errors (check workflow logs)
- [ ] Register a new user → lands on onboarding screen with feature slides
- [ ] Onboarding → platform connect step appears after slides
- [ ] Settings → Connected Accounts shows all 4 platform cards (YouTube, Facebook, Instagram, Twitch)
- [ ] YouTube OAuth: tap Connect → browser opens → returns via deep link → account name appears
- [ ] Twitch OAuth: same verification
- [ ] Disconnect a platform → card shows "Not connected"
- [ ] Go Live setup: Step 2 (Platforms) shows connected OAuth accounts
- [ ] Preflight check passes with at least one platform connected (`canGoLive: true`)
- [ ] Preflight blocks launch when no platforms are connected (`canGoLive: false`)
- [ ] Stream starts → POV camera activates (phone source)
- [ ] Push status polling every 10s shows platform health badges on live screen
- [ ] Auto-reconnect triggers after 2 consecutive failed push polls
- [ ] End stream → navigates back to home tab
- [ ] Clips tab shows clips generated after stream ends

---

## 9. Known Limitations for Closed Beta

| Limitation | Detail |
|------------|--------|
| **Instagram Live** | No public RTMP API for third-party encoders. Instagram appears in OAuth for clip/story publishing only — not multistreaming. |
| **Agora in Expo Go** | `react-native-agora` is native-only. Streaming on device requires a dev build (`expo-dev-client`). App falls back to simulation mode in Expo Go. |
| **YouTube broadcast cleanup** | If a stream ends abnormally, the YouTube broadcast may remain in "created" state. Check YouTube Studio if re-using the same account. |
| **Twitch stream key** | Twitch provides a permanent stream key via API; it does not expire between streams. |
| **Facebook Live** | Requires a Facebook Page (not personal profile) for programmatic live streaming. |
| **Token refresh** | Tokens auto-refresh on `/oauth/connections` list. If a token is expired with no refresh token (e.g. Instagram), the user must reconnect manually. |
| **Push rate limit** | `/push/start` is capped at 3 calls per stream per minute to prevent Agora task proliferation. |
| **Reconnect cap** | Auto-reconnect is capped at 5 attempts per destination per stream session to control cost. |

---

## 10. Security Checklist

- [ ] `SESSION_SECRET` is at least 32 random characters (enforced at server startup)
- [ ] `OAUTH_ENCRYPTION_KEY` is 32 bytes hex (64 hex characters)
- [ ] OAuth `state` tokens expire after 10 minutes and are one-time use (server-side nonce store)
- [ ] Two-phase `confirmToken` flow prevents confused-deputy attacks on OAuth callback
- [ ] All `/api/admin/*` routes require `role: "admin"` in JWT
- [ ] RTMP credentials are never returned in list endpoints — only consumed internally during push
- [ ] Access tokens and refresh tokens are AES-256-GCM encrypted at rest in the database
- [ ] `/oauth/:platform/callback` is browser-only and unauthenticated; `confirmToken` binds it to the authenticated mobile session

---

## 11. Architecture Quick Reference

```
Mobile App (Expo)
    │
    ├── OAuth flow: /api/oauth/:platform/init
    │       → browser opens platform consent page
    │       → /api/oauth/:platform/callback (server handles)
    │       → deep link: mobile://oauth-complete?confirmToken=...
    │       → /api/oauth/:platform/confirm (mobile calls with bearer token)
    │
    ├── Go Live: /api/streams (POST) → /api/streams/:id/start
    │       → /api/streams/:id/preflight (gate check)
    │       → /api/agora/token (Agora RTC join)
    │       → /api/streams/:id/push/start (Agora Cloud Push → YouTube/Twitch/Facebook)
    │
    └── Live polling: GET /api/streams/:id/push/status (every 10s)
            → auto-reconnect: POST /api/streams/:id/push/reconnect
```

---

## 12. Deployment

1. Publish the API server from Replit (Publish button)
2. Run DB push to production (handled automatically by Replit Publish flow)
3. Build the Expo app with EAS:
   ```
   eas build --profile development --platform ios
   eas build --profile development --platform android
   ```
4. Distribute via TestFlight (iOS) or direct APK (Android) for closed beta testers
5. Update `EXPO_PUBLIC_DOMAIN` to point to the published API domain
