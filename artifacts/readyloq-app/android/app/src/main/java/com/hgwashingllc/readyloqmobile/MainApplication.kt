package com.hgwashingllc.readyloqmobile

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.WearablesError

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // DAT is an Android-only local bridge, so Expo autolinking does
              // not discover it. Consumer Meta glasses use this official SDK,
              // not the custom ReadyLoq BLE protocol.
              add(MetaWearablesPackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()

    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    try {
      Wearables.initialize(this)
        .onSuccess { MetaWearablesInitialization.ready() }
        .onFailure { error, _ ->
          if (error == WearablesError.ALREADY_INITIALIZED) {
            MetaWearablesInitialization.ready()
          } else {
            MetaWearablesInitialization.unavailable("Meta DAT initialization failed.")
            android.util.Log.w("ReadyLoq", "Meta Wearables initialization failed: $error")
          }
        }
    } catch (error: Exception) {
      MetaWearablesInitialization.unavailable("Meta DAT initialization failed.")
      android.util.Log.w("ReadyLoq", "Meta Wearables initialization failed", error)
    } catch (error: LinkageError) {
      MetaWearablesInitialization.unavailable("Meta DAT is unavailable in this build.")
      android.util.Log.w("ReadyLoq", "Meta Wearables initialization failed", error)
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
