import 'package:supabase_flutter/supabase_flutter.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

const String _BASE = 'http://89.167.115.150:3001/api';

class CallingDialog extends StatefulWidget {
  final String number;
  final Future<String?> Function() callFuture;
  final void Function(String? callSid) onCancel;

  const CallingDialog({
    super.key,
    required this.number,
    required this.callFuture,
    required this.onCancel,
  });

  @override
  State<CallingDialog> createState() => _CallingDialogState();
}

class _CallingDialogState extends State<CallingDialog>
    with SingleTickerProviderStateMixin {
  late AnimationController _anim;
  late Animation<double> _pulse;
  String _status = 'Se inițializează...';
  String? _callSid;
  int _seconds = 0;
  Timer? _timer;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
    _pulse = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _anim, curve: Curves.easeInOut),
    );

    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _seconds++);
    });

    // Initiate the REST call
    widget.callFuture().then((sid) {
      if (!mounted) return;
      setState(() {
        _callSid = sid;
        _status = sid != null
            ? 'Centrala sună clientul...'
            : 'Eroare inițiere apel';
      });

      if (sid != null) {
        // Poll status from backend API directly every 2s
        _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) async {
          if (!mounted) return;
          try {
            final token = await Future.value(Supabase.instance.client.auth.currentSession?.accessToken);
            final res = await http.get(
              Uri.parse('$_BASE/voice/calls/$sid'),
              headers: {if (token != null) 'Authorization': 'Bearer $token'},
            ).timeout(const Duration(seconds: 5));
            if (res.statusCode == 200 && mounted) {
              final data = jsonDecode(res.body);
              final status = data['status'] as String?;
              if (status == 'completed' || status == 'busy' || status == 'no-answer' || status == 'failed' || status == 'canceled') {
                Navigator.of(context).pop();
              } else if (status == 'in-progress') {
                setState(() => _status = 'Client conectat! Așteaptă apel...');
              }
            }
          } catch (_) {
            // Ignore temporary net errors during polling
          }
        });
      }
    }).catchError((_) {
      if (mounted) setState(() => _status = 'Eroare conexiune');
    });
  }

  @override
  void dispose() {
    _anim.dispose();
    _timer?.cancel();
    _pollTimer?.cancel();
    super.dispose();
  }

  String _fmt(int s) {
    final m = (s ~/ 60).toString().padLeft(2, '0');
    final r = (s % 60).toString().padLeft(2, '0');
    return '$m:$r';
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.zero,
      child: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF0A1628), Color(0xFF111827)],
          ),
        ),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(flex: 2),
              // Status label
              Text(
                _status,
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 15,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 32),
              // Pulsing green circle with phone icon
              ScaleTransition(
                scale: _pulse,
                child: Container(
                  width: 110,
                  height: 110,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFF10B981).withOpacity(0.12),
                    border: Border.all(
                      color: const Color(0xFF10B981),
                      width: 2.5,
                    ),
                  ),
                  child: const Icon(
                    Icons.phone_in_talk_rounded,
                    color: Color(0xFF10B981),
                    size: 52,
                  ),
                ),
              ),
              const SizedBox(height: 32),
              // Number
              Text(
                widget.number,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 34,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: 6),
              // Timer
              Text(
                _fmt(_seconds),
                style: const TextStyle(
                  color: Colors.white38,
                  fontSize: 20,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 20),
              // Info box
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 40),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: Colors.white.withOpacity(0.08),
                    width: 1,
                  ),
                ),
                child: const Text(
                  '📲 Vei primi un apel incoming în aplicație când clientul răspunde',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white60, fontSize: 13, height: 1.5),
                ),
              ),
              const Spacer(flex: 2),
              // Hang up button
              GestureDetector(
                onTap: () => widget.onCancel(_callSid),
                child: Container(
                  width: 76,
                  height: 76,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFFEF4444),
                    boxShadow: [
                      BoxShadow(
                        color: Color(0x55EF4444),
                        blurRadius: 20,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.call_end_rounded,
                    color: Colors.white,
                    size: 36,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Anulează',
                style: TextStyle(color: Colors.white38, fontSize: 13),
              ),
              const SizedBox(height: 50),
            ],
          ),
        ),
      ),
    );
  }
}
