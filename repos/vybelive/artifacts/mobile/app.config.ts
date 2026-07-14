import { withDangerousMod } from "@expo/config-plugins";
import type { ExpoConfig } from "expo/config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Build provenance embedded into the Expo manifest (extra.buildInfo).
 *
 * Priority: live git (local dev) → committed build-info.json snapshot
 * (EAS servers archive the working tree without .git, so the snapshot —
 * refreshed by scripts/src/write-build-info.mjs — is the source there)
 * → explicit unknowns. Inline here (not @workspace/build-info) because
 * Expo's config loader compiles this file standalone.
 */
function captureBuildInfo() {
  const timestamp = new Date().toISOString();
  try {
    const git = (args: string): string =>
      execSync(`git --no-optional-locks ${args}`, {
        cwd: __dirname,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    const commitSha = git("rev-parse HEAD");
    return {
      branch: git("rev-parse --abbrev-ref HEAD"),
      commitSha,
      commitMessage: git("log -1 --pretty=%s"),
      buildTimestamp: timestamp,
      workingTreeStatus: git("status --porcelain") === "" ? "clean" : "dirty",
      source: "git",
    };
  } catch {
    try {
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(__dirname, "build-info.json"), "utf-8"),
      );
      return { ...snapshot, source: "snapshot" };
    } catch {
      return {
        branch: "unknown",
        commitSha: "unknown",
        commitMessage: "unknown",
        buildTimestamp: timestamp,
        workingTreeStatus: "unknown",
        source: "unknown",
      };
    }
  }
}

/**
 * Config plugin that disables Android native linking for expo-meta-wearables-dat.
 *
 * The package's Android library depends on com.meta.wearable:mwdat-{core,camera,
 * mockdevice}:0.6.0 hosted on GitHub Packages, which requires GITHUB_TOKEN
 * authentication. EAS cloud builds don't have that token, so Gradle fails.
 *
 * withDangerousMod runs during `expo prebuild` (before Gradle). The Expo
 * auto-linker reads expo-module.config.json during Gradle's configuration phase
 * (after prebuild), so patching it here ensures Gradle never sees the Android
 * entry and never tries to resolve the GitHub-gated Maven artifacts.
 *
 * Runtime: expo-meta-wearables-dat calls requireNativeModule("EMWDAT") at the
 * top of its JS bundle. Without the native module registered, this throws at
 * require()-time. MetaWearablesContext wraps the require() in a try/catch and
 * falls back to its built-in simulation hook — identical behaviour to Expo Go.
 */
function withMetaDATAndroidDisabled(config: ExpoConfig): ExpoConfig {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const configPath = path.join(
        cfg.modRequest.projectRoot,
        "node_modules",
        "expo-meta-wearables-dat",
        "expo-module.config.json"
      );
      try {
        if (fs.existsSync(configPath)) {
          const moduleConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
            platforms?: string[];
            android?: unknown;
          };
          if (moduleConfig.android) {
            delete moduleConfig.android;
            if (Array.isArray(moduleConfig.platforms)) {
              moduleConfig.platforms = moduleConfig.platforms.filter((p) => p !== "android");
            }
            fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2) + "\n");
            console.log(
              "[withMetaDATAndroidDisabled] Patched expo-meta-wearables-dat: " +
                "Android native linking disabled (GitHub Packages token not available in EAS)."
            );
          }
        }
      } catch (err) {
        console.warn("[withMetaDATAndroidDisabled] Could not patch expo-module.config.json:", err);
      }
      return cfg;
    },
  ]);
}

const baseConfig: ExpoConfig = {
  name: "VYBE LIVE",
  slug: "mobile",
  version: "0.9.20",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "mobile",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/icon.png",
    resizeMode: "contain",
    backgroundColor: "#070311",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.vybelive.app",
    associatedDomains: ["applinks:getvybe.live", "webcredentials:getvybe.live"],
    infoPlist: {
      NSCameraUsageDescription: "VYBE LIVE uses your camera to stream live video.",
      NSMicrophoneUsageDescription: "VYBE LIVE uses your microphone to stream live audio.",
      NSBluetoothAlwaysUsageDescription:
        "VYBE LIVE uses Bluetooth to connect to Meta AI Glasses for hands-free POV livestreaming.",
      NSLocalNetworkUsageDescription:
        "VYBE LIVE uses the local network to measure connection quality during live streams.",
      NSPhotoLibraryAddUsageDescription:
        "VYBE LIVE saves your stream recordings to your photo library so you can keep and share them.",
    },
  },
  android: {
    package: "com.vybelive.app",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#070311",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.BLUETOOTH",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    versionCode: 124,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "getvybe.live" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    favicon: "./assets/images/icon.png",
  },
  plugins: [
    ["expo-router", { origin: "https://replit.com/" }],
    "expo-font",
    "expo-web-browser",
    "expo-media-library",
    // Opt-in: only include expo-dev-client when APP_ENV is explicitly a
    // development variant.  Defaulting to excluded means an unset or unknown
    // APP_ENV never accidentally ships the dev-launcher in a production APK.
    ...(process.env.APP_ENV?.startsWith("development")
      ? (["expo-dev-client"] as const)
      : []),
    [
      "expo-camera",
      {
        cameraPermission: "VYBE LIVE uses your camera to stream live video.",
        microphonePermission: "VYBE LIVE uses your microphone to stream live audio.",
        recordAudioAndroid: true,
      },
    ],
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "17.0" },
        android: { minSdkVersion: 24 },
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "VYBE LIVE uses your microphone for hands-free voice commands while streaming.",
        speechRecognitionPermission:
          "VYBE LIVE uses speech recognition to detect your trigger phrases and mark stream highlights hands-free.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: "366cc65d-37c8-4d47-800e-f9a309a74e51",
    },
    buildInfo: captureBuildInfo(),
  },
};

export default () => withMetaDATAndroidDisabled(baseConfig);
