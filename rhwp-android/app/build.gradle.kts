import java.util.Properties

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

// 서명 비밀번호는 Git에 넣지 않고 로컬 전용 파일에서 읽는다.
val signing = Properties().apply {
    val file = rootProject.file(".local/signing.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}

android {
    namespace = "io.github.trayate_lang.rhwp"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.github.trayate_lang.rhwp"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    if (signing.isNotEmpty()) signingConfigs.create("personal") {
        storeFile = rootProject.file(signing.getProperty("storeFile"))
        storePassword = signing.getProperty("storePassword")
        keyAlias = signing.getProperty("keyAlias")
        keyPassword = signing.getProperty("keyPassword")
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release {
            isMinifyEnabled = false
            if (signing.isNotEmpty()) signingConfig = signingConfigs.getByName("personal")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    androidResources { noCompress += "wasm" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/studioAssets"))
    testOptions { unitTests.isIncludeAndroidResources = true }
    lint { abortOnError = true }
}

// 웹 산출물은 Git에 복사하지 않고 빌드할 때 APK 자산으로 옮긴다.
val bundleStudio by tasks.registering(Sync::class) {
    from("../../rhwp-studio/dist") { into("studio") }
    from("../../LICENSE") { into("legal"); rename { "rhwp-MIT.txt" } }
    from("../../THIRD_PARTY_LICENSES.md") { into("legal") }
    into(layout.buildDirectory.dir("generated/studioAssets"))
    doFirst {
        check(file("../../rhwp-studio/dist/rhwp_bg.wasm").isFile) {
            "오프라인 엔진이 없습니다. rhwp-android/scripts/build-web.sh부터 실행하세요."
        }
    }
}
tasks.named("preBuild").configure { dependsOn(bundleStudio) }

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
