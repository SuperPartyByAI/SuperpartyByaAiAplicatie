import 'package:flutter/material.dart';
import '../../services/trips_api_service.dart';

class StaffHoursScreen extends StatefulWidget {
  const StaffHoursScreen({super.key});

  @override
  State<StaffHoursScreen> createState() => _StaffHoursScreenState();
}

class _StaffHoursScreenState extends State<StaffHoursScreen> {
  bool _isLoading = true;
  List<dynamic> _candidates = [];

  @override
  void initState() {
    super.initState();
    _fetchCandidates();
  }

  Future<void> _fetchCandidates() async {
    setState(() => _isLoading = true);
    try {
      final data = await TripsApiService.getPendingCandidates();
      if (mounted) {
        setState(() {
          _candidates = data;
        });
      }
    } catch (e) {
      debugPrint('[StaffHours] Load Error: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _reviewItem(String id, String status) async {
    try {
      final success = await TripsApiService.reviewCandidate(id, status, 'Aprobat din aplicație via Superparty V6');
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Candidatură salvată ca: $status'), backgroundColor: Colors.green));
        _fetchCandidates();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare rețea'), backgroundColor: Colors.red));
      }
    } catch (e) {
      debugPrint('[StaffHours] Review Action Error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Aprobări Pontaj / Dispecerat', style: TextStyle(color: Colors.white)),
        backgroundColor: Colors.indigo,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchCandidates),
        ],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _candidates.isEmpty
              ? const Center(child: Text('Nu există ore pending pentru aprobat.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _candidates.length,
                  itemBuilder: (context, index) {
                    final item = _candidates[index];
                    final bundle = item['evidence_bundles'] ?? {};
                    final type = item['candidate_type'] ?? 'Activitate';
                    final mins = item['minutes'] ?? 0;
                    final aiNote = bundle['summary'] ?? (item['ai_confidence'] != null ? "Confidență AI: \${item['ai_confidence']}" : 'Fără AI check');

                    return Card(
                      elevation: 3,
                      margin: const EdgeInsets.only(bottom: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(type.toString().toUpperCase(), style: TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo[800])),
                                Chip(label: Text('$mins MIN'), backgroundColor: Colors.amber[100]),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text('Info/AI: $aiNote', style: TextStyle(color: Colors.grey[700], fontStyle: FontStyle.italic)),
                            const Divider(height: 24),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                OutlinedButton.icon(
                                  icon: const Icon(Icons.close, color: Colors.red),
                                  label: const Text('REJECT', style: TextStyle(color: Colors.red)),
                                  onPressed: () => _reviewItem(item['id'], 'rejected'),
                                ),
                                const SizedBox(width: 12),
                                ElevatedButton.icon(
                                  style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo, foregroundColor: Colors.white),
                                  icon: const Icon(Icons.check),
                                  label: const Text('APPROVE'),
                                  onPressed: () => _reviewItem(item['id'], 'approved'),
                                ),
                              ],
                            )
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
