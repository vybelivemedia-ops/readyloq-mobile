# ReadyLoq Android preview updates

## What this changes

Use the connected Expo **EAS Workflows** service with
`artifacts/readyloq-app/.eas/workflows/update-preview.yml`. It uses the
pre-packaged `update` job, not a local EAS CLI command or an Android build.
The workflow is manual-only: pushing ordinary code never silently updates phones.
It publishes Android only to **channel `preview`**, using that channel's linked
EAS Update branch. Do not substitute a GitHub branch name for the update channel.
The `production` channel and iOS are not targeted.

The workflow reads exactly three `EXPO_PUBLIC_*` settings from the production
profile in `eas.json`: API domain, live Clerk publishable key, and Clerk proxy URL.
It requires preview/production parity and uses EAS `set-env` to pass them between
steps without printing values. `EXPO_NO_DOTENV=1` prevents a development `.env`
file from overriding them. No Clerk secret key or other server credential is
exported. Public client settings necessarily exist inside a downloadable bundle.

Before publishing, the workflow exports Android in a temporary directory and
checks the actual Hermes launch bundle for all three configured public values.
This check is a configuration guard, not proof of authentication or API behavior.
EAS then produces and publishes its normal update export.

## Source and native compatibility

Current target: internal **APK 223**, EAS build
`bc4f20b4-a761-4b39-b581-7b7d2236aefa`, package
`com.hgwashingllc.readyloqmobile`, channel `preview`, runtime **`1.0.0`**.
Expo reports its GitHub source commit as
`5e68b772a3a5b08acff631c7fb66673f7e944b53` in
`vybelivemedia-ops/readyloq-mobile`.
This metadata identifies the distributed candidate; it does not prove which
binary is installed on a particular phone.

For the first OTA probe, use an isolated GitHub revision based on that exact APK
source plus only this workflow, its configuration checks, and the JS-only
`PreviewUpdateIdentity` display on Sign in and About. The current Replit workspace
also has later **native MetaWearables changes**. Those are deliberately not
included in this OTA candidate: JS updates cannot deliver native fixes.
Do not publish the whole workspace under runtime `1.0.0` merely because an
export succeeds.

Before each future update:

1. Identify the exact installed build and its runtime/channel in Expo metadata.
2. Compare proposed source against that build's immutable GitHub source. Review
   every dependency/lockfile, native and app-config change, including workspace
   native code, config plugins, `android/`, `ios/`, and native-module versions.
3. If native compatibility changed, **make a new native build with a new runtime
   version**, distribute it, and update this publishing target after review.
   Never reuse `1.0.0` for different native code. Runtime matching alone is not a
   compatibility test when a fixed string is used.
4. For JS-only screen/copy/logic fixes and compatible bundled assets, create an
   isolated reviewed GitHub source revision. Verify the complete intended
   path/hash/mode set; do not use stale `main` or an unpushed workspace checkpoint.
5. Validate the workflow with the connected Expo workflow validator, then run
   `update-preview.yml` through the connected Expo workflow service with the
   **immutable GitHub commit SHA**. The connected Expo project's app directory
   must remain `artifacts/readyloq-app`.
6. Record workflow ID, source SHA, update group and Android update ID, runtime,
   and linked EAS branch. Query the public Expo update manifest for Android,
   runtime `1.0.0`, and channel `preview`; require its update ID to match.
7. Perform the phone check below. Publishing success is not delivery success.

No native rebuild is needed for compatible JS-only fixes. Changes to Android/iOS
code, SDK/native libraries, permissions, config plugins, app identifier/scheme,
update URL/channel baked into the APK, icons/splash native resources, signing,
or background services require a new native build. Server/API changes need their
own deployment and backward compatibility; OTA does not deploy the server.

## Phone acceptance (separate from Mission Control)

**NOT RUN until actual phone evidence is recorded.** Do not clear app storage,
uninstall, or reinstall to simulate an update: that would not prove OTA delivery
and could erase unsynced inspection evidence.

1. Confirm ReadyLoq APK 223 is installed. Finish/save any active inspection.
2. Connect to the internet and open the app long enough to download the update.
   Default Expo behavior checks at cold launch and may run the embedded bundle
   first while downloading in the background.
3. Close/force-stop ReadyLoq normally, then reopen it. If the first reopening still
   runs the old bundle, allow the download time and cold-open once more. Do not
   continually kill the app during download.
4. On **Sign in** (no login required), or **Settings → About ReadyLoq**, capture:
   - `Preview OTA check · 2026-10-09`
   - channel `preview`, runtime `1.0.0`
   - **Downloaded update**, not **Embedded APK bundle**
   - the complete update ID, matching the published Android update ID.
5. Record device model/Android version, native build number, test date, update ID
   and screenshot. Confirm no emergency/fallback message, then check sign-in and
   production API access. Cold-open again offline to confirm the cached update
   launches. Record each result independently.

There is intentionally no automatic in-session reload button; a reload could
interrupt capture or unsaved work. A newer bundle is applied at a safe cold start.
If download or launch fails, preserve native update logs and do not call it a pass.
Use Expo's dashboard rollback/republish controls against the **preview** branch
after reviewing the last known-good compatible update; then recheck the phone.

Mission Control's physical-device acceptance and existing Fold 7 cases remain
unchanged. This OTA marker demonstrates a JS delivery path only, not those
separate feature tests.
