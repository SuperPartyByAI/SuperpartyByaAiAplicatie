plugins {
    id("com.android.application")

    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services") // FCM for Twilio VoIP push
}

import java.util.Properties
import java.io.FileInputStream

android {
    namespace = "com.superpartybyai.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.superpartybyai.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    val keystoreProperties = Properties()
    val keystorePropertiesFile = rootProject.file("key.properties")
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(keystorePropertiesFile.inputStream())
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            ndk {
                debugSymbolLevel = "SYMBOL_TABLE"
            }
        }
    }

    // packaging {
    //    jniLibs {
    //        keepDebugSymbols.add("**/libflutter.so")
    //    }
    // }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")

    // Twilio Voice SDK — needed by CustomVoiceSupabaseMessagingService for
    // Voice.handleMessage(), CallInvite, MessageListener (root cause fix v41)
    // MUST match plugin version: twilio_voice 0.3.2+2 uses voice-android:6.9.0
    implementation("com.twilio:voice-android:6.9.0")
    // LocalBroadcastManager — needed to forward CallInvite events to Flutter plugin
    implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")

    // Firebase Messaging logic specifically needed for VoIP push on Android
    implementation("com.google.firebase:firebase-messaging:23.4.0")
}
