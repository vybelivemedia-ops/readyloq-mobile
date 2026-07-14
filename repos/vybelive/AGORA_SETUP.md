# VYBE LIVE — Agora Setup Guide

VYBE LIVE uses two Agora products:
- **Agora RTC** — real-time video capture from the streamer's device (mobile SDK)
- **Agora Media Push** *(aka RTMP Converter)* — cloud service that transcodes the RTC channel and pushes RTMP to YouTube, Facebook, Twitch simultaneously

---

## Required Replit Secrets

| Secret | Purpose | Where to find |
|--------|---------|--------------|
| `AGORA_APP_ID` | Identifies your Agora project | Console → Project Management |
| `AGORA_APP_CERTIFICATE` | Signs RTC tokens | Console → Project Management |
| `AGORA_CUSTOMER_ID` | REST API authentication | Console → RESTful API |
| `AGORA_CUSTOMER_SECRET` | REST API authentication | Console → RESTful API |

All four must be set for live multistreaming to work. Missing any one causes:
- Missing `AGORA_APP_ID` or `AGORA_APP_CERTIFICATE` → Agora token generation fails → device can't join the channel
- Missing `AGORA_CUSTOMER_ID` or `AGORA_CUSTOMER_SECRET` → Cloud Push returns 503 → no RTMP delivery

The app degrades gracefully: if Agora is not configured, streams still run in **simulation mode** (camera preview + fake stats).

---

## Step 1: Create an Agora account and project

1. Go to [console.agora.io](https://console.agora.io)
2. Sign up / log in
3. **Project Management → Create New Project**
   - Project name: `vybe-live-prod`
   - Authentication: **Secured mode** (App ID + Token) — **required for production**
4. Click **Submit**

---

## Step 2: Get App ID and Certificate

1. Open the project in Project Management
2. Copy **App ID** → `AGORA_APP_ID`
3. Click **Config** on the project
4. Under **Primary Certificate**, click the copy icon → `AGORA_APP_CERTIFICATE`

> Keep the App Certificate private — it signs all RTC tokens and must never be exposed to clients.

---

## Step 3: Enable Media Push add-on

Agora Media Push is a paid add-on (not enabled by default).

1. In the Agora Console, go to **Billing → Package**
2. Find **Media Push** (RTMP Converter)
3. Enable the add-on for your project
4. Confirm billing is set up

> **Cost:** Media Push is billed per push-hour per destination. Roughly $0.0075–$0.015/minute per RTMP destination depending on resolution. A 1-hour stream to 3 platforms costs approximately $1.35–$2.70.

---

## Step 4: Get RESTful API credentials

These are separate from the App ID/Certificate — they authenticate server-to-server calls.

1. In Agora Console, click your **account avatar** (top right)
2. Go to **RESTful API**
3. Click **Add a Secret**
4. Copy **Customer ID** → `AGORA_CUSTOMER_ID`
5. Copy **Customer Secret** → `AGORA_CUSTOMER_SECRET`

> Customer secrets are shown only once. Save them immediately.

---

## How VYBE LIVE uses Agora

### RTC flow (device → Agora cloud)

```
Streamer's phone
  └─ react-native-agora SDK
       └─ joins channel `stream-<streamId>`
            └─ publishes camera/mic track to Agora RTC
```

### Media Push flow (Agora cloud → platforms)

```
Agora RTC channel (cloud)
  └─ Media Push converter (UID 999999, SUBSCRIBER role)
       ├─ YouTube:  rtmp://a.rtmp.youtube.com/live2/<key>
       ├─ Facebook: rtmps://live-api-s.facebook.com:443/rtmp/<key>
       └─ Twitch:   rtmp://live.twitch.tv/app/<key>
```

The API server:
1. Fetches RTMP credentials from each OAuth platform (YouTube, Facebook, Twitch)
2. Calls `POST /v1/projects/{appId}/rtmp-converters` for each destination
3. Each converter joins the RTC channel as UID 999999 and streams out via RTMP
4. Mobile polls `GET /streams/{id}/push/status` every 10s to update health indicators

### Reconnect flow

If a push destination goes `failed`:
1. Mobile detects 2 consecutive `failed` poll results
2. Mobile calls `POST /streams/{id}/push/reconnect`
3. Server stops the old Agora task, refreshes the platform RTMP credentials, starts a new task
4. Max 5 reconnect attempts per destination per stream

---

## Agora token generation

VYBE LIVE generates RTC tokens server-side using `agora-token`:

```typescript
RtcTokenBuilder.buildTokenWithUid(
  appId, appCertificate,
  channelName,          // "stream-<streamId>"
  uid,                  // assigned per user (1–100000)
  RtcRole.PUBLISHER,
  expireTs,             // now + 2 hours
  expireTs
)
```

The cloud push subscriber uses **UID 999999** with `RtcRole.SUBSCRIBER` so it never conflicts with creator UIDs.

Token expiry is 7200s (2h). Streams longer than 2 hours will need token renewal — this is a known limitation for closed beta.

---

## Media Push transcoding settings

Current defaults (can be tuned in `agoraPush.ts`):

| Setting | Value |
|---------|-------|
| Resolution | 1280 × 720 (720p) |
| Frame rate | 30 fps |
| Video bitrate | 2500 kbps |
| Audio codec | HE-AAC v2 |
| Sample rate | 48 kHz |
| Audio bitrate | 128 kbps |
| Audio channels | Stereo |
| Idle timeout | 300s (5 min no signal → auto-stop) |

To upgrade to 1080p, change `videoOptions` in `agoraPush.ts`:
```typescript
width: 1920, height: 1080, bitrate: 4500
```
Note: 1080p requires a higher Agora plan tier.

---

## Testing Agora in development

### 1. Verify the API server has credentials

Check startup logs for:
```
{"level":"info","msg":"Server listening","port":8080}
```

No errors about `AGORA_APP_ID` or `AGORA_CUSTOMER_ID` = credentials loaded.

### 2. Test token generation

```bash
TOKEN="<your-jwt-access-token>"
STREAM_ID="<a-live-stream-id>"

curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"publisher"}' \
  https://<dev-domain>/api/streams/$STREAM_ID/agora-token
# → {"token":"007...", "uid":123, "channel":"stream-abc..."}
```

### 3. Test push start (requires live stream + OAuth connections)

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  https://<dev-domain>/api/streams/$STREAM_ID/push/start
# → {"streamId":"...", "destinations":[{"platform":"youtube","status":"started","taskId":"..."}]}
```

### 4. Test push status

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://<dev-domain>/api/streams/$STREAM_ID/push/status
# → {"destinations":[{"platform":"youtube","status":"live","bitrateKbps":2450,...}]}
```

### 5. Expo Go vs dev build

- **Expo Go**: Agora RTC module is not available → camera preview + simulation mode only
- **Dev build** (`expo-dev-client`): Full Agora RTC + Media Push works
- See `BETA_CHECKLIST.md` for EAS dev build setup

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `AGORA_APP_ID is not set` | Secret missing | Add to Replit Secrets |
| `Agora Push start failed: 401` | Wrong Customer ID/Secret | Re-copy from Console → RESTful API |
| `Agora Push start failed: 403` | Media Push not enabled | Enable add-on in Agora Console → Billing |
| `Agora returned no task ID` | API response format changed | Check Agora changelog; update `data["converter"]?.["id"]` path |
| Push status shows `offline` immediately | RTMP URL invalid or stream key expired | Refresh OAuth token and fetch new RTMP credentials |
| `Token expire` errors in client | Token lifespan too short for long streams | Token renewal not yet implemented for >2h streams (beta blocker) |
| Media Push OK but YouTube/Facebook shows offline | RTMP credentials issue | Check platform-specific RTMP URL and key in `streamDestinationsTable` |

---

## Region configuration

Current setting: `region: "na_geass"` (North America).

For EU or APAC deployments, change in `agoraPush.ts`:
```typescript
region: "eu_west_1"   // Europe
region: "ap_east_1"   // Asia-Pacific
```

See [Agora region codes](https://docs.agora.io/en/media-push/reference/region-codes) for the full list.
