import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'bg_gps_service.dart';
import 'backend_service.dart';

class TripsApiService {
  static final String _baseUrl = '${BackendService.AI_MANAGER_URL}/trips';

  /// Starts a new trip for the current user.
  static Future<String?> startTrip() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('No active session.');
      final jwt = session.accessToken;
      final user = session.user;

      final response = await http.post(
        Uri.parse('$_baseUrl/start'),
        headers: {
          'Authorization': 'Bearer $jwt',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'employeeId': user.id,
        }),
      );

      if (response.statusCode == 201) {
        final data = jsonDecode(response.body);
        final tripId = data['trip']['id'] as String?;
        if (tripId != null) {
          // Save active trip ID locally
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('active_trip_id', tripId);
          await prefs.setString('active_trip_start', DateTime.now().toIso8601String());

          // Inform Background GPS system about the new trip ID
          await BgGpsService.updateTripContext(user.id, tripId);
        }
        return tripId;
      } else {
        debugPrint('[TripsApiService] Start Trip Failed: ${response.body}');
        return null;
      }
    } catch (e) {
      debugPrint('[TripsApiService] Exception at startTrip: $e');
      return null;
    }
  }

  /// Ends the currently active trip.
  static Future<bool> endTrip() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('No active session.');
      final jwt = session.accessToken;
      final user = session.user;

      final prefs = await SharedPreferences.getInstance();
      final activeTripId = prefs.getString('active_trip_id');

      if (activeTripId == null) {
        debugPrint('[TripsApiService] No active trip available to end locally.');
        return false;
      }

      final response = await http.post(
        Uri.parse('$_baseUrl/end'),
        headers: {
          'Authorization': 'Bearer $jwt',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'tripId': activeTripId,
        }),
      );

      if (response.statusCode == 200) {
        // Clear local storage
        await prefs.remove('active_trip_id');
        await prefs.remove('active_trip_start');

        // Reset the Background GPS config to null trip handling
        await BgGpsService.updateTripContext(user.id, null);
        return true;
      } else {
        debugPrint('[TripsApiService] End Trip Failed: ${response.body}');
        return false;
      }
    } catch (e) {
      debugPrint('[TripsApiService] Exception at endTrip: $e');
      return false;
    }
  }

  /// Checks if there is a currently active trip locally.
  static Future<Map<String, dynamic>?> getActiveTrip() async {
    final prefs = await SharedPreferences.getInstance();
    final activeTripId = prefs.getString('active_trip_id');
    final startTime = prefs.getString('active_trip_start');

    if (activeTripId != null && startTime != null) {
      return {
        'id': activeTripId,
        'started_at': startTime,
      };
    }
    return null;
  }

  // --- LOGISTICS & STAFF HOURS REVIEW INCORPORATED HERE ---

  /// Get pending AI penalites / candidates for admin review
  static Future<List<dynamic>> getPendingCandidates() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('No active session.');
      final jwt = session.accessToken;

      final url = '${BackendService.AI_MANAGER_URL}/logistics/staff-hours/candidates/pending';
      final response = await http.get(
        Uri.parse(url),
        headers: {
          'Authorization': 'Bearer $jwt',
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200) {
        final body = jsonDecode(response.body);
        if (body['ok'] == true && body['data'] != null) {
          return body['data'] as List<dynamic>;
        }
      }
      return [];
    } catch (e) {
      debugPrint('[TripsApiService] Exception at getPendingCandidates: $e');
      return [];
    }
  }

  /// Submit Human Review for an AI penalty
  static Future<bool> reviewCandidate(String candidateId, String reviewStatus, String? reviewerComment) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('No active session.');
      final jwt = session.accessToken;
      final userId = session.user.id;

      final url = '${BackendService.AI_MANAGER_URL}/logistics/staff-hours/review';
      final response = await http.post(
        Uri.parse(url),
        headers: {
          'Authorization': 'Bearer $jwt',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'candidateId': candidateId,
          'reviewStatus': reviewStatus, // 'approved' or 'rejected'
          'reviewerComment': reviewerComment ?? '',
          'approvedBy': userId,
        }),
      );

      return response.statusCode == 200;
    } catch (e) {
      debugPrint('[TripsApiService] Exception at reviewCandidate: $e');
      return false;
    }
  }
}
