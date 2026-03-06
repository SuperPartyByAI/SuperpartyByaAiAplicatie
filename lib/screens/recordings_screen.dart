import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

const String _REC_BASE = 'https://wa.superparty.ro/api';

class RecordingsScreen extends StatefulWidget {
  const RecordingsScreen({super.key});

  @override
  State<RecordingsScreen> createState() => _RecordingsScreenState();
}

class _RecordingsScreenState extends State<RecordingsScreen> {
  final AudioPlayer _player = AudioPlayer();
  List<Map<String, dynamic>> _recordings = [];
  bool _loading = true;
  String? _error;

  // Currently playing state
  String? _playingCallSid;
  bool _isPlaying = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    _loadRecordings();

    _player.onPlayerStateChanged.listen((s) {
      if (mounted) setState(() => _isPlaying = s == PlayerState.playing);
    });
    _player.onDurationChanged.listen((d) {
      if (mounted) setState(() => _duration = d);
    });
    _player.onPositionChanged.listen((p) {
      if (mounted) setState(() => _position = p);
    });
    _player.onPlayerComplete.listen((_) {
      if (mounted) setState(() {
        _isPlaying = false;
        _position = Duration.zero;
      });
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async =>
      await Future.value(Supabase.instance.client.auth.currentSession?.accessToken);

  Future<void> _loadRecordings() async {
    setState(() { _loading = true; _error = null; });
    try {
      final token = await _getToken();
      final res = await http.get(
        Uri.parse('$_REC_BASE/voice/calls?limit=200'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 12));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final all = (data['calls'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
        // Keep only calls with recordings
        final recs = all
            .where((c) =>
                (c['recordingUrl'] as String?)?.isNotEmpty == true &&
                (c['status'] as String?) == 'completed')
            .toList();
        setState(() { _recordings = recs; _loading = false; });
      } else {
        setState(() { _error = 'Eroare server: ${res.statusCode}'; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String _proxyUrl(String recordingUrl) {
    final reSid = RegExp(r'Recordings/(RE[a-zA-Z0-9]+)');
    final match = reSid.firstMatch(recordingUrl);
    if (match != null) {
      return '$_REC_BASE/voice/recording/${match.group(1)}';
    }
    return recordingUrl;
  }

  Future<void> _playOrPause(Map<String, dynamic> call) async {
    final sid = call['callSid'] as String? ?? call['id'] as String? ?? '';
    final url = call['recordingUrl'] as String? ?? '';
    if (url.isEmpty) return;

    if (_playingCallSid == sid) {
      // Same track — toggle play/pause
      if (_isPlaying) {
        await _player.pause();
      } else {
        await _player.resume();
      }
    } else {
      // New track — stop current, start new
      await _player.stop();
      setState(() {
        _playingCallSid = sid;
        _position = Duration.zero;
        _duration = Duration.zero;
      });
      await _player.play(UrlSource(_proxyUrl(url)));
    }
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String _formatCaller(String? from) {
    if (from == null || from.isEmpty) return 'Necunoscut';
    return from
        .replaceFirst('client:', '')
        .replaceFirst(RegExp(r'^\+?40'), '0');
  }

  String _formatDate(dynamic ts) {
    if (ts == null) return '—';
    try {
      final dt = DateTime.parse(ts.toString()).toLocal();
      return DateFormat('dd MMM yyyy  HH:mm').format(dt);
    } catch (_) {
      return ts.toString();
    }
  }

  String _fmtDuration(dynamic sec) {
    final s = (sec is int ? sec : int.tryParse('$sec') ?? 0);
    if (s <= 0) return '—';
    final m = s ~/ 60;
    final r = s % 60;
    return m > 0 ? '${m}m ${r}s' : '${r}s';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      appBar: AppBar(
        title: Text(
          'Înregistrări (${_recordings.length})',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF1F2937),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loadRecordings,
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Player persistent la baza listei ──────────────────────────
          if (_playingCallSid != null) _buildPlayer(),

          // ── Lista înregistrărilor ─────────────────────────────────────
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF10B981)))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error_outline, color: Colors.red, size: 48),
                            const SizedBox(height: 12),
                            Text(_error!, style: const TextStyle(color: Colors.white70)),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _loadRecordings,
                              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                              child: const Text('Reîncearcă'),
                            ),
                          ],
                        ),
                      )
                    : _recordings.isEmpty
                        ? const Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.mic_off, color: Colors.white38, size: 64),
                                SizedBox(height: 12),
                                Text('Nicio înregistrare disponibilă',
                                    style: TextStyle(color: Colors.white54, fontSize: 16)),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _loadRecordings,
                            color: const Color(0xFF10B981),
                            child: ListView.separated(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              itemCount: _recordings.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(color: Color(0xFF374151), height: 1),
                              itemBuilder: (context, i) {
                                final call = _recordings[i];
                                final sid = call['callSid'] as String? ?? call['id'] as String? ?? '';
                                final isActive = _playingCallSid == sid;
                                final from = call['from'] as String? ?? '';
                                final duration = call['recordingDuration'] ?? call['duration'];

                                return Container(
                                  color: isActive
                                      ? const Color(0xFF10B981).withOpacity(0.12)
                                      : const Color(0xFF1F2937),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.symmetric(
                                        horizontal: 16, vertical: 6),
                                    leading: GestureDetector(
                                      onTap: () => _playOrPause(call),
                                      child: CircleAvatar(
                                        backgroundColor: isActive
                                            ? const Color(0xFF10B981)
                                            : const Color(0xFF374151),
                                        child: Icon(
                                          isActive && _isPlaying
                                              ? Icons.pause
                                              : Icons.play_arrow,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                    title: Text(
                                      _formatCaller(from),
                                      style: TextStyle(
                                        color: isActive
                                            ? const Color(0xFF10B981)
                                            : Colors.white,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15,
                                      ),
                                    ),
                                    subtitle: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const SizedBox(height: 2),
                                        Text(
                                          _formatDate(call['timestamp']),
                                          style: const TextStyle(
                                              color: Colors.white54, fontSize: 12),
                                        ),
                                        const SizedBox(height: 2),
                                        Row(
                                          children: [
                                            const Icon(Icons.mic, size: 12, color: Color(0xFF10B981)),
                                            const SizedBox(width: 4),
                                            Text(
                                              _fmtDuration(duration),
                                              style: const TextStyle(
                                                  color: Colors.white38, fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    isThreeLine: true,
                                    onTap: () => _playOrPause(call),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildPlayer() {
    final progress = _duration.inSeconds > 0
        ? (_position.inSeconds / _duration.inSeconds).clamp(0.0, 1.0)
        : 0.0;

    // Find the currently playing call for display
    final currentCall = _recordings.firstWhere(
      (c) => (c['callSid'] ?? c['id']) == _playingCallSid,
      orElse: () => {},
    );
    final callerName = _formatCaller(currentCall['from'] as String?);

    return Container(
      color: const Color(0xFF0F3D2E),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(Icons.mic, color: Color(0xFF10B981), size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Se redă: $callerName',
                  style: const TextStyle(color: Color(0xFF10B981), fontSize: 13,
                      fontWeight: FontWeight.w600),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text('${_fmt(_position)} / ${_fmt(_duration)}',
                  style: const TextStyle(color: Colors.white54, fontSize: 11)),
            ],
          ),
          Row(
            children: [
              IconButton(
                icon: Icon(_isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled,
                    color: const Color(0xFF10B981), size: 36),
                onPressed: () async {
                  if (_isPlaying) {
                    await _player.pause();
                  } else {
                    await _player.resume();
                  }
                },
              ),
              Expanded(
                child: Slider(
                  value: progress,
                  activeColor: const Color(0xFF10B981),
                  inactiveColor: Colors.white24,
                  onChanged: (v) {
                    final seek = Duration(seconds: (_duration.inSeconds * v).round());
                    _player.seek(seek);
                  },
                ),
              ),
              IconButton(
                icon: const Icon(Icons.stop, color: Colors.white38, size: 20),
                onPressed: () async {
                  await _player.stop();
                  setState(() {
                    _playingCallSid = null;
                    _position = Duration.zero;
                    _duration = Duration.zero;
                  });
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}
