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

# Firebase Messaging
-keep class com.google.firebase.** { *; }

# Keep generic classes used by reflection
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Fix for Play Core / Google Fonts
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
