import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

class AiService {
  static final AiService _instance = AiService._internal();
  factory AiService() => _instance;
  AiService._internal();

  /// Constants for the actual deployed Cloud Functions V2 URLs
  static const String _generalUrl = 'https://europe-west1-superparty-frontend.cloudfunctions.net/chatWithAI';
  static const String _eventUrl = 'https://europe-west1-superparty-frontend.cloudfunctions.net/chatEventOpsV2';

  Future<String?> _getToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return null;
    return await user.getIdToken();
  }

  Future<Map<String, dynamic>> sendMessageToGeneralAI(String message, String sessionId) async {
    try {
      final token = await _getToken();
      
      final response = await http.post(
        Uri.parse(_generalUrl),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'data': {
            'messages': [
              {'role': 'user', 'content': message}
            ],
            'sessionId': sessionId,
          }
        }),
      ).timeout(const Duration(seconds: 180));

      return _decodeResponse(response, 'General');
    } catch (e) {
      debugPrint('[AI Service General] Unknown Error: $e');
      return {'message': 'A apărut o eroare necunoscută. Te rog să încerci din nou.'};
    }
  }

  Future<Map<String, dynamic>> sendMessageToEventAI(String message, String sessionId, {String? imageBase64, bool saveNow = false}) async {
    try {
      final token = await _getToken();
      
      final response = await http.post(
        Uri.parse(_eventUrl),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'data': {
            'text': message,
            'sessionId': sessionId,
            if (imageBase64 != null) 'image': imageBase64,
            if (saveNow) 'saveNow': true,
          }
        }),
      ).timeout(const Duration(seconds: 180));

      return _decodeResponse(response, 'Event');
    } catch (e) {
      debugPrint('[AI Service Event] Unknown Error: $e');
      return {'message': 'A apărut o eroare necunoscută de rețea. Verifică conexiunea.'};
    }
  }

  Map<String, dynamic> _decodeResponse(http.Response response, String logContext) {
    if (response.statusCode == 200) {
      try {
        final Map<String, dynamic> body = jsonDecode(response.body);
        // Firebase onCall standard wraps the response in a 'result' or 'data' field natively sometimes,
        // but since we are mirroring the exact structure, let's extract 'data' or 'result' if it exists.
        if (body.containsKey('result')) {
           return Map<String, dynamic>.from(body['result']);
        } else if (body.containsKey('data')) {
           return Map<String, dynamic>.from(body['data']);
        }
        return body;
      } catch (e) {
        debugPrint('[AI Service $logContext] JSON parse error: $e');
        return {'message': 'Sistemul a returnat un răspuns invalid.'};
      }
    } else {
      debugPrint('[AI Service $logContext] HTTP Error: ${response.statusCode} - ${response.body}');
      if (response.statusCode == 429) {
        return {'message': 'Ne pare rău, am atins limita de resurse pentru astăzi. Te rog să încerci din nou mai târziu. ⏳'};
      }
      return {'message': 'Eroare Server [HTTP ${response.statusCode}]'};
    }
  }
}
