import 'package:flutter/material.dart';
import 'package:superparty_app/services/trips_api_service.dart';

class AdminTripReviewScreen extends StatefulWidget {
  const AdminTripReviewScreen({super.key});

  @override
  State<AdminTripReviewScreen> createState() => _AdminTripReviewScreenState();
}

class _AdminTripReviewScreenState extends State<AdminTripReviewScreen> {
  List<dynamic> _candidates = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchCandidates();
  }

  Future<void> _fetchCandidates() async {
    setState(() => _isLoading = true);
    final data = await TripsApiService.getPendingCandidates();
    setState(() {
      _candidates = data;
      _isLoading = false;
    });
  }

  Future<void> _handleReview(String candId, String action) async {
    final success = await TripsApiService.reviewCandidate(candId, action, 'Reviewed from Admin Panel');
    if (success) {
      setState(() {
        final idx = _candidates.indexWhere((c) => c['id'] == candId);
        if (idx != -1) {
          _candidates[idx]['review_status'] = action;
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Acțiune înregistrată: ${action.toUpperCase()}')),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
           const SnackBar(content: Text('Eroare la salvarea deciziei! Contacți suportul.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Panel: AI Review', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: Colors.deepPurple,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _candidates.isEmpty
              ? const Center(child: Text('Nu există candidaturi pending pentru review.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _candidates.length,
                  itemBuilder: (context, index) {
                    final cand = _candidates[index];
                    final isPending = cand['review_status'] == 'pending';
                    
                    // Supabase raw join safety nets
                    final empName = cand['users'] != null && cand['users']['nume_prenume'] != null 
                        ? cand['users']['nume_prenume'] 
                        : 'Unknown Employee';
                    final evidenceText = cand['evidence_bundles'] != null && cand['evidence_bundles']['summary'] != null
                        ? cand['evidence_bundles']['summary']
                        : 'N/A';
                    final confidence = (cand['ai_confidence'] ?? 0.0) as double;

                    return Card(
                      elevation: 3,
                      margin: const EdgeInsets.only(bottom: 16),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    empName,
                                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Chip(
                                  label: Text(
                                    '${(confidence * 100).toStringAsFixed(0)}% Conf.',
                                    style: const TextStyle(color: Colors.white, fontSize: 12),
                                  ),
                                  backgroundColor: confidence > 0.9 ? Colors.green : Colors.orange,
                                )
                              ],
                            ),
                            const Divider(),
                            const SizedBox(height: 8),
                            Text('Tip Abatere: ${cand['candidate_type']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 4),
                            Text('Impact Propus: ${cand['minutes']} minute', style: TextStyle(color: (cand['minutes'] ?? 0) < 0 ? Colors.red : Colors.black, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 8),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
                              child: Text('Dovadă/Rezumat: $evidenceText', style: const TextStyle(fontStyle: FontStyle.italic)),
                            ),
                            const SizedBox(height: 16),
                            if (isPending)
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                children: [
                                  ElevatedButton.icon(
                                    onPressed: () => _handleReview(cand['id'], 'approved'),
                                    icon: const Icon(Icons.check),
                                    label: const Text('Aprobă'),
                                    style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                                  ),
                                  ElevatedButton.icon(
                                    onPressed: () => _handleReview(cand['id'], 'rejected'),
                                    icon: const Icon(Icons.close),
                                    label: const Text('Respinge'),
                                    style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
                                  ),
                                ],
                              )
                            else
                              Center(
                                child: Text(
                                  'Status final: ${cand['review_status'].toString().toUpperCase()}',
                                  style: TextStyle(
                                    color: cand['review_status'] == 'approved' ? Colors.green : Colors.red,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
