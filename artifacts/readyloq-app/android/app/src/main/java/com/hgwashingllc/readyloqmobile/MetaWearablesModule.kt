package com.hgwashingllc.readyloqmobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.Stream
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamState
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Android bridge for Meta's official Wearables Device Access Toolkit (DAT).
 *
 * It exposes the actual Meta AI registration → camera permission → device
 * session → camera stream lifecycle to JavaScript. It never falls back to BLE:
 * consumer Meta glasses do not expose their camera through ReadyLoq's custom
 * GATT protocol. Captures are written to the app cache and emitted only after a
 * real DAT capture succeeds; JavaScript then copies them into the inspection's
 * durable evidence store.
 */
class MetaWearablesModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var session: DeviceSession? = null
  private var camera: Camera? = null
  private var stream: Stream? = null
  private var pendingSessionPromise: Promise? = null
  private var pendingStreamPromise: Promise? = null
  private var sessionStartInFlight = false
  private var streamStartInFlight = false
  private var lifecycleGeneration = 0L
  private var latestError: String? = null
  private var pendingCapturePromise: Promise? = null
  private val sessionObservers = mutableListOf<Job>()
  private val streamObservers = mutableListOf<Job>()
  private var startupDeadline: Job? = null

  override fun getName() = MODULE_NAME

  init {
    reactContext.addLifecycleEventListener(this)
    scope.launch {
      Wearables.registrationState.collect {
        emitStatus()
      }
    }
    scope.launch {
      Wearables.devices.collect {
        emitStatus()
      }
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    // A refresh is an explicit retry. Preserve errors only until the user has
    // asked us to re-check current DAT state, then report fresh state instead.
    latestError = null
    refreshCameraPermission { permission ->
      promise.resolve(statusMap(permission))
    }
  }

  @ReactMethod
  fun startRegistration(promise: Promise) {
    scope.launch {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Open ReadyLoq before starting Meta AI registration.")
      return@launch
    }
    try {
      Wearables.startRegistration(activity)
      latestError = null
      emitStatus()
      promise.resolve(statusMap())
    } catch (error: Exception) {
      latestError = error.message ?: "Unable to open the Meta AI registration flow."
      emitStatus()
      promise.reject("REGISTRATION_FAILED", latestError, error)
    }
    }
  }

  @ReactMethod
  fun requestCameraPermission(promise: Promise) {
    scope.launch {
    val activity = reactContext.currentActivity as? MainActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Open ReadyLoq before requesting Meta AI camera access.")
      return@launch
    }
    activity.requestMetaWearablesCameraPermission { granted, message ->
      latestError = if (granted) null else message ?: "Meta AI camera permission was not granted."
      emitStatus()
      if (granted) {
        promise.resolve(statusMap(PermissionStatus.Granted))
      } else {
        promise.resolve(statusMap(PermissionStatus.Denied))
      }
    }
    }
  }

  @ReactMethod
  fun startSession(promise: Promise) {
    scope.launch {
    if (sessionStartInFlight) {
      promise.reject("SESSION_STARTING", "A Meta glasses session is already starting.")
      return@launch
    }
    if (session != null && session?.state?.value == DeviceSessionState.STARTED) {
      startCameraStream(promise)
      return@launch
    }
    if (session != null) {
      // Keep exactly one lifecycle operation in flight. Reporting a second
      // request as successful while DAT is still starting would mislead the
      // technician into thinking a capture stream exists.
      promise.reject("SESSION_STARTING", "A Meta glasses session is already starting.")
      return@launch
    }

    val generation = lifecycleGeneration
    sessionStartInFlight = true
    pendingSessionPromise = promise
    scheduleStartupDeadline()
    try {
    Wearables.createSession(AutoDeviceSelector())
      .onSuccess { created ->
        if (generation != lifecycleGeneration) {
          created.stop()
          return@onSuccess
        }
        session = created
        observeSession(created)
        // DAT reports session startup through DeviceSession.state rather than
        // returning a result from start(); wait for STARTED before attaching
        // the camera stream.
        created.start()
        latestError = null
        emitStatus()
      }
      .onFailure { error, _ ->
        if (generation != lifecycleGeneration) return@onFailure
        sessionStartInFlight = false
        pendingSessionPromise = null
        latestError = error.description
        startupDeadline?.cancel()
        emitStatus()
        promise.reject("NO_ELIGIBLE_META_DEVICE", error.description)
      }
    } catch (error: Exception) {
      latestError = error.message ?: "Unable to create a Meta glasses session."
      promise.reject("SESSION_START_FAILED", latestError, error)
      clearSession()
      emitStatus()
    }
    }
  }

  @ReactMethod
  fun stopSession(promise: Promise) {
    scope.launch {
    try {
      lifecycleGeneration += 1
      pendingSessionPromise?.reject("SESSION_CANCELLED", "The Meta glasses session was stopped.")
      pendingSessionPromise = null
      pendingStreamPromise?.reject("STREAM_CANCELLED", "The Meta glasses camera stream was stopped.")
      pendingStreamPromise = null
      sessionStartInFlight = false
      streamStartInFlight = false
      clearSession()
      latestError = null
      emitStatus()
      promise.resolve(statusMap())
    } catch (error: Exception) {
      latestError = error.message ?: "Unable to stop the Meta glasses session."
      emitStatus()
      promise.reject("SESSION_STOP_FAILED", latestError, error)
    }
    }
  }

  @ReactMethod
  fun capturePhoto(promise: Promise) {
    scope.launch capture@ {
    val activeStream = stream
    if (activeStream == null || activeStream.state.value != StreamState.STREAMING ||
      session?.state?.value != DeviceSessionState.STARTED) {
      promise.reject(
        "STREAM_NOT_READY",
        "Meta glasses must be connected and streaming before a photo can be captured.",
      )
      return@capture
    }
    if (pendingCapturePromise != null) {
      promise.reject("CAPTURE_IN_PROGRESS", "A Meta glasses photo is already being captured.")
      return@capture
    }
    val generation = lifecycleGeneration
    pendingCapturePromise = promise

      try {
        activeStream.capturePhoto()
        .onSuccess { photo ->
          val capturedAt = java.time.Instant.now().toString()
          scope.launch delivery@ {
          try {
            if (generation != lifecycleGeneration || activeStream !== stream) return@delivery
            val file = withContext(Dispatchers.IO) { writePhoto(photo) }
            if (generation != lifecycleGeneration || activeStream !== stream) {
              file.delete()
              return@delivery
            }
            val payload = Arguments.createMap().apply {
              putString("uri", "file://${file.absolutePath}")
              putString("capturedAt", capturedAt)
              putString("source", "meta_wearables_dat")
              putString("mimeType", "image/jpeg")
            }
            emit(EVENT_CAPTURE, payload)
            latestError = null
            emitStatus()
            pendingCapturePromise = null
            promise.resolve(payload)
          } catch (error: Exception) {
            if (pendingCapturePromise !== promise) return@delivery
            latestError = error.message ?: "Meta glasses returned an unreadable photo."
            emitStatus()
            pendingCapturePromise = null
            promise.reject("CAPTURE_DELIVERY_FAILED", latestError, error)
          }
          }
        }
        .onFailure { error, _ ->
          if (generation != lifecycleGeneration) return@onFailure
          latestError = error.description
          emitStatus()
          pendingCapturePromise = null
          promise.reject("CAPTURE_FAILED", error.description)
        }
      } catch (error: Exception) {
        if (pendingCapturePromise === promise) {
          pendingCapturePromise = null
          latestError = error.message ?: "Meta glasses capture failed."
          emitStatus()
          promise.reject("CAPTURE_FAILED", latestError, error)
        }
      }
      }
  }

  @ReactMethod
  fun removeCapture(uri: String, promise: Promise) {
    try {
      val path = uri.removePrefix("file://")
      val cacheRoot = File(reactContext.cacheDir, CAPTURE_DIRECTORY).canonicalFile
      val target = File(path).canonicalFile
      // Containment prevents a crafted sibling such as "meta-wearables-evil"
      // from being deleted during cache cleanup.
      if (target.isFile && target.toPath().startsWith(cacheRoot.toPath())) target.delete()
      promise.resolve(null)
    } catch (_: Exception) {
      // Cache cleanup must never make a successful inspection capture fail.
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit

  @ReactMethod
  fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    scope.cancel()
    clearSession()
    super.invalidate()
  }

  override fun onHostResume() = emitStatus()
  // No foreground service is owned by this bridge: release the camera when
  // backgrounded instead of retaining a hidden stream or delivering late photos.
  override fun onHostPause() {
    if (session != null) {
      pendingSessionPromise?.reject("SESSION_CANCELLED", "ReadyLoq was backgrounded.")
      pendingStreamPromise?.reject("STREAM_CANCELLED", "ReadyLoq was backgrounded.")
      clearSession()
      emitStatus()
    }
  }

  override fun onHostDestroy() = onHostPause()

  private fun startCameraStream(promise: Promise) {
    val activeSession = session
    if (activeSession == null || activeSession.state.value != DeviceSessionState.STARTED) {
      promise.reject("SESSION_NOT_READY", "Meta glasses are not ready for a camera session.")
      return
    }
    if (streamStartInFlight) {
      promise.reject("STREAM_STARTING", "The Meta glasses camera stream is already starting.")
      return
    }

    val generation = lifecycleGeneration
    streamStartInFlight = true
    pendingStreamPromise = promise
    scheduleStartupDeadline()
    refreshCameraPermission { permission ->
      if (generation != lifecycleGeneration) return@refreshCameraPermission
      if (permission != PermissionStatus.Granted) {
        startupDeadline?.cancel()
        startupDeadline = null
        streamStartInFlight = false
        pendingStreamPromise = null
        promise.resolve(statusMap(permission))
        return@refreshCameraPermission
      }
      if (stream?.state?.value == StreamState.STREAMING) {
        startupDeadline?.cancel()
        startupDeadline = null
        streamStartInFlight = false
        pendingStreamPromise = null
        promise.resolve(statusMap(permission))
        return@refreshCameraPermission
      }

      activeSession.addCamera(StreamConfiguration())
        .onSuccess { addedCamera ->
          if (generation != lifecycleGeneration) {
            addedCamera.close()
            return@onSuccess
          }
          camera = addedCamera
          stream = addedCamera.stream
          observeStream(addedCamera.stream)
          addedCamera.stream.start()
            .onSuccess {
              if (generation != lifecycleGeneration) {
                addedCamera.close()
                return@onSuccess
              }
              streamStartInFlight = false
              pendingStreamPromise = null
              latestError = null
              emitStatus()
              promise.resolve(statusMap(permission))
            }
            .onFailure { error, _ ->
              if (generation != lifecycleGeneration) return@onFailure
              startupDeadline?.cancel()
              startupDeadline = null
              streamStartInFlight = false
              pendingStreamPromise = null
              latestError = error.description
              camera?.close()
              camera = null
              stream = null
              emitStatus()
              promise.reject("STREAM_START_FAILED", error.description)
            }
        }
        .onFailure { error, _ ->
          if (generation != lifecycleGeneration) return@onFailure
          startupDeadline?.cancel()
          startupDeadline = null
          streamStartInFlight = false
          pendingStreamPromise = null
          latestError = error.description
          emitStatus()
          promise.reject("CAMERA_UNAVAILABLE", error.description)
        }
    }
  }

  private fun observeSession(observed: DeviceSession) {
    sessionObservers += scope.launch {
      observed.state.collect { state ->
        if (observed !== session) return@collect
        if (state == DeviceSessionState.STARTED) {
          sessionStartInFlight = false
          latestError = null
          pendingSessionPromise?.let { pending ->
            pendingSessionPromise = null
            startCameraStream(pending)
          }
        }
        if (state == DeviceSessionState.STOPPED) {
          lifecycleGeneration += 1
          sessionStartInFlight = false
          streamStartInFlight = false
          pendingSessionPromise?.reject(
            "SESSION_START_FAILED",
            latestError ?: "Meta glasses session ended before it started.",
          )
          pendingSessionPromise = null
          pendingStreamPromise?.reject(
            "STREAM_CANCELLED",
            latestError ?: "The Meta glasses session ended before its camera stream started.",
          )
          pendingStreamPromise = null
          clearSession()
        }
        emitStatus()
      }
    }
    sessionObservers += scope.launch {
      observed.errors.collect { error ->
        if (observed !== session) return@collect
        latestError = error.description
        emitStatus()
      }
    }
  }

  private fun observeStream(observed: Stream) {
    streamObservers.forEach { it.cancel() }
    streamObservers.clear()
    streamObservers += scope.launch {
      var leftInitialStopped = false
      observed.state.collect { state ->
        if (observed !== stream) return@collect
        // StateFlow immediately emits STOPPED for a new stream. It is not a
        // disconnect until startup has actually begun.
        if (state != StreamState.STOPPED) leftInitialStopped = true
        if (state == StreamState.STREAMING) {
          latestError = null
          startupDeadline?.cancel()
          startupDeadline = null
        }
        if (MetaWearablesContract.shouldReleaseStream(state.toString(), leftInitialStopped)) {
          lifecycleGeneration += 1
          streamStartInFlight = false
          pendingStreamPromise?.reject(
            "STREAM_START_FAILED",
            latestError ?: "The Meta glasses camera stream stopped before it was ready.",
          )
          pendingStreamPromise = null
          pendingCapturePromise?.reject("CAPTURE_CANCELLED", "The Meta camera stream ended.")
          pendingCapturePromise = null
          camera?.close()
          streamStartInFlight = false
          camera = null
          stream = null
          streamObservers.forEach { it.cancel() }
          streamObservers.clear()
        }
        emitStatus()
      }
    }
    streamObservers += scope.launch {
      observed.errorStream.collect { error ->
        if (observed !== stream) return@collect
        latestError = error.description
        emitStatus()
      }
    }
  }

  private fun refreshCameraPermission(callback: (PermissionStatus?) -> Unit) {
    scope.launch {
      try {
        Wearables.checkPermissionStatus(Permission.CAMERA)
        .onSuccess { callback(it) }
        .onFailure { error, _ ->
          latestError = error.description
          callback(null)
        }
      } catch (error: Exception) {
        latestError = error.message ?: "Unable to check Meta camera permission."
        callback(null)
      }
    }
  }

  private fun statusMap(permission: PermissionStatus? = null): WritableMap {
    val registration = Wearables.registrationState.value.toString()
    val sessionState = session?.state?.value?.toString() ?: DeviceSessionState.IDLE.toString()
    val streamState = stream?.state?.value?.toString() ?: StreamState.STOPPED.toString()
    val snapshot = MetaWearablesSnapshot(
      registrationState = registration,
      cameraPermission = permission?.toString(),
      deviceCount = Wearables.devices.value.size,
      sessionState = sessionState,
      streamState = streamState,
    )
    return Arguments.createMap().apply {
      putString("platform", "android")
      putString("registrationState", registration)
      putString("cameraPermission", permission?.toString() ?: "UNKNOWN")
      putInt("deviceCount", Wearables.devices.value.size)
      putString("sessionState", sessionState)
      putString("streamState", streamState)
      if (latestError != null) putString("error", latestError)
      putBoolean("canStartSession", MetaWearablesContract.canStartSession(snapshot))
      putBoolean("canCapture", MetaWearablesContract.canCapture(snapshot))
    }
  }

  private fun emitStatus() {
    refreshCameraPermission { permission -> emit(EVENT_STATUS, statusMap(permission)) }
  }

  private fun emit(name: String, payload: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, payload)
  }

  private fun clearSession() {
    try {
      lifecycleGeneration += 1
      startupDeadline?.cancel()
      startupDeadline = null
      pendingCapturePromise?.reject("CAPTURE_CANCELLED", "The Meta glasses session ended.")
      pendingCapturePromise = null
      sessionObservers.forEach { it.cancel() }
      sessionObservers.clear()
      streamObservers.forEach { it.cancel() }
      streamObservers.clear()
      camera?.close()
      session?.stop()
    } catch (error: Exception) {
      Log.w(TAG, "Meta DAT session cleanup failed", error)
    } finally {
      camera = null
      stream = null
      session = null
      pendingSessionPromise = null
      pendingStreamPromise = null
      sessionStartInFlight = false
      streamStartInFlight = false
    }
  }

  private fun scheduleStartupDeadline() {
    startupDeadline?.cancel()
    val generation = lifecycleGeneration
    startupDeadline = scope.launch {
      delay(30_000)
      if (generation != lifecycleGeneration) return@launch
      latestError = "Meta glasses did not become ready within 30 seconds. Retry the session."
      pendingSessionPromise?.reject("SESSION_TIMEOUT", latestError)
      pendingStreamPromise?.reject("STREAM_TIMEOUT", latestError)
      clearSession()
      emitStatus()
    }
  }

  private fun writePhoto(photo: PhotoData): File {
    val bitmap = when (photo) {
      is PhotoData.Bitmap -> photo.bitmap
      is PhotoData.HEIC -> decodeHeic(photo.data)
    } ?: throw IllegalStateException("Meta glasses returned an empty image.")

    val directory = File(reactContext.cacheDir, CAPTURE_DIRECTORY)
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("Could not create Meta glasses capture storage.")
    }
    val output = File(directory, "meta_${UUID.randomUUID()}.jpg")
    FileOutputStream(output).use { stream ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)) {
        throw IllegalStateException("Could not encode Meta glasses photo.")
      }
    }
    return output
  }

  private fun decodeHeic(data: ByteBuffer): Bitmap? {
    val copy = data.duplicate().apply { rewind() }
    val bytes = ByteArray(copy.remaining())
    copy.get(bytes)
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
  }

  private companion object {
    const val MODULE_NAME = "ReadyLoqMetaWearables"
    const val EVENT_STATUS = "ReadyLoqMetaWearablesStatus"
    const val EVENT_CAPTURE = "ReadyLoqMetaWearablesCapture"
    const val CAPTURE_DIRECTORY = "meta-wearables"
    const val JPEG_QUALITY = 92
    const val TAG = "ReadyLoqMetaWearables"
  }
}