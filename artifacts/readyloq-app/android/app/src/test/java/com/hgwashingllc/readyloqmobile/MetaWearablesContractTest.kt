package com.hgwashingllc.readyloqmobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MetaWearablesContractTest {
  private fun snapshot(
    registration: String = "REGISTERED",
    permission: String? = "GRANTED",
    devices: Int = 1,
    session: String = "STARTED",
    stream: String = "STREAMING",
  ) = MetaWearablesSnapshot(registration, permission, devices, session, stream)

  @Test
  fun `registered authorized device can capture only after stream starts`() {
    assertFalse(MetaWearablesContract.canCapture(snapshot(stream = "STARTING")))
    assertTrue(MetaWearablesContract.canCapture(snapshot()))
  }

  @Test
  fun `denied camera permission and unavailable device cannot create session`() {
    assertFalse(MetaWearablesContract.canStartSession(snapshot(permission = "DENIED")))
    assertFalse(MetaWearablesContract.canStartSession(snapshot(devices = 0)))
  }

  @Test
  fun `capture delivery accepts only real local file paths`() {
    assertTrue(MetaWearablesContract.isSafeCaptureFile("file:///cache/meta.jpg"))
    assertFalse(MetaWearablesContract.isSafeCaptureFile(""))
    assertFalse(MetaWearablesContract.isSafeCaptureFile("https://example.invalid/meta.jpg"))
  }
}