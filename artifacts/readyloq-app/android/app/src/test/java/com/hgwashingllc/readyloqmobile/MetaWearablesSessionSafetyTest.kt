package com.hgwashingllc.readyloqmobile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MetaWearablesSessionSafetyTest {
  @Test fun observerExceptionAfterStreamingIsContained() = runBlocking {
    var sawStreaming = false
    var failures = 0
    MetaWearablesSessionSafety.observe(
      { true }, { failures++ },
      {
        flow {
          emit("STREAMING")
          throw IllegalStateException("Camera callback failed after connection")
        }.collect { sawStreaming = it == "STREAMING" }
      },
    )
    assertTrue(sawStreaming)
    assertEquals(1, failures)
  }

  @Test fun lateOldObserverErrorCannotTearDownReplacement() = runBlocking {
    var current = true
    var failures = 0
    MetaWearablesSessionSafety.observe(
      { current }, { failures++ },
      {
        current = false
        throw IllegalStateException("Detached old camera")
      },
    )
    assertEquals(0, failures)
  }

  @Test fun observerLinkageFailureIsContained() = runBlocking {
    var failures = 0
    MetaWearablesSessionSafety.observe(
      { true }, { failures++ }, { throw NoClassDefFoundError("Camera observer") },
    )
    assertEquals(1, failures)
  }

  @Test fun cancelledObserverNeverFailsTheCurrentSession() = runBlocking {
    var failures = 0
    try {
      MetaWearablesSessionSafety.observe(
        { true }, { failures++ }, { throw CancellationException("Old session stopped") },
      )
      fail("Cancellation must propagate")
    } catch (_: CancellationException) {
      assertEquals(0, failures)
    }
  }

  @Test fun duplicateStartedCannotAttachAnotherCamera() {
    val startup = MetaWearablesStartup()
    assertTrue(startup.claimCamera())
    assertFalse(startup.claimCamera())
    assertTrue(startup.markStreaming())
    assertFalse(startup.claimCamera())
  }

  @Test fun streamReadinessCompletesOnlyOnceAfterAttachment() {
    val startup = MetaWearablesStartup()
    assertFalse(startup.markStreaming())
    assertTrue(startup.claimCamera())
    assertTrue(startup.markStreaming())
    assertFalse(startup.markStreaming())
  }

  @Test fun cancelledStartupCannotBecomeReadyLater() {
    val old = MetaWearablesStartup()
    old.claimCamera()
    old.cancel()
    val replacement = MetaWearablesStartup()
    assertFalse(old.markStreaming())
    assertFalse(old.claimCamera())
    assertTrue(replacement.claimCamera())
    assertTrue(replacement.markStreaming())
  }

  @Test fun terminalCallbackCannotResolveThenReject() {
    val terminal = MetaWearablesTerminal()
    var callbacks = 0
    terminal.deliver({ fail("Unexpected failure") }) { callbacks++ }
    terminal.deliver({ fail("Unexpected failure") }) { callbacks++ }
    assertEquals(1, callbacks)
  }

  @Test fun throwingReactCallbackCannotBeRetried() {
    val terminal = MetaWearablesTerminal()
    var callbacks = 0
    var errors = 0
    terminal.deliver({ errors++ }) {
      callbacks++
      throw IllegalStateException("Consumed native map")
    }
    terminal.deliver({ errors++ }) { callbacks++ }
    assertEquals(1, callbacks)
    assertEquals(1, errors)
  }

  @Test fun linkageFailureDoesNotEscapeCallback() {
    var errors = 0
    MetaWearablesTerminal().deliver({ errors++ }) { throw NoClassDefFoundError("SDK") }
    assertEquals(1, errors)
  }

  @Test fun closeFailureStillStopsDetachedSession() {
    var stops = 0
    var errors = 0
    MetaWearablesSessionSafety.release(
      { errors++ },
      { throw IllegalStateException("Camera is already closed") },
      { stops++ },
    )
    assertEquals(1, errors)
    assertEquals(1, stops)
  }

  @Test fun closeCancellationStillStopsDetachedSession() {
    var stops = 0
    MetaWearablesSessionSafety.release(
      {},
      { throw CancellationException("Camera SDK task was cancelled") },
      { stops++ },
    )
    assertEquals(1, stops)
  }

  @Test fun releaseLinkageFailureDoesNotPreventRemainingCleanup() {
    var stops = 0
    MetaWearablesSessionSafety.release(
      {},
      { throw NoClassDefFoundError("Camera") },
      { stops++ },
    )
    assertEquals(1, stops)
  }

  @Test fun regularOperationCancellationIsNotConvertedIntoSdkFailure() {
    var reported = false
    try {
      MetaWearablesSessionSafety.attempt({ reported = true }) {
        throw CancellationException("Old observer cancelled")
      }
      fail("Cancellation must propagate")
    } catch (_: CancellationException) {
      assertFalse(reported)
    }
  }
}
