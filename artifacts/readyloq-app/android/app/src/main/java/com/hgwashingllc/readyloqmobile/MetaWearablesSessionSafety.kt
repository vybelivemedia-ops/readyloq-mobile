package com.hgwashingllc.readyloqmobile

import kotlinx.coroutines.CancellationException

/** One camera attachment per session, even if STARTED is emitted after a pause. */
class MetaWearablesStartup {
  private var closed = false
  private var cameraClaimed = false
  private var streaming = false

  fun claimCamera(): Boolean {
    if (closed || cameraClaimed) return false
    cameraClaimed = true
    return true
  }

  fun markStreaming(): Boolean {
    if (closed || !cameraClaimed || streaming) return false
    streaming = true
    return true
  }

  fun cancel() { closed = true }
}

/** Settle before invoking React: a throwing callback must never be retried. */
class MetaWearablesTerminal {
  private var settled = false

  fun deliver(onError: (Throwable) -> Unit, callback: () -> Unit) {
    if (settled) return
    settled = true
    MetaWearablesSessionSafety.attempt(onError, callback)
  }
}

object MetaWearablesSessionSafety {
  suspend fun observe(
    isCurrent: () -> Boolean,
    onFailure: (Throwable) -> Unit,
    action: suspend () -> Unit,
  ) {
    if (!isCurrent()) return
    try {
      action()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Exception) {
      if (isCurrent()) onFailure(error)
    } catch (error: LinkageError) {
      if (isCurrent()) onFailure(error)
    }
  }

  fun attempt(onError: (Throwable) -> Unit, action: () -> Unit) {
    try {
      action()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Exception) {
      onError(error)
    } catch (error: LinkageError) {
      onError(error)
    }
  }

  /** Each release is independent: a failed camera close must not skip stop(). */
  fun release(onError: (Throwable) -> Unit, vararg actions: () -> Unit) {
    actions.forEach { action ->
      try {
        action()
      } catch (error: Exception) {
        // Cleanup is synchronous; cancellation of one SDK resource must not
        // prevent the other detached resources from being released.
        onError(error)
      } catch (error: LinkageError) {
        onError(error)
      }
    }
  }
}
