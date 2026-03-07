import 'package:flutter/material.dart';

class AdminTripReviewScreen extends StatefulWidget {
  const AdminTripReviewScreen({super.key});

  @override
  State<AdminTripReviewScreen> createState() => _AdminTripReviewScreenState();
}

class _AdminTripReviewScreenState extends State<AdminTripReviewScreen> {
  // Mock data for Phase 1 Foundation
  final List<Map<String, dynamic>> _candidates = [
    {
      'id': 'cand_01',
      'trip_id': 'trip_001',
      'employee_name': 'Ion Soferu',
      'type': 'penalty_late_to_hq',
      'minutes': -15,
      'confidence': 0.95,
      'ai_recommendation': 'warning',
      'evidence': 'Arrived at HQ at 14:15, 15 mins late.',
      'status': 'pending'
    },
    {
      'id': 'cand_02',
      'trip_id': 'trip_001',
      'employee_name': 'Ion Soferu',
      'type': 'penalty_gps_signal_gap',
      'minutes': 0,
      'confidence': 1.0,
      'ai_recommendation': 'investigate',
      'evidence': 'Lost signal for 32 consecutive minutes.',
      'status': 'pending'
    }
  ];

  void _handleReview(String candId, String action) {
    setState(() {
      final idx = _candidates.indexWhere((c) => c['id'] == candId);
      if (idx != -1) {
        _candidates[idx]['status'] = action;
        // In reality, this will call POST /logistics/staff-hours/review
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Acțiune înregistrată: ${action.toUpperCase()}')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Panel: AI Review', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: Colors.deepPurple,
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _candidates.length,
        itemBuilder: (context, index) {
          final cand = _candidates[index];
          final isPending = cand['status'] == 'pending';
          
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
                      Text(
                        cand['employee_name'],
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      Chip(
                        label: Text(
                          '${cand['confidence'] * 100}% Conf.',
                          style: const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                        backgroundColor: cand['confidence'] > 0.9 ? Colors.green : Colors.orange,
                      )
                    ],
                  ),
                  const Divider(),
                  const SizedBox(height: 8),
                  Text('Tip Abatere: ${cand['type']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text('Impact Propus: ${cand['minutes']} minute', style: TextStyle(color: cand['minutes'] < 0 ? Colors.red : Colors.black, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
                    child: Text('Dovadă: ${cand['evidence']}', style: const TextStyle(fontStyle: FontStyle.italic)),
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
                        'Status final: ${cand['status'].toString().toUpperCase()}',
                        style: TextStyle(
                          color: cand['status'] == 'approved' ? Colors.green : Colors.red,
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
