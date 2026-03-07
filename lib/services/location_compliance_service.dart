import 'package:flutter/foundation.dart';
import 'package:flutter_background_geolocation/flutter_background_geolocation.dart' as bg;
import 'package:permission_handler/permission_handler.dart';

class LocationComplianceResult {
  final bool isCompliant;
  final List<String> reasons;

  LocationComplianceResult({required this.isCompliant, required this.reasons});
}

class LocationComplianceService {
  static Future<LocationComplianceResult> checkCompliance() async {
    List<String> reasons = [];

    // 1. Check Location Services (GPS)
    var serviceStatus = await Permission.location.serviceStatus;
    if (!serviceStatus.isEnabled) {
      reasons.add('GPS / Location Services is OFF.');
    }

    // 2. Check Permission Always
    var alwaysStatus = await Permission.locationAlways.status;
    if (!alwaysStatus.isGranted) {
      // Trying to check if at least WhileInUse is granted. If not, we definitely don't have Always.
      var whenInUse = await Permission.location.status;
      if (!whenInUse.isGranted) {
        reasons.add('Permisiunea principală de locație lipsește.');
      }
      reasons.add('Lipsă permisiune "Permite întotdeauna" / "Allow all the time".');
    }

    // 3. Check BackgroundGeolocation state
    try {
      var bgState = await bg.BackgroundGeolocation.state;
      if (!bgState.enabled) {
        // Attempt to turn it back on gracefully
        await bg.BackgroundGeolocation.start();
        var newState = await bg.BackgroundGeolocation.state;
        if (!newState.enabled) {
          reasons.add('Plugin-ul de fundal GPS (BackgroundGeolocation) este oprit și nu a putut fi pornit.');
        }
      }
    } catch (e) {
      reasons.add('Eroare internă modul GPS: $e');
    }

    bool isCompliant = reasons.isEmpty;
    if (!isCompliant) {
      debugPrint('[LocationComplianceService] GPS gate failed: $reasons');
    }

    return LocationComplianceResult(isCompliant: isCompliant, reasons: reasons);
  }
}
