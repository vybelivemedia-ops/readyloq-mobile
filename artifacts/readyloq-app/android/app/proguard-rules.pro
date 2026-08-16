# ─────────────────────────────────────────────────────────────────────────────
# ReadyLoq — ProGuard / R8 keep rules
#
# These rules run under R8 full mode (android.enableR8.fullMode=true).
# Full mode is more aggressive than standard R8: it removes everything that
# isn't reachable from a keep root, inlines aggressively, and strips default
# interface methods.  Every library that uses reflection, JNI, or dynamic
# class loading needs an explicit keep rule here.
# ─────────────────────────────────────────────────────────────────────────────

# ── Hermes / JSI ─────────────────────────────────────────────────────────────
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.jni.annotations.** { *; }

# ── React Native core ─────────────────────────────────────────────────────────
# Bridge, turbo modules, codegen, and the JS runtime all reach into these via
# reflection and JNI.  Do not strip any member.
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.react.devsupport.** { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keepclassmembers class * implements com.facebook.react.bridge.JavaScriptModule { *; }
-keepclassmembers class * implements com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    <init>(...);
}

# ── React Native Reanimated ───────────────────────────────────────────────────
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# ── Expo modules ─────────────────────────────────────────────────────────────
# expo-modules-core uses reflection to discover and instantiate module classes.
-keep class expo.modules.** { *; }
-keep class expo.modules.core.** { *; }
-keepclassmembers class * extends expo.modules.core.ExportedModule {
    <init>(...);
}
-keepclassmembers class * extends expo.modules.kotlin.modules.Module {
    <init>(...);
}

# ── BLE (react-native-ble-plx / RxAndroidBLE) ────────────────────────────────
-keep class com.polidea.rxandroidble2.** { *; }
-keep class com.polidea.multiplatformbleadapter.** { *; }

# ── Clerk / authentication ────────────────────────────────────────────────────
# Clerk's Android SDK uses reflection for device attestation.
-keep class com.clerk.** { *; }

# ── OkHttp / Retrofit / Networking ───────────────────────────────────────────
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class com.facebook.react.modules.network.** { *; }

# ── Kotlin coroutines ─────────────────────────────────────────────────────────
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# ── Keep Parcelable creators (Android IPC) ────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# ── Keep Serializable classes ─────────────────────────────────────────────────
-keepclassmembers class * implements java.io.Serializable {
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Suppress noisy warnings from unused optional dependencies ─────────────────
-dontwarn com.google.android.gms.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.Unsafe
-dontwarn java.lang.invoke.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
