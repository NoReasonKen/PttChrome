package io.github.abccbaandy.pttchrome

/** Production identity. Origin or application ID changes also require updated Digital Asset Links. */
object AppConfig {
    /** Shared reading page; web updates do not require reinstalling the APK. */
    const val PAGE_URL = "https://noreasonken.github.io/PttChrome/"

    /** The only production origin allowed to use the native bridge and local proxy. */
    const val PAGE_ORIGIN = "https://noreasonken.github.io"

    const val UPSTREAM_URL = "wss://ws.ptt.cc/bbs"

    /** PTT's gateway requires this upstream Origin independently of the reading page's origin. */
    const val UPSTREAM_ORIGIN = "https://term.ptt.cc"

    const val LOCAL_PATH_PREFIX = "/bbs/"
}
