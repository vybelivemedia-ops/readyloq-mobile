package com.hgwashingllc.readyloqmobile

import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class MetaWearablesInitializationGateTest {
  @Test
  fun deniedPermissionNeverCallsSdk() {
    val gate = MetaWearablesInitializationGate()
    assertFalse(gate.runAfterBluetoothPermission(false) { fail("SDK must not run before grant.") })
    assertFalse(gate.attempted)
  }

  @Test
  fun laterGrantAfterDenialInitializesOnce() {
    val gate = MetaWearablesInitializationGate()
    var calls = 0
    gate.runAfterBluetoothPermission(false) { calls++ }
    assertTrue(gate.runAfterBluetoothPermission(true) { calls++ })
    assertFalse(gate.runAfterBluetoothPermission(true) { calls++ })
    assertEquals(1, calls)
    assertTrue(gate.attempted)
  }

  @Test
  fun recreatedActivitiesAndRepeatedResultsShareOneAttempt() {
    val processGate = MetaWearablesInitializationGate()
    var calls = 0
    repeat(4) { processGate.runAfterBluetoothPermission(true) { calls++ } }
    assertEquals(1, calls)
  }

  @Test
  fun sdkReentryCannotInitializeTwice() {
    val gate = MetaWearablesInitializationGate()
    var calls = 0
    gate.runAfterBluetoothPermission(true) {
      calls++
      assertFalse(gate.runAfterBluetoothPermission(true) { calls++ })
    }
    assertEquals(1, calls)
  }

  @Test
  fun failedSdkAttemptCannotBeRepeatedByAnotherActivity() {
    val gate = MetaWearablesInitializationGate()
    var calls = 0
    try {
      gate.runAfterBluetoothPermission(true) {
        calls++
        throw NoClassDefFoundError("DAT")
      }
      fail("Test SDK failure must propagate to the caller's existing error guard.")
    } catch (_: LinkageError) {
      // The activity contains this failure; the process guard remains claimed.
    }
    assertFalse(gate.runAfterBluetoothPermission(true) { calls++ })
    assertEquals(1, calls)
  }

  @Test
  fun concurrentGrantedCallbacksCannotInitializeTwice() {
    val gate = MetaWearablesInitializationGate()
    val start = CountDownLatch(1)
    val calls = AtomicInteger()
    val threads = List(4) {
      Thread {
        start.await()
        gate.runAfterBluetoothPermission(true) { calls.incrementAndGet() }
      }.also { it.start() }
    }
    start.countDown()
    threads.forEach { it.join(2000); assertFalse("Callback must finish.", it.isAlive) }
    assertEquals(1, calls.get())
  }
}
