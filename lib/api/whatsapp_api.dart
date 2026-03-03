import 'dart:convert';
import 'package:http/http.dart' as http;

class WhatsAppApi {
  // Use 10.0.2.2 for Android Emulator, 127.0.0.1 for iOS Simulator
  static const String BASE_URL = 'http://89.167.115.150:3000'; // Public Remote Server 

  Future<Map<String, dynamic>> checkStatus() async {
    try {
      final response = await http.get(Uri.parse('$BASE_URL/status')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      // ignore error, return empty
    }
    return {};
  }

  Future<List<dynamic>> fetchChats() async {
    try {
      final response = await http.get(Uri.parse('$BASE_URL/chats')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      // ignore
    }
    return [];
  }

  Future<Map<String, dynamic>> fetchMessages(String jid, {int limit = 50}) async {
    try {
      final response = await http.get(Uri.parse('$BASE_URL/messages/$jid?limit=$limit')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return {
          'data': json.decode(response.body),
          'raw': response.body // Return raw body for caching comparison
        };
      }
    } catch (e) {
      // ignore
    }
    return {'data': [], 'raw': ''};
  }

  Future<void> markAsRead(String jid) async {
    try {
      await http.post(Uri.parse('$BASE_URL/chats/$jid/read'));
    } catch (e) {
      // ignore
    }
  }

  Future<void> sendMessage(String jid, String text) async {
    await http.post(
      Uri.parse('$BASE_URL/messages/$jid'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'text': text}),
    );
  }
}
