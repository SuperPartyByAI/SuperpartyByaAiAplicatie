import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:intl/intl.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:provider/provider.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'dart:async';
import '../services/voip_service.dart';
import 'chat_detail_screen.dart';
import 'recordings_screen.dart';
import 'calling_dialog.dart';
import 'active_call_screen.dart';

const String _BASE = 'http://89.167.115.150:3001/api';

class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key});

  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> {
  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;
  String? _error;
  bool _callingInProgress = false; // debounce: prevent double-press of callback button
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadCalls();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase().trim());
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async {
    return await Future.value(Supabase.instance.client.auth.currentSession?.accessToken);
  }

  Future<void> _loadCalls() async {
    setState(() { _loading = true; _error = null; });
    try {
      final token = await _getToken();
      final res = await http.get(
        Uri.parse('$_BASE/voice/calls?limit=50'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 10));

      if (res.statusCode == 200) {
        final decoded = jsonDecode(res.body);
        List<dynamic> rawList;
        if (decoded is List) {
          // New server: returns array directly
          rawList = decoded;
        } else if (decoded is Map && decoded.containsKey('calls')) {
          // Old server: returns {calls: [...]}
          rawList = (decoded['calls'] as List<dynamic>? ?? []);
        } else {
          rawList = [];
        }
        final list = rawList
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        setState(() { _calls = list; _loading = false; });
      } else {
        setState(() { _error = 'Server error: ${res.statusCode}'; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String _formatDuration(dynamic sec) {
    final s = (sec is int ? sec : int.tryParse('$sec') ?? 0);
    if (s <= 0) return '—';
    final m = s ~/ 60;
    final r = s % 60;
    return m > 0 ? '${m}m ${r}s' : '${r}s';
  }

  String _formatTime(dynamic ts) {
    if (ts == null) return '—';
    try {
      final dt = DateTime.parse(ts.toString()).toLocal();
      return DateFormat('dd MMM yyyy  HH:mm').format(dt);
    } catch (_) {
      return ts.toString();
    }
  }

  String _formatCaller(String? from, {String? direction, String? to}) {
    // For outgoing calls, display the dialed number (to field), not the SDK identity
    final raw = (direction == 'outgoing' && to != null && to.isNotEmpty) ? to : from;
    if (raw == null || raw.isEmpty) return 'Necunoscut';
    if (raw.startsWith('superparty') || raw.startsWith('client:')) return to?.isNotEmpty == true ? _formatPhone(to!) : 'Centrală';
    return _formatPhone(raw);
  }

  String _formatPhone(String raw) {
    final clean = raw.replaceFirst('client:', '').replaceFirst(RegExp(r'^\+?40'), '0');
    return clean.length > 3 ? clean : raw;
  }

  IconData _statusIcon(String? status, String? direction) {
    switch (status) {
      case 'completed':   return direction == 'outgoing' ? Icons.call_made : Icons.call_received;
      case 'no-answer':  return direction == 'outgoing' ? Icons.call_missed_outgoing : Icons.phone_missed;
      case 'busy':       return Icons.call_missed;
      case 'canceled':   return Icons.cancel_outlined;
      case 'ringing':    return Icons.ring_volume;
      default:           return Icons.phone;
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'completed': return const Color(0xFF10B981); // green
      case 'no-answer':
      case 'busy':
      case 'canceled':  return Colors.red;
      case 'ringing':   return Colors.orange;
      default:          return Colors.grey;
    }
  }

  String _statusLabel(String? status, String? direction) {
    switch (status) {
      case 'completed':  return direction == 'outgoing' ? 'Inițiat' : 'Răspuns';
      case 'no-answer':  return 'Ratat';
      case 'busy':       return 'Ocupat';
      case 'canceled':   return 'Anulat';
      case 'ringing':    return 'În curs';
      default:           return status ?? '—';
    }
  }

  Widget _statusChip(String? status, String? direction, dynamic duration) {
    final color = _statusColor(status);
    final label = _statusLabel(status, direction);
    final s = (duration is int ? duration : int.tryParse('$duration') ?? 0);
    final dur = status == 'completed' && s > 0 ? '  ${_formatDuration(duration)}' : '';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.4), width: 0.8),
      ),
      child: Text(
        '$label$dur',
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }

  /// Returns only digits from the "other party" in a call.
  /// For incoming calls: the client is in `from`.
  /// For outbound calls or when `from` is our line: the client is in `to`.
  String _clientNumber(Map<String, dynamic> call) {
    final direction = call['direction'] as String? ?? 'incoming';
    final from = call['from'] as String? ?? '';
    final to = call['to'] as String? ?? '';
    final isOurLine = from.contains('373805828') || from.startsWith('client:');
    final otherParty = (direction == 'incoming' && !isOurLine) ? from : to;
    // Strip ALL non-digit characters (including '+') and return digits only.
    // _callBack will prepend exactly one '+' for E.164 dialing.
    return otherParty.replaceFirst('client:', '').replaceAll(RegExp(r'[^\d]'), '');
  }

  Future<void> _callBack(Map<String, dynamic> call) async {
    if (_callingInProgress) return; // debounce
    setState(() => _callingInProgress = true);

    final digits = _clientNumber(call);
    if (digits.isEmpty) {
      setState(() => _callingInProgress = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Număr invalid pentru apel invers')),
      );
      return;
    }
    final number = '+$digits';
    final displayNum = '0${digits.substring(digits.startsWith('40') ? 2 : 0)}';

    debugPrint('CALL_FLOW: _callBack server-REST pt $number');

    // Show the call screen immediately so user sees feedback
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ActiveCallScreen(remoteId: displayNum, isOutgoing: true),
      ),
    );

    // Then trigger server-side outgoing call via REST API
    try {
      final token = await _getToken();
      final userId = Supabase.instance.client.auth.currentUser?.id;
      final resp = await http.post(
        Uri.parse('$_BASE/voice/makeCall'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'to': number, 'userId': userId}),
      ).timeout(const Duration(seconds: 15));
      debugPrint('CALL_FLOW: makeCall response ${resp.statusCode}: ${resp.body}');
      if (resp.statusCode != 200 && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Eroare apel: ${resp.body}')));
      }
    } catch (e) {
      debugPrint('CALL_FLOW: ERROR makeCall => $e');
    }
  }


  /// Deschide conversatia WhatsApp cu numarul apelantului.
  /// Daca nu exista conversatie, o creeaza prin backend API.
  Future<void> _openWhatsApp(Map<String, dynamic> call) async {
    final digits = _clientNumber(call);
    debugPrint('[WA] _openWhatsApp called, digits=$digits');
    if (digits.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Numar invalid')),
        );
      }
      return;
    }

    final jid = '$digits@s.whatsapp.net';
    debugPrint('[WA] Looking for conversation with jid=$jid');

    // 1) Try to find existing conversation
    String? foundDocId;
    String? foundName;
    try {
      final List<dynamic> q = await Supabase.instance.client.from('conversations_public').select().eq('jid', '$digits@s.whatsapp.net');
      debugPrint('[WA] Database query: ${q.length} docs');
      if (q.isNotEmpty) {
        final data = q.first as Map<String, dynamic>;
        foundDocId = data['id']?.toString();
        foundName = (data['name'] ?? data['pushName'] ?? digits) as String?;
      }
    } catch (e) {
      debugPrint('[WA] Query error: $e');
    }

    if (!mounted) return;

    // 2) Found existing → navigate
    if (foundDocId != null) {
      debugPrint('[WA] Found existing conv: $foundDocId');
      _navigateToChat(foundDocId!, foundName);
      return;
    }

    debugPrint('[WA] No existing conv, creating via API...');

    // 3) Create via backend
    try {
      final List<dynamic> accountsSnap = await Supabase.instance.client.from('wa_accounts').select().eq('state', 'connected');
      debugPrint('[WA] Connected accounts: ${accountsSnap.length}');

      if (accountsSnap.isEmpty) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Niciun cont conectat')));
        return;
      }

      String selectedAccountId;
      if (accountsSnap.length == 1) {
        final data = accountsSnap.first as Map<String, dynamic>;
        selectedAccountId = data['id']?.toString() ?? '';
        debugPrint('[WA] Auto-selected: $selectedAccountId');
      } else {
        debugPrint('[WA] Showing picker...');
        if (!mounted) return;
        final picked = await showDialog<String>(
          context: context,
          builder: (ctx) => SimpleDialog(
            backgroundColor: const Color(0xFF1F2937),
            title: const Text('Alege contul WhatsApp', style: TextStyle(color: Colors.white)),
            children: accountsSnap.map((doc) {
              final docData = doc as Map<String, dynamic>;
              final id = docData['id']?.toString() ?? '';
              final lbl = (docData['label'] ?? id) as String;
              return SimpleDialogOption(
                onPressed: () {
                  debugPrint('[WA] Picked: $id ($lbl)');
                  Navigator.pop(ctx, id);
                },
                child: Row(children: [
                  const Icon(Icons.chat, color: Color(0xFF25D366)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(lbl, style: const TextStyle(color: Colors.white, fontSize: 16))),
                ]),
              );
            }).toList(),
          ),
        );
        debugPrint('[WA] Picker result: $picked');
        if (picked == null || !mounted) return;
        selectedAccountId = picked;
      }

      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Se crează conversația...'), duration: Duration(seconds: 2)));

      debugPrint('[WA] POST /api/conversations phone=+$digits acc=$selectedAccountId');
      final token = await _getToken();
      final resp = await http.post(
        Uri.parse('$_BASE/conversations'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'phone': '+$digits',
          'accountId': selectedAccountId,
          'label': call['from'] ?? digits,
        }),
      );
      debugPrint('[WA] Response: ${resp.statusCode} ${resp.body}');

      if (resp.statusCode != 200) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Eroare: ${resp.body}')));
        return;
      }

      final convId = (jsonDecode(resp.body)['conversationId']) as String;
      debugPrint('[WA] Created: $convId');
      if (!mounted) return;
      _navigateToChat(convId, (call['from'] ?? digits) as String?);
    } catch (e) {
      debugPrint('[WA] ERROR: $e');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Eroare: $e')));
    }
  }

  void _navigateToChat(String conversationId, String? name) {
    debugPrint('[WA] _navigateToChat: $conversationId');
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ChatDetailScreen(conversationId: conversationId, name: name),
        ));
      }
    });
  }


  Future<void> _playRecording(String recordingUrl) async {
    // Construiește URL-ul proxy-ului nostru backend (evită Basic Auth Twilio)
    String proxyUrl = recordingUrl;
    final reSid = RegExp(r'Recordings/(RE[a-zA-Z0-9]+)');
    final match = reSid.firstMatch(recordingUrl);
    if (match != null) {
      final sid = match.group(1)!;
      proxyUrl = '$_BASE/voice/recording/$sid';
    }

    if (!mounted) return;

    // Deschide bottom sheet cu audio player
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1F2937),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _RecordingPlayer(url: proxyUrl),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      appBar: AppBar(
        title: const Text(
          'Jurnal Apeluri',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF1F2937),
        iconTheme: const IconThemeData(color: Colors.white),
        leading: IconButton(
          icon: const Icon(Icons.mic, color: Color(0xFF10B981)),
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const RecordingsScreen()),
          ),
          tooltip: 'Înregistrări',
        ),
      ),
      body: _loading
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
                        onPressed: _loadCalls,
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                        child: const Text('Reîncearcă'),
                      ),
                    ],
                  ),
                )
              : Column(
                  children: [
                    // ── Bara de căutare ────────────────────────────────────
                    Container(
                      color: const Color(0xFF1F2937),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      child: TextField(
                        controller: _searchController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Caută după număr sau nume…',
                          hintStyle: const TextStyle(color: Colors.white38),
                          prefixIcon: const Icon(Icons.search, color: Colors.white38),
                          suffixIcon: _searchQuery.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear, color: Colors.white38),
                                  onPressed: () => _searchController.clear(),
                                )
                              : null,
                          filled: true,
                          fillColor: const Color(0xFF374151),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                    // ── Lista filtrată ─────────────────────────────────────
                    Expanded(
                      child: Builder(builder: (ctx) {
                        final filtered = _searchQuery.isEmpty
                            ? _calls
                            : _calls.where((c) {
                                final from = (c['from'] as String? ?? '').toLowerCase();
                                final to   = (c['to']   as String? ?? '').toLowerCase();
                                return from.contains(_searchQuery) || to.contains(_searchQuery);
                              }).toList();

                        if (filtered.isEmpty) {
                          return Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.phone_missed, color: Colors.white38, size: 64),
                                const SizedBox(height: 12),
                                Text(
                                  _searchQuery.isEmpty
                                      ? 'Nicio convorbire înregistrată'
                                      : 'Niciun rezultat pentru "$_searchQuery"',
                                  style: const TextStyle(color: Colors.white54, fontSize: 16),
                                ),
                              ],
                            ),
                          );
                        }

                        return RefreshIndicator(
                          onRefresh: _loadCalls,
                          color: const Color(0xFF10B981),
                          child: ListView.separated(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            itemCount: filtered.length,
                            separatorBuilder: (_, __) => const Divider(color: Color(0xFF374151), height: 1),
                            itemBuilder: (context, i) {
                              final call = filtered[i];
                              final from = call['from'] as String? ?? '';
                          final to   = call['to']   as String? ?? '';

                          final status = call['status'] as String?;
                          final direction = call['direction'] as String?;
                          final duration = call['duration'];
                          final timestamp = call['timestamp'];
                          final recordingUrl = call['recordingUrl'] as String?;
                          final hasRecording = recordingUrl != null && recordingUrl.isNotEmpty;

                          return Container(
                            color: const Color(0xFF1F2937),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              leading: CircleAvatar(
                                backgroundColor: _statusColor(status).withOpacity(0.15),
                                child: Icon(_statusIcon(status, direction), color: _statusColor(status), size: 22),
                              ),
                              title: Text(
                                _formatCaller(from, direction: direction, to: to),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 15,
                                ),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const SizedBox(height: 3),
                                  Text(
                                    _formatTime(timestamp),
                                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                                  ),
                                  const SizedBox(height: 4),
                                  Row(
                                    children: [
                                      _statusChip(status, direction, duration),
                                      if (hasRecording) ...[
                                        const SizedBox(width: 6),
                                        const Icon(Icons.mic, size: 12, color: Color(0xFF10B981)),
                                        const SizedBox(width: 2),
                                        const Text('Rec', style: TextStyle(color: Color(0xFF10B981), fontSize: 10)),
                                      ],
                                    ],
                                  ),
                                ],
                              ),

                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  // Sună înapoi
                                  IconButton(
                                    icon: const Icon(Icons.call, color: Color(0xFF60A5FA), size: 24),
                                    tooltip: 'Sună înapoi',
                                    onPressed: _callingInProgress ? null : () => _callBack(call),
                                  ),
                                  // Deschide conversația WhatsApp
                                  IconButton(
                                    icon: const Icon(Icons.chat, color: Color(0xFF25D366), size: 24),
                                    tooltip: 'Deschide WhatsApp',
                                    onPressed: () => _openWhatsApp(call),
                                  ),
                                ],
                              ),
                              isThreeLine: true,
                            ),
                          );
                            },
                          ),
                        );
                      }),
                    ),
                  ],
                ),
    );
  }
}

// ─── Mini Audio Player pentru înregistrări ────────────────────────────────────
class _RecordingPlayer extends StatefulWidget {
  final String url;
  const _RecordingPlayer({required this.url});

  @override
  State<_RecordingPlayer> createState() => _RecordingPlayerState();
}

class _RecordingPlayerState extends State<_RecordingPlayer> {
  final AudioPlayer _player = AudioPlayer();
  bool _isPlaying = false;
  Duration _duration = Duration.zero;
  Duration _position = Duration.zero;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _player.onPlayerStateChanged.listen((s) {
      if (mounted) setState(() => _isPlaying = s == PlayerState.playing);
    });
    _player.onDurationChanged.listen((d) {
      if (mounted) setState(() { _duration = d; _loading = false; });
    });
    _player.onPositionChanged.listen((p) {
      if (mounted) setState(() => _position = p);
    });
    _player.onPlayerComplete.listen((_) {
      if (mounted) setState(() { _isPlaying = false; _position = Duration.zero; });
    });
    // Autoplay
    _player.play(UrlSource(widget.url)).catchError((_) {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final progress = _duration.inSeconds > 0
        ? _position.inSeconds / _duration.inSeconds
        : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          const Text('Înregistrare apel', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 20),
          if (_loading)
            const CircularProgressIndicator(color: Color(0xFF10B981))
          else ...[
            Row(
              children: [
                Text(_fmt(_position), style: const TextStyle(color: Colors.white54, fontSize: 12)),
                Expanded(
                  child: Slider(
                    value: progress.clamp(0.0, 1.0),
                    activeColor: const Color(0xFF10B981),
                    inactiveColor: Colors.white24,
                    onChanged: (v) {
                      final seek = Duration(seconds: (_duration.inSeconds * v).round());
                      _player.seek(seek);
                    },
                  ),
                ),
                Text(_fmt(_duration), style: const TextStyle(color: Colors.white54, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  iconSize: 56,
                  icon: Icon(_isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled,
                      color: const Color(0xFF10B981)),
                  onPressed: () async {
                    if (_isPlaying) {
                      await _player.pause();
                    } else {
                      await _player.resume();
                    }
                  },
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
