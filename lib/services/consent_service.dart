import 'package:shared_preferences/shared_preferences.dart';

class ConsentService {
  static const String _consentKey = 'user_consent_given';

  static Future<bool> isConsentGiven() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_consentKey) ?? false;
  }

  static Future<void> setConsent(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_consentKey, value);
  }
}
