# Flutter specific rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.common.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Twilio Voice
-keep class com.twilio.voice.** { *; }
-keep class com.twilio.** { *; }

# Supabase Messaging
-keep class com.google.supabase.** { *; }

# Keep generic classes used by reflection
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Fix for Play Core / Google Fonts
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**

# WebRTC (Twilio Voice depends on it)
-keep class org.webrtc.** { *; }
-keepnames class org.webrtc.**
-dontwarn org.webrtc.**

# Unele build-uri Twilio/WebRTC expun webrtc și sub tvi.webrtc
-keep class tvi.webrtc.** { *; }
-keepnames class tvi.webrtc.**
-dontwarn tvi.webrtc.**

# Twilio AudioSwitch (folosit pentru rutare audio / device enumeration)
-keep class com.twilio.audioswitch.** { *; }
-dontwarn com.twilio.audioswitch.**

# Keep JNI native method bindings (prevents stripping symbols used by .so)
-keepclassmembers class * {
  native <methods>;
}

# Conservator: nu optimiza, nu obfusca, nu elimina cod (stop JNI SIGABRT la Huawei)
-dontshrink
-dontoptimize
-dontobfuscate

# Suprima warning-uri din dependinte tranzitive (Apache Tika / XML)
-dontwarn javax.xml.stream.**
-dontwarn org.apache.tika.**
