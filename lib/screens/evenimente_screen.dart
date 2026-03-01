import 'package:flutter/material.dart';

/// EvenimenteScreen — Lista evenimentelor rezervate din Database
/// Afișează evenimentul „mamă" cu short code (01, 02...) + lista rolurilor (01A, 01B...)
class EvenimenteScreen extends StatelessWidget {
  const EvenimenteScreen({super.key});

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
              Expanded(child: _buildEventsList()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1220).withOpacity(0.72),
        border: const Border(bottom: BorderSide(color: Color(0x14FFFFFF))),
      ),
      child: const Row(
        children: [
          Text(
            '📅 Evenimente Rezervate',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Color(0xFFEAF1FF),
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEventsList() {
    return StreamBuilder<dynamic>(
      stream: /* Removed */ ;
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, color: Color(0xFFFF7878), size: 48),
                  const SizedBox(height: 12),
                  Text(
                    'Eroare: ${snapshot.error}',
                    style: const TextStyle(color: Color(0xFFFF7878), fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        }

        final docs = snapshot.data?.docs ?? [];

        if (docs.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.event_busy, size: 60, color: const Color(0xFFEAF1FF).withOpacity(0.2)),
                const SizedBox(height: 16),
                Text(
                  'Nu ai evenimente încă.\nDu-te la AI → "Superparty AI >" pentru a extrage un formular.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.4), fontSize: 14, height: 1.5),
                ),
              ],
            ),
          );
        }

        return ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: docs.length,
          itemBuilder: (context, index) {
            final doc = docs[index];
            final data = doc.data() as Map<String, dynamic>;
            return _EventCard(data: data, docId: doc.id);
          },
        );
      },
    );
  }
}

class _EventCard extends StatefulWidget {
  final Map<String, dynamic> data;
  final String docId;

  const _EventCard({required this.data, required this.docId});

  @override
  State<_EventCard> createState() => _EventCardState();
}

class _EventCardState extends State<_EventCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final shortCode = data['shortCode']?.toString() ?? '??';
    final date = data['date']?.toString() ?? 'Fără dată';
    final address = data['address']?.toString() ?? '';
    final sarbatoritNume = data['sarbatoritNume']?.toString() ?? '';
    final sarbatoritVarsta = data['sarbatoritVarsta']?.toString() ?? '';

    // Client can be Map or String
    String clientName = '';
    String clientPhone = '';
    final clientField = data['client'];
    if (clientField is Map) {
      clientName = clientField['name']?.toString() ?? '';
      clientPhone = clientField['phone']?.toString() ?? '';
    } else if (clientField is String) {
      clientName = clientField;
    }

    // Roles
    final roles = data['roles'] as List<dynamic>? ?? [];
    final rolesDraft = data['rolesDraft'] as List<dynamic>? ??
        (data['draftEvent'] is Map ? (data['draftEvent'] as Map)['rolesDraft'] as List<dynamic>? ?? [] : []);
    final allRoles = roles.isNotEmpty ? roles : rolesDraft;

    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.06),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header — event mama
            Container(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Short code badge
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF4ECDC4), Color(0xFF44B8B0)],
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '#$shortCode',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Event details
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '📅 $date',
                          style: const TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w800, fontSize: 15),
                        ),
                        if (address.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              '📍 $address',
                              style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.6), fontSize: 12),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        if (sarbatoritNume.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              '🎂 $sarbatoritNume${sarbatoritVarsta.isNotEmpty ? ' ($sarbatoritVarsta)' : ''}',
                              style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.7), fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                          ),
                        if (clientName.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              '👤 $clientName${clientPhone.isNotEmpty ? ' • $clientPhone' : ''}',
                              style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.5), fontSize: 12),
                            ),
                          ),
                      ],
                    ),
                  ),
                  // Expand chevron
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFFEAF1FF).withOpacity(0.4),
                  ),
                ],
              ),
            ),

            // Roles count badge
            if (allRoles.isNotEmpty && !_expanded)
              Padding(
                padding: const EdgeInsets.only(left: 14, bottom: 10),
                child: Text(
                  '🎭 ${allRoles.length} roluri',
                  style: TextStyle(color: const Color(0xFF4ECDC4).withOpacity(0.8), fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),

            // Expanded roles list
            if (_expanded && allRoles.isNotEmpty) ...[
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 14),
                height: 1,
                color: Colors.white.withOpacity(0.06),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '🎭 Roluri & Servicii',
                      style: TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w900, fontSize: 13),
                    ),
                    const SizedBox(height: 8),
                    ...allRoles.asMap().entries.map((entry) {
                      final role = entry.value is Map ? Map<String, dynamic>.from(entry.value as Map) : <String, dynamic>{'label': entry.value.toString()};
                      final label = role['label']?.toString() ?? 'Rol';
                      final details = role['details']?.toString() ?? '';
                      final roleCode = role['roleCode']?.toString() ?? role['slot']?.toString() ?? String.fromCharCode(65 + entry.key);
                      final time = role['startTime']?.toString() ?? '';
                      final duration = role['durationMinutes']?.toString() ?? role['durationMin']?.toString() ?? '';

                      return Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF4D88FF).withOpacity(0.08),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFF4D88FF).withOpacity(0.2)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFF4D88FF).withOpacity(0.2),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                roleCode,
                                style: const TextStyle(color: Color(0xFFEAF1FF), fontWeight: FontWeight.w900, fontSize: 10),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                details.isNotEmpty ? '$label — $details' : label,
                                style: const TextStyle(color: Color(0xFFEAF1FF), fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                            ),
                            if (time.isNotEmpty)
                              Text(
                                '🕐 $time${duration.isNotEmpty ? ' (${duration}min)' : ''}',
                                style: TextStyle(color: const Color(0xFFEAF1FF).withOpacity(0.4), fontSize: 11),
                              ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
