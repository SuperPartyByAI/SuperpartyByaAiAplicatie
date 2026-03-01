/// VoipLogger — singleton ring-buffer that captures VoIP call timeline.
///
/// Usage:
///   VoipLogger.instance.log('answer() result=true');
///   VoipLogger.instance.logAuthError('supabase_auth/network-request-failed');
///   VoipLogger.instance.setLastCallSid('CAxxxxxxxx');
library voip_logger;

import 'dart:collection';
import 'dart:convert';
import 'package:flutter/foundation.dart';

class VoipLogEntry {
  final DateTime ts;
  final String tag;
  final String message;
  final Map<String, dynamic>? data;

  VoipLogEntry(this.tag, this.message, {this.data}) : ts = DateTime.now();

  Map<String, dynamic> toJson() => {
        'ts': ts.toIso8601String(),
        'tag': tag,
        'msg': message,
        if (data != null) 'data': data,
      };
}

class VoipLogger {
  VoipLogger._();
  static final instance = VoipLogger._();

  // Keep last 300 entries (circular buffer)
  final _entries = Queue<VoipLogEntry>();
  static const _maxEntries = 300;

  // Track last known callSid (from customParams / Twilio notifications)
  String? _lastCallSid;
  // Track last auth error (e.g. supabase_auth/network-request-failed)
  String? _lastAuthError;
  DateTime? _lastAuthErrorTs;

  // ─── Core log ─────────────────────────────────────────────────
  void log(String tag, String message, {Map<String, dynamic>? data}) {
    final entry = VoipLogEntry(tag, message, data: data);
    _entries.addFirst(entry);
    if (_entries.length > _maxEntries) _entries.removeLast();
    debugPrint('[VoipLog] [$tag] $message${data != null ? " | $data" : ""}');
  }

  // ─── Convenience helpers ───────────────────────────────────────
  void logCallInvite({required String from, required String to, String? callSid}) {
    if (callSid != null) _lastCallSid = callSid;
    log('INVITE', 'onCallInvite', data: {
      'from': from,
      'to': to,
      if (callSid != null) 'callSid': callSid,
    });
  }

  void logEvent(String event, {Map<String, dynamic>? extra}) {
    log('EVENT', event, data: extra);
  }

  void logAnswer({required bool? result, required int attempt}) {
    log('ANSWER', 'answer() attempt=$attempt result=$result',
        data: {'attempt': attempt, 'result': result});
  }

  void logAudioState({
    required bool audioFocusGranted,
    required bool speakerOn,
    required bool muted,
    String? mode,
  }) {
    log('AUDIO', 'audioState', data: {
      'audioFocusGranted': audioFocusGranted,
      'speakerOn': speakerOn,
      'muted': muted,
      if (mode != null) 'mode': mode,
    });
  }

  /// Call this whenever a Supabase Auth / network error is caught.
  void logAuthError(String errorCode, {String? details}) {
    _lastAuthError = errorCode;
    _lastAuthErrorTs = DateTime.now();
    log('AUTH_ERROR', errorCode, data: {
      'code': errorCode,
      if (details != null) 'details': details,
    });
  }

  /// Set the Twilio Call SID when available (from customParams or push data).
  void setLastCallSid(String sid) {
    _lastCallSid = sid;
    log('CALL_SID', 'setLastCallSid', data: {'callSid': sid});
  }

  // ─── Accessors ────────────────────────────────────────────────
  String? get lastCallSid => _lastCallSid;
  String? get lastAuthError => _lastAuthError;

  /// Returns all entries as a JSON-serializable list, newest first.
  List<Map<String, dynamic>> toList() =>
      _entries.map((e) => e.toJson()).toList();

  // ─── Payload builder ──────────────────────────────────────────
  /// Full diagnostic JSON payload for upload.
  Map<String, dynamic> buildDiagPayload({
    required String buildVersion,
    required String deviceModel,
    required String osVersion,
    required String userIdentity,
    String? fcmTokenHash,
    bool voipRegistered = false,
    Map<String, dynamic>? permissions,
    Map<String, dynamic>? channelInfo,
    bool? dndOff,
  }) {
    return {
      'ts': DateTime.now().toIso8601String(),
      'build': buildVersion,
      'device': deviceModel,
      'os': osVersion,
      'user': userIdentity,
      if (fcmTokenHash != null) 'fcmHash': fcmTokenHash,
      'voipRegistered': voipRegistered,
      if (permissions != null) 'permissions': permissions,
      if (channelInfo != null) 'channelInfo': channelInfo,
      if (dndOff != null) 'dndOff': dndOff,
      // Twilio Call SID (for cross-referencing with Twilio Call Inspector)
      'voip': {
        'lastCallSid': _lastCallSid,
      },
      // Network/auth error tracking
      'network': {
        if (_lastAuthError != null) 'lastAuthError': _lastAuthError,
        if (_lastAuthErrorTs != null) 'lastAuthErrorTs': _lastAuthErrorTs!.toIso8601String(),
      },
      'timeline': toList(),
    };
  }

  void clear() => _entries.clear();

  String toJsonString() => jsonEncode(toList());
}
