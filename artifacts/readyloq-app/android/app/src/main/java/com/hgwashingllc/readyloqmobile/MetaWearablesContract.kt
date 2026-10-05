package com.hgwashingllc.readyloqmobile

/**
 * Native safety contract shared by the DAT bridge and its local JVM tests.
 * Treat all toolkit values as opaque strings here so a future DAT SDK state
 * addition safely disables capture until it is explicitly supported.
 */
data class MetaWearablesSnapshot(
  val registrationState: String,
  val cameraPermission: String?,
  val deviceCount: Int,
  val sessionState: String,
  val streamState: String,
)

object MetaWearablesContract {
  private fun String.isValue(expected: String) = equals(expected, ignoreCase = true)

  fun canStartSession(snapshot: MetaWearablesSnapshot): Boolean =
    snapshot.registrationState.isValue("REGISTERED") &&
      snapshot.cameraPermission?.isValue("GRANTED") == true &&
      snapshot.deviceCount > 0

  fun canCapture(snapshot: MetaWearablesSnapshot): Boolean =
    canStartSession(snapshot) &&
      snapshot.sessionState.isValue("STARTED") &&
      snapshot.streamState.isValue("STREAMING")

  fun shouldReleaseStream(state: String, leftInitialStopped: Boolean): Boolean =
    state.isValue("CLOSED") || (state.isValue("STOPPED") && leftInitialStopped)

  fun isSafeCaptureFile(uri: String): Boolean =
    uri.startsWith("file://") && uri.length > "file://".length
}