package com.hgwashingllc.readyloqmobile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Initialization is recorded without consulting SDK getters on a failure path. */
object MetaWearablesInitialization {
  data class State(val ready: Boolean, val error: String?)

  @Volatile
  var state = State(false, "Meta DAT is not initialized.")
    private set

  fun ready() { state = State(true, null) }
  fun unavailable(message: String) { state = State(false, message) }
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
