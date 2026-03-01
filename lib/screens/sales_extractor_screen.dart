import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/ai_service.dart';

/// SalesExtractorScreen — Live Prompt Engine
/// Câmp unic de text mare (Prompt Master) + Debouncer 2s + Cartonașe AI automate
/// Conform „Live Prompt Engine Architecture (Auto-Extractor Reactiv)"
class SalesExtractorScreen extends StatefulWidget {
  const SalesExtractorScreen({super.key});

  @override
  State<SalesExtractorScreen> createState() => _SalesExtractorScreenState();
}

class _SalesExtractorScreenState extends State<SalesExtractorScreen> {
  final TextEditingController _promptController = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  String _sessionId = 'extractor_${DateTime.now().millisecondsSinceEpoch}';

  Timer? _debounceTimer;
  bool _isAnalyzing = false;
  bool _skipNextDebounce = false; // Flag to skip debounce after programmatic text set
  String? _statusText;
  String? _aiQuestion;

  // Date extrase de AI (cartonașele)
  String? _extractedDate;
  String? _extractedTime;
  String? _extractedClientName;
  String? _extractedClientPhone;
  String? _extractedAddress;
  int? _extractedAge;
  String? _eventShortCode; // Codul scurt al evenimentului (01, 02...)
  bool _needsUrsitoareCount = false; // Flag: trebuie ales numărul de ursitoare
  bool _needsVataPopcornChoice = false; // Flag: vata+popcorn = 1 sau 2 operatori?
  List<Map<String, dynamic>> _extractedRoles = [];

  // Draft complet pentru salvare
  Map<String, dynamic>? _salesDraft;
  Map<String, dynamic>? _rolesDraft;

  @override
  void initState() {
    super.initState();
    _promptController.addListener(_onPromptChanged);
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _promptController.removeListener(_onPromptChanged);
    _promptController.dispose();
    super.dispose();
  }

  // ═══════════════════════════════════════════
  // DEBOUNCER: 2 secunde după ultima literă
  // ═══════════════════════════════════════════
  void _onPromptChanged() {
    _debounceTimer?.cancel();
    if (_skipNextDebounce) {
      _skipNextDebounce = false;
      return;
    }
    final text = _promptController.text.trim();

    // Când textul e gol, resetează tot (sesiune + date extrase)
    if (text.isEmpty) {
      setState(() {
        _sessionId = 'extractor_${DateTime.now().millisecondsSinceEpoch}';
        _extractedDate = null;
        _extractedTime = null;
        _extractedClientName = null;
        _extractedClientPhone = null;
        _extractedAddress = null;
        _extractedAge = null;
        _eventShortCode = null;
        _needsUrsitoareCount = false;
        _needsVataPopcornChoice = false;
        _extractedRoles = [];
        _salesDraft = null;
        _rolesDraft = null;
        _aiQuestion = null;
        _statusText = null;
      });
      return;
    }

    _debounceTimer = Timer(const Duration(seconds: 2), () {
      _triggerAiExtraction(text);
    });
  }

  // Reset tot pentru un eveniment nou
  void _resetForNewEvent() {
    setState(() {
      _promptController.clear();
      _sessionId = 'extractor_${DateTime.now().millisecondsSinceEpoch}';
      _extractedDate = null;
      _extractedTime = null;
      _extractedClientName = null;
      _extractedClientPhone = null;
      _extractedAddress = null;
      _extractedAge = null;
      _eventShortCode = null;
      _needsUrsitoareCount = false;
      _needsVataPopcornChoice = false;
      _extractedRoles = [];
      _salesDraft = null;
      _rolesDraft = null;
      _aiQuestion = null;
      _statusText = null;
    });
  }

  // ═══════════════════════════════════════════
  // EXTRAGERE AI (fără buton — automată)
  // ═══════════════════════════════════════════


  Future<void> _triggerAiExtraction(String promptText, {String? imageBase64}) async {
    if (_isAnalyzing) return;

    setState(() {
      _isAnalyzing = true;
      _statusText = imageBase64 != null ? '📷 AI Extrage text din imagine...' : 'AI Analizează...';
      _aiQuestion = null;
    });

    try {
      final response = await AiService().sendMessageToEventAI(
        promptText,
        _sessionId,
        imageBase64: imageBase64,
      );

      if (!mounted) return;

      debugPrint('[EXTRACTOR] Raw response keys: ${response.keys.toList()}');
      debugPrint('[EXTRACTOR] Raw response: $response');

      final action = response['action']?.toString().toUpperCase() ?? 'NONE';
      final message = response['message']?.toString();

      // ── Extragere date din TOATE formatele posibile ──
      Map<String, dynamic> data = {};

      // 1. draftEvent (CONFIRM/UPDATE_DRAFT response from V2)
      if (response['draftEvent'] is Map) {
        data = Map<String, dynamic>.from(response['draftEvent'] as Map);
      }
      // 2. eventData (ASK_INFO response from V2 updated)
      if (data.isEmpty && response['eventData'] is Map) {
        data = Map<String, dynamic>.from(response['eventData'] as Map);
      }
      // 3. data (CREATE response / generic)
      if (data.isEmpty && response['data'] is Map) {
        data = Map<String, dynamic>.from(response['data'] as Map);
      }
      // 4. Fallback — datele pot fi direct în response
      if (data.isEmpty) {
        for (final key in ['date', 'address', 'sarbatoritNume', 'client', 'phone']) {
          if (response.containsKey(key) && response[key] != null) {
            data = Map<String, dynamic>.from(response);
            break;
          }
        }
      }

      // ── Extragere roluri ──
      List<dynamic> roles = [];
      if (response['roles'] is List) {
        roles = response['roles'] as List;
      } else if (data['rolesDraft'] is List) {
        roles = data['rolesDraft'] as List;
      } else if (data['roles'] is List) {
        roles = data['roles'] as List;
      }

      // ── Extragere client (poate fi string sau Map) ──
      String? clientName;
      String? clientPhone;
      final clientField = data['client'];
      if (clientField is Map) {
        clientName = clientField['name']?.toString();
        clientPhone = clientField['phone']?.toString();
      } else if (clientField is String) {
        clientName = clientField;
      }

      setState(() {
        _isAnalyzing = false;

        // Afișează mesajul AI (dar NU ca întrebare dacă e CONFIRM)
        if (message != null && message.isNotEmpty && action != 'CONFIRM') {
          _aiQuestion = message;
        }

        // ShortCode pre-generat de backend
        final respShortCode = response['shortCode']?.toString();
        if (respShortCode != null && respShortCode.isNotEmpty) {
          _eventShortCode = respShortCode;
        }

        // Ursitoare picker flag
        _needsUrsitoareCount = response['needsUrsitoareCount'] == true;
        _needsVataPopcornChoice = response['needsVataPopcornChoice'] == true;

        // Populează cartonașele
        if (data.isNotEmpty) {
          _salesDraft = data;
          _extractedDate = data['date']?.toString() ?? data['data']?.toString();
          _extractedTime = data['time']?.toString() ?? data['ora']?.toString() ?? data['startTime']?.toString();
          _extractedClientName = data['sarbatoritNume']?.toString() ?? clientName ?? data['clientName']?.toString() ?? data['nume']?.toString();
          _extractedClientPhone = data['phone']?.toString() ?? clientPhone ?? data['telefon']?.toString();
          _extractedAddress = data['address']?.toString() ?? data['locatie']?.toString() ?? data['adresa']?.toString();
          _extractedAge = _parseAge(data['sarbatoritVarsta'] ?? data['varsta'] ?? data['age']);
        }

        if (roles.isNotEmpty) {
          _extractedRoles = roles.map((r) {
            if (r is Map) return Map<String, dynamic>.from(r);
            return <String, dynamic>{'label': r.toString()};
          }).toList();
          _rolesDraft = {'roles': _extractedRoles};
        }

        // Pune textul din imagine/AI în câmpul de prompt
        if (_promptController.text.trim().isEmpty) {
          _skipNextDebounce = true;
          // Prioritate 1: extractedText brut din AI (tot textul din imagine)
          final rawText = response['extractedText']?.toString() ??
              data['extractedText']?.toString();
          if (rawText != null && rawText.isNotEmpty) {
            _promptController.text = rawText;
          } else if (data.isNotEmpty) {
            // Fallback: construiește din câmpuri structurate
            final parts = <String>[];
            if (_extractedDate != null) parts.add('Data: $_extractedDate');
            if (_extractedTime != null) parts.add('Ora: $_extractedTime');
            if (_extractedAddress != null) parts.add('Adresa: $_extractedAddress');
            if (_extractedClientName != null) parts.add('Sărbătorit: $_extractedClientName');
            if (_extractedAge != null) parts.add('Vârsta: $_extractedAge ani');
            if (clientName != null) parts.add('Client: $clientName');
            if (clientPhone != null) parts.add('Tel: $clientPhone');
            _promptController.text = parts.join('\n');
          }
        }

        // Status + shortCode handling
        if (action == 'CREATE') {
          _eventShortCode = response['shortCode']?.toString() ?? _eventShortCode;
          final code = _eventShortCode ?? '';
          _statusText = '✅ Eveniment ${code.isNotEmpty ? '#$code ' : ''}creat și salvat!';
          // Auto-reset după 3 secunde
          Future.delayed(const Duration(seconds: 3), () {
            if (mounted) _resetForNewEvent();
          });
        } else if (action == 'CONFIRM') {
          _statusText = '📋 Date extrase. Apasă Salvează.';
        } else {
          _statusText = null;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isAnalyzing = false;
        _statusText = '❌ Eroare: $e';
      });
    }
  }

  int? _parseAge(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }

  /// Convert minutes string to hours display: "60" → "1h", "120" → "2h", "90" → "1.5h"
  String _formatDuration(String minutes) {
    final min = int.tryParse(minutes) ?? 0;
    if (min <= 0) return minutes;
    final hours = min / 60;
    if (hours == hours.roundToDouble()) {
      return '${hours.toInt()}h';
    }
    return '${hours.toStringAsFixed(1)}h';
  }

  // ═══════════════════════════════════════════
  // POZĂ DIN GALERIE → Text extras → Prompt
  // ═══════════════════════════════════════════
  Future<void> _pickImageAndExtract() async {
    try {
      final XFile? image = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 95,
        maxWidth: 2400,
        maxHeight: 2400,
      );
      if (image == null) return;

      final bytes = await image.readAsBytes();
      final base64Image = base64Encode(bytes);

      // Trimite imaginea la AI — _triggerAiExtraction gestionează starea
      final currentPrompt = _promptController.text.trim();
      await _triggerAiExtraction(
        currentPrompt.isNotEmpty ? currentPrompt : '[Imagine atașată — extrage datele]',
        imageBase64: base64Image,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isAnalyzing = false;
        _statusText = '❌ Eroare la imagine: $e';
      });
    }
  }

  Future<void> _takePhotoAndExtract() async {
    try {
      final XFile? photo = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 95,
        maxWidth: 2400,
        maxHeight: 2400,
      );
      if (photo == null) return;

      final bytes = await photo.readAsBytes();
      final base64Image = base64Encode(bytes);

      // Trimite poza la AI — _triggerAiExtraction gestionează starea
      final currentPrompt = _promptController.text.trim();
      await _triggerAiExtraction(
        currentPrompt.isNotEmpty ? currentPrompt : '[Poză nouă — extrage datele]',
        imageBase64: base64Image,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isAnalyzing = false;
        _statusText = '❌ Eroare la poză: $e';
      });
    }
  }

  // ═══════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B1220),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF111C35), Color(0xFF0B1220)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _buildPromptField(),
                      const SizedBox(height: 12),
                      _buildImageButtons(),
                      if (_isAnalyzing) ...[
                        const SizedBox(height: 16),
                        _buildAnalyzingIndicator(),
                      ],
                      if (_statusText != null && !_isAnalyzing) ...[
                        const SizedBox(height: 12),
                        _buildStatusBanner(),
                      ],
                      if (_aiQuestion != null) ...[
                        const SizedBox(height: 12),
                        _buildAiQuestion(),
                      ],
                      const SizedBox(height: 20),
                      _buildExtractedCards(),
                      if (_extractedRoles.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildRoleCards(),
                      ],
                      // Ursitoare picker
                      if (_needsUrsitoareCount) ...[
                        const SizedBox(height: 16),
                        _buildUrsitoarePicker(),
                      ],
                      if (_needsVataPopcornChoice) ...[
                        const SizedBox(height: 16),
                        _buildVataPopcornPicker(),
                      ],
                      if (_salesDraft != null && _salesDraft!.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        _buildSaveButton(),
                      ],
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1220).withOpacity(0.72),
        border: const Border(bottom: BorderSide(color: Color(0x14FFFFFF))),
      ),
      child: const Row(
        children: [
          SizedBox(width: 16),
          Expanded(
            child: Text(
              '📋 Extrage Formular',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w900,
                color: Color(0xFFEAF1FF),
                letterSpacing: 0.2,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ─── PROMPT FIELD (câmpul mare de text) ───
  Widget _buildPromptField() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.14)),
      ),
      child: TextField(
        controller: _promptController,
        maxLines: 8,
        minLines: 5,
        style: const TextStyle(
          color: Color(0xFFEAF1FF),
          fontSize: 15,
          height: 1.5,
        ),
        decoration: InputDecoration(
          hintText: 'Lipește mesajul de la client sau scrie comanda ta...\n\nEx: „Bună, vreau o petrecere pe 15 martie la Sala Venus pentru Andrei, 7 ani, cu Spiderman și vată de zahăr"',
          hintStyle: TextStyle(
            color: const Color(0xFFEAF1FF).withOpacity(0.35),
            fontSize: 14,
            height: 1.5,
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.all(16),
          suffixIcon: _promptController.text.isNotEmpty
              ? Padding(
                  padding: const EdgeInsets.only(top: 4, right: 4),
                  child: Align(
                    alignment: Alignment.topRight,
                    widthFactor: 1,
                    heightFactor: 1,
                    child: GestureDetector(
                      onTap: () {
                        _promptController.clear(); // triggers _onPromptChanged → resets all
                      },
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.15),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 18),
                      ),
                    ),
                  ),
                )
              : null,
        ),
      ),
    );
  }

  // ─── BUTOANE IMAGINE ───
  Widget _buildImageButtons() {
    return Row(
      children: [
        Expanded(
          child: _actionButton(
            icon: Icons.photo_library_outlined,
            label: 'Galerie',
            onTap: _pickImageAndExtract,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _actionButton(
            icon: Icons.camera_alt_outlined,
            label: 'Fotografiază',
            onTap: _takePhotoAndExtract,
          ),
        ),
      ],
    );
  }

  Widget _actionButton({required IconData icon, required String label, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: _isAnalyzing ? null : onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF4D88FF).withOpacity(0.15),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF4D88FF).withOpacity(0.35)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: const Color(0xFFEAF1FF), size: 20),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w700, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  // ─── STATUS (AI Analizează...) ───
  Widget _buildAnalyzingIndicator() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF4ECDC4).withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF4ECDC4).withOpacity(0.4)),
      ),
      child: Row(
        children: [
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF4ECDC4))),
          const SizedBox(width: 12),
          Text(
            _statusText ?? 'AI Analizează...',
            style: const TextStyle(color: Color(0xFF4ECDC4), fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusBanner() {
    final isError = _statusText?.contains('❌') ?? false;
    final isSuccess = _statusText?.contains('✅') ?? false;
    final color = isError ? const Color(0xFFFF7878) : isSuccess ? const Color(0xFF4ECDC4) : const Color(0xFFEAF1FF);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Text(_statusText!, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13)),
    );
  }

  // ─── ÎNTREBARE AI ───
  Widget _buildAiQuestion() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFC107).withOpacity(0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFFC107).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('🤖 AI întreabă:', style: TextStyle(color: Color(0xFFFFC107), fontWeight: FontWeight.w900, fontSize: 13)),
          const SizedBox(height: 6),
          Text(_aiQuestion!, style: const TextStyle(color: Color(0xFFEAF1FF), fontSize: 14, height: 1.4)),
          const SizedBox(height: 8),
          Text(
            'Adaugă răspunsul în câmpul de text de sus și AI-ul va actualiza automat.',
            style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.5), fontSize: 12, fontStyle: FontStyle.italic),
          ),
        ],
      ),
    );
  }

  // ─── CARTONAȘE DATE EXTRASE ───
  Widget _buildExtractedCards() {
    final hasAnyData = _extractedDate != null || _extractedTime != null ||
        _extractedClientName != null || _extractedAddress != null;

    if (!hasAnyData) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.04),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.08)),
        ),
        child: Column(
          children: [
            Icon(Icons.auto_awesome, size: 40, color: const Color(0xFFEAF1FF).withOpacity(0.2)),
            const SizedBox(height: 12),
            Text(
              'Scrie sau lipește detaliile petrecerii sus.\nDupă 2 secunde, AI-ul extrage automat datele.',
              textAlign: TextAlign.center,
              style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.4), fontSize: 13, height: 1.5),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('📋 Date Extrase', style: TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 10),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            if (_extractedDate != null) _infoCard('📅', 'Data', _extractedDate!),
            if (_extractedTime != null) _infoCard('🕐', 'Ora', _extractedTime!),
            if (_extractedClientName != null) _infoCard('👤', 'Nume', _extractedClientName!),
            if (_extractedAge != null) _infoCard('🎂', 'Vârsta', '$_extractedAge ani'),
            if (_extractedClientPhone != null) _infoCard('📱', 'Telefon', _extractedClientPhone!),
            if (_extractedAddress != null) _infoCard('📍', 'Locație', _extractedAddress!),
          ],
        ),
      ],
    );
  }

  Widget _infoCard(String emoji, String label, String value) {
    return Container(
      width: MediaQuery.of(context).size.width / 2 - 26,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.12)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$emoji $label', style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.6), fontSize: 11, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(color: Color(0xFFEAF1FF), fontSize: 15, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }

  // ─── CARTONAȘE ROLURI ───
  Widget _buildRoleCards() {
    // Determine event prefix for role codes
    final prefix = _eventShortCode ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('🎭 Roluri & Servicii', style: TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 10),
        ..._extractedRoles.asMap().entries.map((entry) {
          final role = entry.value;
          final label = role['label']?.toString() ?? role['roleType']?.toString() ?? 'Rol ${entry.key + 1}';
          final details = role['details']?.toString() ?? '';
          final time = role['startTime']?.toString() ?? role['time']?.toString() ?? '';
          final duration = role['durationMinutes']?.toString() ?? role['durationMin']?.toString() ?? '';
          final slot = role['slot']?.toString() ?? String.fromCharCode(65 + entry.key);
          // Show full code (01A) after creation, just slot letter (A) during preview
          final roleCode = prefix.isNotEmpty ? '$prefix$slot' : slot;

          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF4D88FF).withOpacity(0.1),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFF4D88FF).withOpacity(0.3)),
            ),
            child: Row(
              children: [
                // Role code badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4D88FF).withOpacity(0.25),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(roleCode, style: const TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w900, fontSize: 12)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        details.isNotEmpty ? '$label — $details' : label,
                        style: const TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                      if (time.isNotEmpty || duration.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            if (time.isNotEmpty)
                              Text(
                                '🕐 $time',
                                style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.6), fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            if (time.isNotEmpty && duration.isNotEmpty)
                              const SizedBox(width: 8),
                            if (duration.isNotEmpty)
                              Text(
                                '⏱ ${_formatDuration(duration)}',
                                style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.4), fontSize: 12),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                // Status dot
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: const Color(0xFF4ECDC4),
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: const Color(0xFF4ECDC4).withOpacity(0.5), blurRadius: 6)],
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  // ─── URSITOARE PICKER ───
  Widget _buildUrsitoarePicker() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFD700).withOpacity(0.15),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFFD700).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '🧙‍♀️ Câte ursitoare?',
            style: TextStyle(color: Color(0xFFFFD700), fontWeight: FontWeight.w900, fontSize: 15),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _ursitoareChip(3),
              const SizedBox(width: 12),
              _ursitoareChip(4),
            ],
          ),
        ],
      ),
    );
  }

  Widget _ursitoareChip(int count) {
    return Expanded(
      child: GestureDetector(
        onTap: () {
          // Adaugă ursitoarele DIRECT în stare, fără AI
          setState(() {
            // Scoate ursitoarele existente (dacă sunt)
            _extractedRoles.removeWhere(
              (r) => r['roleKey'] == 'ursitoare' || (r['label']?.toString().toLowerCase() == 'ursitoare'),
            );

            // Ora default din eveniment
            final defaultTime = _extractedTime ?? '18:30';

            // Adaugă N ursitoare
            for (int i = 1; i <= count; i++) {
              final slot = String.fromCharCode(64 + _extractedRoles.length + 1); // A, B, C...
              _extractedRoles.add({
                'slot': slot,
                'roleKey': 'ursitoare',
                'label': 'Ursitoare',
                'details': 'Ursitoare $i',
                'startTime': defaultTime,
                'durationMinutes': 60,
              });
            }

            // Ascunde picker-ul
            _needsUrsitoareCount = false;
            _rolesDraft = {'roles': _extractedRoles};
            _statusText = '✅ $count ursitoare adăugate. Apasă Salvează.';
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFFFFD700).withOpacity(0.25),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFFFD700).withOpacity(0.5)),
          ),
          child: Center(
            child: Text(
              '$count Ursitoare',
              style: const TextStyle(color: Color(0xFFFFD700), fontWeight: FontWeight.w900, fontSize: 16),
            ),
          ),
        ),
      ),
    );
  }

  // ─── VATA + POPCORN PICKER ───
  Widget _buildVataPopcornPicker() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFF8C00).withOpacity(0.15),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFF8C00).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '🍬 Vată + Popcorn — câți operatori?',
            style: TextStyle(color: Color(0xFFFF8C00), fontWeight: FontWeight.w900, fontSize: 15),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _vataPopcornChip(1, '1 Operator', 'combo'),
              const SizedBox(width: 12),
              _vataPopcornChip(2, '2 Operatori', 'separate'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _vataPopcornChip(int count, String label, String mode) {
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            // Remove any existing vata/popcorn roles
            _extractedRoles.removeWhere(
              (r) {
                final rk = r['roleKey']?.toString() ?? '';
                final lb = (r['label']?.toString() ?? '').toLowerCase();
                return rk == 'vata' || rk == 'popcorn' || rk == 'vataPopcorn' ||
                    lb.contains('vat') || lb.contains('popcorn');
              },
            );

            final defaultTime = _extractedTime ?? '18:30';

            if (mode == 'combo') {
              // 1 operator: combo role
              final slot = String.fromCharCode(64 + _extractedRoles.length + 1);
              _extractedRoles.add({
                'slot': slot,
                'roleKey': 'vataPopcorn',
                'label': 'Vată + Popcorn',
                'details': 'Combo 1 operator',
                'startTime': defaultTime,
                'durationMinutes': 120,
              });
            } else {
              // 2 operatori: separate roles
              final slot1 = String.fromCharCode(64 + _extractedRoles.length + 1);
              _extractedRoles.add({
                'slot': slot1,
                'roleKey': 'vata',
                'label': 'Vată de zahăr',
                'details': null,
                'startTime': defaultTime,
                'durationMinutes': 120,
              });
              final slot2 = String.fromCharCode(64 + _extractedRoles.length + 1);
              _extractedRoles.add({
                'slot': slot2,
                'roleKey': 'popcorn',
                'label': 'Popcorn',
                'details': null,
                'startTime': defaultTime,
                'durationMinutes': 120,
              });
            }

            _needsVataPopcornChoice = false;
            _rolesDraft = {'roles': _extractedRoles};
            _statusText = '✅ $label adăugat. Apasă Salvează.';
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFFFF8C00).withOpacity(0.25),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFFF8C00).withOpacity(0.5)),
          ),
          child: Center(
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFFFF8C00), fontWeight: FontWeight.w900, fontSize: 15),
            ),
          ),
        ),
      ),
    );
  }

  // ─── BUTON SALVARE ───
  Widget _buildSaveButton() {
    return GestureDetector(
      onTap: _saveEvent,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF4ECDC4), Color(0xFF44B8B0)],
          ),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(color: const Color(0xFF4ECDC4).withOpacity(0.3), blurRadius: 16, offset: const Offset(0, 6)),
          ],
        ),
        child: const Center(
          child: Text(
            'Salvează Evenimentul ✓',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 0.3),
          ),
        ),
      ),
    );
  }

  // ─── SALVARE DIRECTA (bypass AI) ───
  Future<void> _saveEvent() async {
    if (_isAnalyzing || _salesDraft == null) return;

    setState(() {
      _isAnalyzing = true;
      _statusText = '💾 Se salvează evenimentul...';
    });

    try {
      final response = await AiService().sendMessageToEventAI(
        'SAVE',
        _sessionId,
        saveNow: true,
      );

      if (!mounted) return;

      final action = response['action']?.toString().toUpperCase() ?? 'NONE';

      setState(() {
        _isAnalyzing = false;
        if (action == 'CREATE') {
          _eventShortCode = response['shortCode']?.toString();
          final code = _eventShortCode ?? '';
          _statusText = '✅ Eveniment ${code.isNotEmpty ? '#$code ' : ''}creat și salvat!';
          _aiQuestion = response['message']?.toString();
          // Auto-reset după 3 secunde
          Future.delayed(const Duration(seconds: 4), () {
            if (mounted) _resetForNewEvent();
          });
        } else {
          _statusText = '❌ ${response['message'] ?? 'Eroare la salvare'}';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isAnalyzing = false;
        _statusText = '❌ Eroare: $e';
      });
    }
  }
}
