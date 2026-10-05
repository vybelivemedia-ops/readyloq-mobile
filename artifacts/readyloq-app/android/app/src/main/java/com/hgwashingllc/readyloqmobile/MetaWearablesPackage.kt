package com.hgwashingllc.readyloqmobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers the Android-only Meta Wearables bridge with the Expo/React Native
 * runtime. This is deliberately a local package: the Wearables Device Access
 * Toolkit is a native Android SDK and cannot run in Expo Go.
 */
class MetaWearablesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(MetaWearablesModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}