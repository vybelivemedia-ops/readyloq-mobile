package com.hgwashingllc.readyloqmobile

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class MetaWearablesStatusSafetyTest {
  @After
  fun resetInitialization() {
    MetaWearablesInitialization.unavailable("Meta DAT is not initialized.")
  }

  @Test
  fun initializationFailureCanBeReadWithoutSdkAccess() {
    MetaWearablesInitialization.unavailable("SDK could not initialize.")
    assertFalse(MetaWearablesInitialization.state.ready)
    assertEquals("SDK could not initialize.", MetaWearablesInitialization.state.error)
    MetaWearablesInitialization.ready()
    assertTrue(MetaWearablesInitialization.state.ready)
    assertNull(MetaWearablesInitialization.state.error)
  }

  @Test
  fun noDeviceNeverQueriesSdkPermission() = runBlocking {
    var checks = 0
    val permission = MetaWearablesStatusSafety.permissionIfConnected(0) {
      checks++
      throw IllegalStateException("No device must not reach the SDK.")
    }
    assertNull(permission)
    assertEquals(0, checks)
  }

  @Test
  fun connectedDeviceChecksPermissionOnce() = runBlocking {
    var checks = 0
    val permission = MetaWearablesStatusSafety.permissionIfConnected(1) {
      checks++
      "GRANTED"
    }
    assertEquals("GRANTED", permission)
    assertEquals(1, checks)
  }

  @Test
  fun successfulStatusIsDeliveredOnce() = runBlocking {
    var deliveries = 0
    MetaWearablesStatusSafety.deliverOnce(
      { true }, { "status" },
      { assertEquals("status", it); deliveries++ },
      { fail("Success must not invoke failure.") },
      { fail("Success must not report a callback error.") },
    )
    assertEquals(1, deliveries)
  }

  @Test
  fun sdkExceptionRejectsOnceWithoutRetryingSdkRead() = runBlocking {
    var reads = 0
    var failures = 0
    MetaWearablesStatusSafety.deliverOnce(
      { true }, { reads++; throw IllegalStateException("DAT not initialized") },
      { fail("A failed read must not deliver success.") },
      { failures++; assertEquals("DAT not initialized", it.message) },
      { fail("Read failure is not a callback failure.") },
    )
    assertEquals(1, reads)
    assertEquals(1, failures)
  }

  @Test
  fun sdkLinkageFailureIsContained() = runBlocking {
    var failures = 0
    MetaWearablesStatusSafety.deliverOnce(
      { true }, { throw NoClassDefFoundError("DAT") },
      { fail("Missing SDK must not succeed.") },
      { failures++; assertTrue(it is LinkageError) },
      { fail("A read failure must not reach callback-error handling.") },
    )
    assertEquals(1, failures)
  }

  @Test
  fun throwingSuccessCallbackIsNotRetriedAsFailure() = runBlocking {
    var deliveries = 0
    var errors = 0
    MetaWearablesStatusSafety.deliverOnce(
      { true }, { "status" },
      { deliveries++; throw IllegalStateException("React callback failed") },
      { fail("Do not deliver a second terminal callback.") },
      { errors++ },
    )
    assertEquals(1, deliveries)
    assertEquals(1, errors)
  }

  @Test
  fun throwingFailureCallbackIsNotRetried() = runBlocking {
    var failures = 0
    var errors = 0
    MetaWearablesStatusSafety.deliverOnce(
      { true }, { throw IllegalStateException("SDK read failed") },
      { fail("Failed SDK read must not succeed.") },
      { failures++; throw IllegalStateException("Reject callback failed") },
      { errors++ },
    )
    assertEquals(1, failures)
    assertEquals(1, errors)
  }

  @Test
  fun cancellationDoesNotInvokeFallback() = runBlocking {
    val worker = launch {
      try {
        MetaWearablesStatusSafety.deliverOnce(
          { true }, { throw CancellationException("Bridge invalidated") },
          { fail("Cancellation must not deliver success.") },
          { fail("Cancellation must not invoke fallback.") },
          { fail("Cancellation must not invoke callback-error handling.") },
        )
        fail("Cancellation must propagate.")
      } catch (_: CancellationException) {
        // Expected; a cancelled status request cannot deliver stale data.
      }
    }
    worker.join()
  }

  @Test
  fun cancellationDuringReadPreventsDelivery() = runBlocking {
    val worker = launch {
      MetaWearablesStatusSafety.deliverOnce(
        { true }, { coroutineContext.cancel(); "stale status" },
        { fail("Cancelled read must not deliver.") },
        { fail("Cancelled read must not reject through a stale callback.") },
        { fail("Cancellation is not a callback failure.") },
      )
    }
    worker.join()
    assertTrue(worker.isCancelled)
  }

  @Test
  fun invalidationDuringReadDropsBothTerminalCallbacks() = runBlocking {
    var current = true
    MetaWearablesStatusSafety.deliverOnce(
      { current }, { current = false; "stale status" },
      { fail("Invalidated status must not deliver.") },
      { fail("Invalidated status must not reject through a stale callback.") },
      { fail("Invalidation must not report a callback error.") },
    )
  }

  @Test
  fun alreadyClosedBridgeDoesNotReadSdk() = runBlocking {
    MetaWearablesStatusSafety.deliverOnce(
      { false }, { fail("Closed bridge must not touch the SDK."); "status" },
      { fail("Closed bridge must not deliver.") },
      { fail("Closed bridge must not reject through a stale callback.") },
      { fail("Closed bridge must not report a callback error.") },
    )
  }
}
