import java.util.Properties
import java.net.URI

plugins {
    alias(libs.plugins.android.application)
}

// Release 簽章：CI 從 secrets 解出 keystore 並設環境變數；本機可放 android/keystore.properties
// （已 gitignore）。兩者都沒有 ⇒ release 不簽（只能出 debug APK）。
// 簽章必須固定：assetlinks.json（密碼共用）綁 SHA-256，換 key 使用者也無法覆蓋安裝。
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(prop)

val releaseStoreFile = signingValue("ANDROID_KEYSTORE_FILE", "storeFile")

// Test fixtures may compile a fixed loopback transport into a debug APK only.
val updateTestOrigin = System.getenv("ANDROID_UPDATE_TEST_ORIGIN").orEmpty().also { value ->
    if (value.isNotEmpty()) {
        val uri = URI(value)
        require(uri.scheme == "http" && uri.host in setOf("127.0.0.1", "localhost") &&
            uri.port in 1..65535 && uri.rawUserInfo == null && uri.rawQuery == null &&
            uri.rawFragment == null && uri.path.orEmpty().isEmpty()) {
            "ANDROID_UPDATE_TEST_ORIGIN must be an HTTP loopback origin with an explicit port."
        }
    }
}

android {
    namespace = "io.github.abccbaandy.pttchrome"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.noreasonken.pttchrome"
        minSdk = 26
        targetSdk = 37
        versionCode = (System.getenv("ANDROID_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("ANDROID_VERSION_NAME") ?: "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile)
                storeType = "PKCS12"
                storePassword = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("ANDROID_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        // Debug and release coexist; resources distinguish their names and cleartext policy.
        // Google sign-in and Digital Asset Links require each package/signing identity to be registered separately.
        debug {
            buildConfigField("String", "UPDATE_TEST_ORIGIN", "\"$updateTestOrigin\"")
            applicationIdSuffix = ".debug"
            versionNameSuffix = if (updateTestOrigin.isEmpty()) "-debug" else ""
        }
        release {
            buildConfigField("String", "UPDATE_TEST_ORIGIN", "\"\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseStoreFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.okhttp)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.fragment)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation(libs.junit)
}
