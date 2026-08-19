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

# ── react-native-screens ──────────────────────────────────────────────────────
# Uses reflection to register native screen components via the React Native
# module registry.  Also contains Kotlin-implemented ViewManagers.
-keep class com.swmansion.rnscreens.** { *; }

# ── react-native-safe-area-context ───────────────────────────────────────────
-keep class com.th3rdwave.safeareacontext.** { *; }

# ── @react-native-community/netinfo ──────────────────────────────────────────
-keep class com.reactnativecommunity.netinfo.** { *; }

# ── react-native-svg ─────────────────────────────────────────────────────────
# SVG rendering uses reflection to resolve element classes by tag name.
-keep class com.horcrux.svg.** { *; }

# ── react-native-keyboard-controller ─────────────────────────────────────────
-keep class com.swmansion.keyboardcontroller.** { *; }

# ── react-native-worklets (Reanimated worklets runtime) ──────────────────────
# Worklets are executed on a separate C++/JNI thread; the Java bridge class
# must not be renamed or removed.
-keep class com.swmansion.worklets.** { *; }
-keep class com.swmansion.reanimated.worklets.** { *; }

# ── whisper.rn (on-device speech recognition — JNI) ──────────────────────────
# whisper.rn bundles a native .so; its Java shim is loaded by name at runtime.
-keep class com.rnwhisper.** { *; }
# Keep all JNI-registered native methods regardless of package.
-keepclasseswithmembernames class * {
    native <methods>;
}

# ── Fresco (animated GIF / WebP images) ──────────────────────────────────────
# Fresco uses reflection for its image pipeline factories and animated backends.
-keep class com.facebook.fresco.** { *; }
-keep class com.facebook.imagepipeline.** { *; }
-dontwarn com.facebook.fresco.**

# ── Firebase / FCM (expo-notifications push channel) ─────────────────────────
# expo-notifications on Android routes through FCM.  The service and receiver
# classes are referenced by name in the manifest; R8 must not rename them.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**

# ── Kotlin metadata & reflection ──────────────────────────────────────────────
# R8 full mode can drop @Metadata annotations that kotlinx.serialization and
# Reanimated's Kotlin reflection paths depend on.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-keepclassmembers class **$WhenMappings { <fields>; }
-keepclassmembers class kotlin.Lazy { *; }

# ── expo-task-manager / expo-background-fetch internal references ─────────────
# expo-background-fetch and expo-task-manager >= 57.0.10 are compiled by the
# expo team against a newer expo-modules-core that contains AnyTypeCache and
# related classes.  Our pinned expo-modules-core@3.0.30 does not contain those
# classes, so they are missing at runtime — not stripped by R8.
# Fix: both packages are pinned to 57.0.9 in package.json (compiled against the
# older expo-modules-core we have).  These -dontwarn rules remain as a belt-
# and-suspenders safety net in case a future transitive bump slips through.
-dontwarn expo.modules.kotlin.services.**
-dontwarn expo.modules.kotlin.types.**

# ── Suppress noisy warnings from unused optional dependencies ─────────────────
-dontwarn com.google.android.gms.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.Unsafe
-dontwarn java.lang.invoke.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
