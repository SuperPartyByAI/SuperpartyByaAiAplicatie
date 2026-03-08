import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:flutter/foundation.dart';
import 'auth_service.dart';

import 'supabase_service.dart';

class BackendService {
  static const String BASE_URL = 'https://wa.superparty.ro/api';  // WhatsApp Baileys backend (HTTPS)
  
  static const String VOICE_BASE_URL = 'https://voice.superparty.ro/api';

  static const String AI_MANAGER_URL = 'http://89.167.123.174:3002'; // Geofence & Logistics

  String get baseUrl => BASE_URL;
  String get voiceBaseUrl => VOICE_BASE_URL;
  String get aiManagerUrl => AI_MANAGER_URL;

  static const String SUPABASE_API_URL = 'https://europe-west1-superparty-frontend.cloudfunctions.net/api';
  // static const String BASE_URL = 'http://127.0.0.1:3000/api'; // Debugging Local Fixes 
  
  final AuthService _authService;

  BackendService(this._authService);

  /// Extract X-Request-Id from response headers and set as Crashlytics custom key
  void _extractRequestId(http.Response response) {
    final requestId = response.headers['x-request-id'];
    if (requestId != null && requestId.isNotEmpty) {
      debugPrint('[Backend] X-Request-Id: $requestId');
    }
  }

  Future<Map<String, String>> _getHeaders() async {
    final token = await _authService.getIdToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  // --- Account Management ---

  Future<List<dynamic>> getAccounts() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/wa-accounts'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error fetching accounts: $e');
    }
    return [];
  }

  Future<Map<String, dynamic>> checkQrStatus(String accountId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/accounts/$accountId/qr'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error checking QR: $e');
    }
    return {};
  }

  Future<void> createAccount(String label) async {
    try {
      final headers = await _getHeaders();
      await http.post(
        Uri.parse('$BASE_URL/wa-accounts'),
        headers: headers,
        body: jsonEncode({'label': label}),
      );
    } catch (e) {
      debugPrint('Error creating account: $e');
      rethrow;
    }
  }

  Future<void> regenerateQR(String accountId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('$BASE_URL/accounts/$accountId/regenerate-qr'),
        headers: headers,
      );
      if (response.statusCode != 200) {
        throw Exception('Failed to regenerate QR: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('Error regenerating QR: $e');
      rethrow;
    }
  }

  // --- Conversations & Messages ---

  Future<List<dynamic>> getConversations() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/conversations'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error fetching conversations: $e');
    }
    return [];
  }

  Future<String?> getSignedMediaUrl(String conversationId, String messageId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(
        Uri.parse('$BASE_URL/media/url/$conversationId/$messageId'),
        headers: headers,
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['url'] as String?;
      }
    } catch (e) {
      debugPrint('Error fetching signed media url: $e');
    }
    return null;
  }

  Future<List<dynamic>> getMessages(String conversationId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/conversations/$conversationId/messages'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error fetching messages: $e');
    }
    return [];
  }

  Future<void> sendMessage(String conversationId, String text) async {
    try {
      final headers = await _getHeaders();
      debugPrint('DEBUG: sendMessage POST to $BASE_URL/conversations/$conversationId/messages');
      
      final response = await http.post(
        Uri.parse('$BASE_URL/conversations/$conversationId/messages'),
        headers: headers,
        body: jsonEncode({'text': text}),
      );

      debugPrint('DEBUG: sendMessage status=${response.statusCode} body=${response.body}');

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('HTTP ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      debugPrint('DEBUG: Error sending message (client): $e');
      rethrow;
    }
  }

  /// Send a media file (image/video/document) to a WhatsApp contact.
  /// [conversationId] format: accountId_jid (e.g. "abc123_40712345678@s.whatsapp.net")
  /// [filePath] absolute path to local file
  /// [mimeType] e.g. "image/jpeg"
  /// [caption] optional text caption
  Future<void> sendMediaMessage(String conversationId, String filePath, String mimeType, {String? caption}) async {
    try {
      // Extract JID from conversationId: "accountId_jid" → "jid"
      final parts = conversationId.split('_');
      final jid = parts.length > 1 ? parts.sublist(1).join('_') : conversationId;

      final base = BASE_URL.replaceFirst('/api', '');
      final uri = Uri.parse('$base/messages/$jid/media');
      debugPrint('DEBUG: sendMediaMessage POST to $uri');

      final request = http.MultipartRequest('POST', uri);

      // Determine type from MIME
      String type = 'document';
      if (mimeType.startsWith('image/')) type = 'image';
      if (mimeType.startsWith('video/')) type = 'video';
      if (mimeType.startsWith('audio/')) type = 'audio';

      request.fields['type'] = type;
      if (caption != null && caption.isNotEmpty) {
        request.fields['caption'] = caption;
      }
      request.files.add(await http.MultipartFile.fromPath('file', filePath, contentType: MediaType.parse(mimeType)));

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      debugPrint('DEBUG: sendMediaMessage status=${response.statusCode} body=${response.body}');

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('HTTP ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      debugPrint('DEBUG: Error sending media (client): $e');
      rethrow;
    }
  }

  /// Open or create a conversation for a phone number on a specific account.
  /// Returns the conversationId to navigate to ChatDetailScreen.
  Future<String> openConversation(String phone, String accountId, {String? label}) async {
    try {
      final headers = await _getHeaders();
      debugPrint('DEBUG: openConversation POST to $BASE_URL/conversations phone=$phone accountId=$accountId');

      final response = await http.post(
        Uri.parse('$BASE_URL/conversations'),
        headers: headers,
        body: jsonEncode({
          'phone': phone,
          'accountId': accountId,
          'label': label,
        }),
      );

      debugPrint('DEBUG: openConversation status=${response.statusCode} body=${response.body}');

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('HTTP ${response.statusCode}: ${response.body}');
      }

      final data = jsonDecode(response.body);
      return data['conversationId'] as String;
    } catch (e) {
      debugPrint('DEBUG: Error opening conversation: $e');
      rethrow;
    }
  }

  Future<void> assignConversation(String conversationId) async {
    try {
      final headers = await _getHeaders();
      // No body needed if self-assign, or pass employeeId
      await http.post(
        Uri.parse('$BASE_URL/conversations/$conversationId/assign'),
        headers: headers,
        body: jsonEncode({}), 
      );
    } catch (e) {
      debugPrint('Error assigning conversation: $e');
      rethrow;
    }
  }

  Future<bool> acceptPbxCall(String callSid, String clientIdentity) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('$voiceBaseUrl/voice/accept'),
        headers: headers,
        body: jsonEncode({
          'callSid': callSid,
          'clientIdentity': clientIdentity,
        }),
      );
      if (response.statusCode == 200 || response.statusCode == 201) {
        debugPrint('[BackendService] /api/voice/accept success for $callSid');
        return true;
      } else {
        debugPrint('[BackendService] /api/voice/accept failed: ${response.statusCode} - ${response.body}');
        return false;
      }
    } catch (e) {
      debugPrint('[BackendService] acceptPbxCall error: $e');
      return false;
    }
  }
  // --- Employee Authentication & Approval ---

  Future<void> requestEmployeeAccess(String displayName, String phone) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('$BASE_URL/employees/request'),
        headers: headers,
        body: jsonEncode({
          'displayName': displayName,
          'phone': phone,
        }),
      );

      if (response.statusCode != 200) {
        throw Exception('Failed to request access: ${response.body}');
      }
    } catch (e) {
      debugPrint('Error requesting access: $e');
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getMyStatus() async {
    try {
      final email = _authService.currentUser?.email;
      debugPrint('[getMyStatus] email=$email');
      if (email == null) return {};
      
      final rows = await SupabaseService.select('employees', filters: {'email': 'eq.$email'}, limit: 1)
          .timeout(const Duration(seconds: 4));
      debugPrint('[getMyStatus] got ${rows.length} rows');
      if (rows.isNotEmpty) {
        final row = rows.first;
        return {
          'status': row['status'],
          'role': row['role'],
          'approved': row['status'] == 'active',
        };
      }
      return {'status': 'not_found'};
    } catch (e) {
      debugPrint('[getMyStatus] Error: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> registerDevice(String deviceId, String fcmToken) async {
    final uid = _authService.currentUser?.id;
    if (uid == null) throw Exception('Cannot register device: user not logged in.');
    
    final url = Uri.parse('$VOICE_BASE_URL/voice/registerDevice');
    try {
      final headers = await _getHeaders();
      final body = jsonEncode({
        'userId': uid,
        'deviceId': deviceId,
        'fcmToken': fcmToken,
      });
      final response = await http.post(url, headers: headers, body: body);
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to register device: ${response.statusCode} - ${response.body}');
      }
    } catch (e) {
      throw Exception('Error registering device: $e');
    }
  }

  Future<Map<String, dynamic>> getVoipTokenForDevice(String deviceId) async {
    final uid = _authService.currentUser?.id;
    if (uid == null) throw Exception('Cannot fetch VoIP token: user not logged in.');
    
    final url = Uri.parse('$VOICE_BASE_URL/voice/getVoipToken?userId=$uid&deviceId=$deviceId');
    try {
      final headers = await _getHeaders();
      final response = await http.get(url, headers: headers);
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to load VoIP token: ${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error fetching VoIP token: $e');
    }
  }

  // --- Admin Methods ---

  Future<List<dynamic>> getEmployees() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/employees'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error getting employees: $e');
    }
    return [];
  }

  Future<List<dynamic>> getPendingRequests() async {
    try {
      final headers = await _getHeaders();
      debugPrint('DEBUG: getPendingRequests -> GET $BASE_URL/employees/requests');
      // Adăugăm timeout de 10s și debug detailat
      debugPrint('DEBUG: headers: ${headers.keys.toList()}');
      final response = await http.get(Uri.parse('$BASE_URL/employees/requests'), headers: headers);
      
      debugPrint('DEBUG: getPendingRequests status=${response.statusCode} body=${response.body.substring(0, response.body.length > 200 ? 200 : response.body.length)}');
      if (response.statusCode == 200) {
        var data = jsonDecode(response.body);
        debugPrint('DEBUG: getPendingRequests parsed ${data.length} items');
        return data as List<dynamic>;
      } else {
        debugPrint('DEBUG: getPendingRequests failed: ${response.statusCode} ${response.body}');
      }
    } catch (e) {
      debugPrint('Error getting requests: $e');
    }
    return [];
  }

  Future<void> approveEmployee(String uid) async {
    final headers = await _getHeaders();
    final response = await http.post(Uri.parse('$BASE_URL/employees/$uid/approve'), headers: headers);
    if (response.statusCode != 200) throw Exception('Failed to approve employee');
  }

  Future<void> rejectEmployee(String uid) async {
    final headers = await _getHeaders();
    final response = await http.post(Uri.parse('$BASE_URL/employees/$uid/reject'), headers: headers);
    if (response.statusCode != 200) throw Exception('Failed to reject employee');
  }

  Future<void> suspendEmployee(String uid) async {
    final headers = await _getHeaders();
    final response = await http.post(Uri.parse('$BASE_URL/employees/$uid/suspend'), headers: headers);
    if (response.statusCode != 200) throw Exception('Failed to suspend employee');
  }

  Future<List<dynamic>> getSuspendedEmployees() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/employees/suspended'), headers: headers);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error getting suspended employees: $e');
    }
    return [];
  }

  // --- Conversation Management ---

  Future<void> reserveConversation(String conversationId) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$BASE_URL/conversations/$conversationId/reserve'),
      headers: headers
    );
    if (response.statusCode != 200) {
       // Pass through error message from backend
       throw Exception(response.body);
    }
  }

  Future<void> unassignConversation(String conversationId) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$BASE_URL/conversations/$conversationId/unassign'),
      headers: headers
    );
    if (response.statusCode != 200) throw Exception(response.body);
  }

  /// Initiates an outbound call to the client identified by [conversationId].
  /// The backend resolves the real phone number server-side — the number is
  /// NEVER exposed to the Flutter app (PII isolation).
  Future<void> callClient(String conversationId) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$VOICE_BASE_URL/voice/call-client'),
      headers: headers,
      body: jsonEncode({'conversationId': conversationId}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('callClient failed: HTTP ${response.statusCode} — ${response.body}');
    }
    debugPrint('[BackendService] callClient initiated for conversationId=$conversationId');
  }


  Future<Map<String, dynamic>> getUserProfile() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(Uri.parse('$BASE_URL/user/me'), headers: headers).timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error getting user profile: $e');
    }
    return {};
  }

  Future<void> updateUserPhone(String phone) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$BASE_URL/user/phone'),
      headers: headers,
      body: jsonEncode({'phone': phone})
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to update phone: ${response.body}');
    }
  }

  Future<void> submitConsent(String version) async {
    final headers = await _getHeaders();
    final body = jsonEncode({
      'consentVersion': version,
      'userAgent': 'SuperParty App (Flutter)',
    });
    
    final response = await http.post(
      Uri.parse('$BASE_URL/user/consent'),
      headers: headers,
      body: body
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to submit consent: ${response.body}');
    }
  }

  Future<void> requestDeletion(String reason) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$BASE_URL/user/deletion-request'),
      headers: headers,
      body: jsonEncode({'reason': reason})
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to request deletion: ${response.body}');
    }
  }

  Future<void> updatePrivacySettings({required bool aiAnalysisEnabled}) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('$BASE_URL/user/privacy-settings'),
      headers: headers,
      body: jsonEncode({'aiAnalysisEnabled': aiAnalysisEnabled})
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to update privacy settings: ${response.body}');
    }
  }
}
