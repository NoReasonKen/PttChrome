package io.github.abccbaandy.pttchrome

/** Device-local check policy, independent of the PTT session and UI lifetime. */
internal object UpdatePolicy {
    private const val DAY = 24 * 60 * 60 * 1000L
    private const val HOUR = 60 * 60 * 1000L

    fun checkDue(now: Long, lastSuccess: Long, lastFailure: Long,
        automatic: Boolean, development: Boolean, manual: Boolean): Boolean {
        if (manual) return true
        if (!automatic || development) return false
        return (lastSuccess <= 0 || now - lastSuccess >= DAY) &&
            (lastFailure <= 0 || now - lastFailure >= HOUR)
    }
}
