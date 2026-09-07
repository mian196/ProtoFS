plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.protofs.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.protofs.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.3.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")

    // AndroidX WorkManager for background sync
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Coroutines support
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
