import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/foundation.dart';

/// Supabase native client wrapper
class SupabaseService {
  static Future<void> initialize() async {}

  static SupabaseClient get _client => Supabase.instance.client;

  /// SELECT rows from a table.
  static Future<List<Map<String, dynamic>>> select(
    String table, {
    String select = '*',
    Map<String, String>? filters,
    String? order,
    int limit = 500,
  }) async {
    try {
      var query = _client.from(table).select(select);
      
      if (filters != null) {
        PostgrestFilterBuilder<List<Map<String, dynamic>>> filterQuery = query;
        filters.forEach((key, value) {
          if (value.startsWith('eq.')) {
            filterQuery = filterQuery.eq(key, value.substring(3));
          } else if (value.startsWith('like.')) {
            filterQuery = filterQuery.ilike(key, value.substring(5).replaceAll('*', '%'));
          } else if (value.startsWith('gt.')) {
            filterQuery = filterQuery.gt(key, value.substring(3));
          }
        });
        query = filterQuery;
      }
      
      var transformQuery = query.limit(limit);

      if (order != null) {
        final parts = order.split('.');
        final column = parts[0];
        final ascending = parts.length > 1 ? parts[1] == 'asc' : true;
        final nullsFirst = parts.length > 2 ? parts[2] == 'nullsfirst' : false;
        transformQuery = transformQuery.order(column, ascending: ascending, nullsFirst: nullsFirst);
      }

      final response = await transformQuery;
      return List<Map<String, dynamic>>.from(response);
    } catch(e, stack) {
      debugPrint('Supabase SDK Error: $e\n$stack');
      rethrow;
    }
  }

  /// GET a single row by id.
  static Future<Map<String, dynamic>?> getById(
    String table, {
    required String id,
    String select = '*',
  }) async {
    try {
      final response = await _client.from(table).select(select).eq('id', id).limit(1);
      final rows = List<Map<String, dynamic>>.from(response);
      return rows.isEmpty ? null : rows.first;
    } catch (e) {
      return null;
    }
  }

  /// Get messages for a conversation ordered oldest-first for display.
  static Future<List<Map<String, dynamic>>> getMessages(
    String conversationId, {
    int limit = 200,
  }) async {
    final value = '%$conversationId%';
    try {
      final response = await _client
          .from('messages')
          .select('id,conversation_id,text,from_me,timestamp,type,media_url,mimetype,push_name')
          .ilike('conversation_id', value)
          .order('timestamp', ascending: true)
          .limit(limit);
      return List<Map<String, dynamic>>.from(response);
    } catch (e, stack) {
      debugPrint('Supabase getMessages Error: $e\n$stack');
      rethrow;
    }
  }

  /// UPSERT rows into a table.
  static Future<void> upsert(
    String table,
    List<Map<String, dynamic>> rows, {
    String onConflict = 'id',
  }) async {
    try {
      await _client
          .from(table)
          .upsert(rows, onConflict: onConflict);
    } catch (e) {
      throw Exception('Supabase SDK upsert error: $e');
    }
  }
}
