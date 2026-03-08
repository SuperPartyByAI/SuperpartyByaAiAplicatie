import 'package:flutter/foundation.dart';
import 'package:flutter_background_geolocation/flutter_background_geolocation.dart' as bg;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'backend_service.dart';

class BgGpsService {
  static final String _syncUrl = '${BackendService.AI_MANAGER_URL}/trips/locations';
  static final String _eventsUrl = '${BackendService.AI_MANAGER_URL}/trips/events';

  static bool _isInitializing = false;
  static bool _isStarting = false;

  /// Initializes the background location tracking with the TransistorSoft plugin.
  /// Needs to be called once when the user opens the app or logs in.
  static Future<void> initialize(String jwtToken, String employeeId) async {
    if (_isInitializing) {
      debugPrint('[BgGpsService] - initialize already in progress. Ignoring.');
      return;
    }
    _isInitializing = true;
    try {
    // Fired whenever a location is recorded
    bg.BackgroundGeolocation.onLocation((bg.Location location) {
      debugPrint('[BgGpsService] - onLocation: ${location.coords.latitude}, ${location.coords.longitude}');
    }, (bg.LocationError error) {
      debugPrint('[BgGpsService] - onLocation ERROR: $error');
    });

    // Fired whenever the plugin changes motion-state (stationary->moving and vice-versa)
    bg.BackgroundGeolocation.onMotionChange((bg.Location location) {
      debugPrint('[BgGpsService] - onMotionChange: isMoving=${location.isMoving}');
    });

    // NOU - Faza B2: Geofence Event Logic
    bg.BackgroundGeolocation.onGeofence((bg.GeofenceEvent event) async {
      debugPrint('[BgGpsService] - GEOFENCE CROSSED: ${event.identifier} (${event.action})');
      try {
        await http.post(
          Uri.parse(_eventsUrl),
          headers: {
            'Authorization': 'Bearer $jwtToken',
            'Content-Type': 'application/json'
          },
          body: jsonEncode({
            'employeeId': employeeId,
            'identifier': event.identifier,
            'action': event.action, // ENTER, EXIT, DWELL
            'lat': event.location.coords.latitude,
            'lng': event.location.coords.longitude
          }),
        );
      } catch (e) {
        debugPrint('[BgGpsService] - Geofence Sync Error: $e');
      }
    });

    // Fired when the HTTP sync finishes
    bg.BackgroundGeolocation.onHttp((bg.HttpEvent event) {
      debugPrint('[BgGpsService] - onHttp status: ${event.status}');
    });

    // We store the employeeId in SharedPreferences or pass it via extras
    // For batching to work perfectly with Superparty AI, we format the data via `httpData` or template
    
    await bg.BackgroundGeolocation.ready(bg.Config(
      desiredAccuracy: bg.Config.DESIRED_ACCURACY_HIGH,
      distanceFilter: 50.0, // meters before triggering new location
      stopOnTerminate: false, // Keep running after app is killed
      startOnBoot: true,      // Start automatically on boot
      debug: false,           // Set true for sounds/notifications during debug
      logLevel: bg.Config.LOG_LEVEL_INFO,
      
      // HTTP / SQLite Auto-Sync (Batching)
      url: _syncUrl,
      batchSync: true,       // Send an array of locations
      autoSync: true,        // Automatically send when there is a network connection
      autoSyncThreshold: 3,  // sync when we have 3 points
      maxBatchSize: 50,      // max points per batch
      headers: {
        'Authorization': 'Bearer $jwtToken',
        'Content-Type': 'application/json'
      },
      // Transform TransistorSoft's massive JSON into the lean JSON required by POST /trips/locations
      locationTemplate: '{ "lat":<%= latitude %>, "lng":<%= longitude %>, "accuracyMeters":<%= accuracy %>, "speedKmh":<%= speed %>, "recordedAt":"<%= timestamp %>", "employeeId":"$employeeId", "tripId": null }',
      httpRootProperty: 'locations'
    ));

    // NOU: Înscriere Geofence fix(Sediu Principal) - Raza de 150m
    await bg.BackgroundGeolocation.addGeofence(bg.Geofence(
      identifier: 'SEDIU_SUPERPARTY',
      radius: 150,
      latitude: 44.4396, // TODO: Replace cu locația reală sediu
      longitude: 26.0963, 
      notifyOnEntry: true,
      notifyOnExit: true,
      notifyOnDwell: true,
      loiteringDelay: 60000 // 1 minut de staționare = Dwell
    ));
    
    debugPrint('[BgGpsService] - Initialization complete. Geofences loaded.');
    } finally {
      _isInitializing = false;
    }
  }

  /// Start tracking (e.g. at shift start or login)
  static Future<void> startTracking() async {
    if (_isStarting) {
      debugPrint('[BgGpsService] - startTracking already in progress. Ignoring.');
      return;
    }
    _isStarting = true;
    try {
      final state = await bg.BackgroundGeolocation.state;
      if (!state.enabled) {
        await bg.BackgroundGeolocation.start();
        debugPrint('[BgGpsService] - Tracking started.');
      } else {
        debugPrint('[BgGpsService] - Tracking already enabled.');
      }
    } catch (e) {
      debugPrint('[BgGpsService] - startTracking error: $e');
      rethrow;
    } finally {
      _isStarting = false;
    }
  }

  /// Stop tracking (e.g. at shift end or logout)
  static Future<void> stopTracking() async {
    await bg.BackgroundGeolocation.stop();
    debugPrint('[BgGpsService] - Tracking stopped.');
  }

  /// Updates the template config dynamically when a trip starts or ends.
  static Future<void> updateTripContext(String employeeId, String? tripId) async {
    final tIdstr = tripId != null ? '"$tripId"' : 'null';
    await bg.BackgroundGeolocation.setConfig(bg.Config(
      locationTemplate: '{ "lat":<%= latitude %>, "lng":<%= longitude %>, "accuracyMeters":<%= accuracy %>, "speedKmh":<%= speed %>, "recordedAt":"<%= timestamp %>", "employeeId":"$employeeId", "tripId": $tIdstr }',
    ));
    debugPrint('[BgGpsService] - Trip Context Updated: $tripId');
  }
}
