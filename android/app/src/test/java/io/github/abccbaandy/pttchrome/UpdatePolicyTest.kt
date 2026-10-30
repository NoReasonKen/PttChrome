package io.github.abccbaandy.pttchrome

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatePolicyTest {
    @Test fun automaticChecksWaitAfterFailureButManualChecksRemainAvailable() {
        val now = 10_000_000L
        assertFalse(UpdatePolicy.checkDue(now, lastSuccess = 0, lastFailure = now - 3_599_999,
            automatic = true, development = false, manual = false))
        assertTrue(UpdatePolicy.checkDue(now, lastSuccess = 0, lastFailure = now - 3_599_999,
            automatic = true, development = false, manual = true))
    }
}
