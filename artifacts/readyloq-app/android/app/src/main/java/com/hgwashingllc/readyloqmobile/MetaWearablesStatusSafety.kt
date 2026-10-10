package com.hgwashingllc.readyloqmobile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Initialization is recorded without consulting SDK getters on a failure path. */
object MetaWearablesInitialization {
  data class State(val ready: Boolean, val error: String?)

  private val gate = MetaWearablesInitializationGate()
  private val initializationState = MutableStateFlow(State(false, "Meta DAT is not initialized."))
  val changes: StateFlow<State> = initializationState.asStateFlow()
  val state: State get() = initializationState.value
  val attempted: Boolean get() = gate.attempted

  fun initializeAfterBluetoothPermission(granted: Boolean, initialize: () -> Unit): Boolean =
    gate.runAfterBluetoothPermission(granted, initialize)

  fun ready() { initializationState.value = State(true, null) }
  fun unavailable(message: String) { initializationState.value = State(false, message) }
}

/** Process-owned guard: an activity never owns or retains the SDK initialization. */
class MetaWearablesInitializationGate {
  @Volatile
  var attempted = false
    private set

  @Synchronized
  fun runAfterBluetoothPermission(granted: Boolean, initialize: () -> Unit): Boolean {
    if (!granted || attempted) return false
    // Claim before calling the SDK, even if it throws or re-enters. Retrying a
    // partially initialized SDK is unsafe; recreation must not initialize twice.
    attempted = true
    initialize()
    return true
  }
}

/** Keep SDK errors separate from terminal callbacks: never retry a throwing callback. */
object MetaWearablesStatusSafety {
  suspend fun <T> permissionIfConnected(deviceCount: Int, check: suspend () -> T): T? =
    if (deviceCount > 0) check() else null

  suspend fun <T> deliverOnce(
    isCurrent: () -> Boolean,
    read: suspend () -> T,
    onSuccess: (T) -> Unit,
    onFailure: (Throwable) -> Unit,
    onCallbackError: (Throwable) -> Unit,
  ) {
    currentCoroutineContext().ensureActive()
    if (!isCurrent()) return
    val result = try {
      Result.success(read())
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Exception) {
      Result.failure(error)
    } catch (error: LinkageError) {
      Result.failure(error)
    }
    currentCoroutineContext().ensureActive()
    if (!isCurrent()) return
    try {
      result.fold(onSuccess, onFailure)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Exception) {
      onCallbackError(error)
    } catch (error: LinkageError) {
      onCallbackError(error)
    }
  }
}
