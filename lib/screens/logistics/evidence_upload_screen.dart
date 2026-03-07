import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../services/backend_service.dart';
import '../../services/trips_api_service.dart';

class EvidenceUploadScreen extends StatefulWidget {
  final String eventId;
  const EvidenceUploadScreen({super.key, required this.eventId});

  @override
  State<EvidenceUploadScreen> createState() => _EvidenceUploadScreenState();
}

class _EvidenceUploadScreenState extends State<EvidenceUploadScreen> {
  final TextEditingController _summaryCtrl = TextEditingController();
  bool _isSubmitting = false;

  Future<void> _submitEvidence(String bundleType) async {
    setState(() => _isSubmitting = true);
    
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;

      // Obtine si trip ID-ul curent daca exista
      final activeTrip = await TripsApiService.getActiveTrip();
      final tripId = activeTrip?['id'];

      // 1. Creare Pachet (Bundle)
      final bundleUrl = '${BackendService.AI_MANAGER_URL}/logistics/evidence';
      final bundleRes = await http.post(
        Uri.parse(bundleUrl),
        headers: {
          'Authorization': 'Bearer ${session.accessToken}',
          'Content-Type': 'application/json'
        },
        body: jsonEncode({
          'eventId': widget.eventId,
          'tripId': tripId,
          'employeeId': session.user.id,
          'bundleType': bundleType, // ex: arrival_proof, pickup_proof
          'status': 'generated',
          'summary': _summaryCtrl.text,
        })
      );

      if (bundleRes.statusCode == 201) {
        // Mocking imaginea (În varianta finală ar folosi ImagePicker + GCS bucket upload)
        final assetUrl = '${BackendService.AI_MANAGER_URL}/logistics/evidence/assets';
        await http.post(
          Uri.parse(assetUrl),
          headers: {
            'Authorization': 'Bearer ${session.accessToken}',
            'Content-Type': 'application/json'
          },
          body: jsonEncode({
            'eventId': widget.eventId,
            'tripId': tripId,
            'employeeId': session.user.id,
            'sourceUrl': 'https://dummyimage.com/600x400/000/fff&text=Dovada+Foto+$bundleType',
            'sourceType': 'url',
            'assetKind': 'photo'
          })
        );
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dovada a fost atașată cu succes!'), backgroundColor: Colors.green));
          _summaryCtrl.clear();
        }
      } else {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare conexiune'), backgroundColor: Colors.red));
      }
    } catch (e) {
      debugPrint('[Evidence] Upload Error: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Încărcare Dovezi', style: TextStyle(color: Colors.white)),
        backgroundColor: Colors.indigo,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      backgroundColor: Colors.grey[100],
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.photo_camera, size: 80, color: Colors.indigo),
            const SizedBox(height: 16),
            const Text(
              'Atașați fotografii relevante din locație, pentru preluări/predări de recuzită sau documente.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16, color: Colors.black54),
            ),
            const SizedBox(height: 32),
            TextField(
              controller: _summaryCtrl,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: 'Note extra (Opțional)',
                hintText: 'A apărut o întârziere la barieră?',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 24),
            _isSubmitting
                ? const Center(child: CircularProgressIndicator())
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(padding: const EdgeInsets.all(16), backgroundColor: Colors.indigo, foregroundColor: Colors.white),
                        icon: const Icon(Icons.store),
                        label: const Text('Dovadă Preluare / Sediu'),
                        onPressed: () => _submitEvidence('pickup_proof'),
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(padding: const EdgeInsets.all(16), backgroundColor: Colors.teal, foregroundColor: Colors.white),
                        icon: const Icon(Icons.celebration),
                        label: const Text('Dovadă Sosire Eveniment'),
                        onPressed: () => _submitEvidence('arrival_proof'),
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(padding: const EdgeInsets.all(16), backgroundColor: Colors.deepOrange, foregroundColor: Colors.white),
                        icon: const Icon(Icons.money),
                        label: const Text('Atașare Bonuri / Cheltuili'),
                        onPressed: () => _submitEvidence('receipt_proof'),
                      ),
                    ],
                  )
          ],
        ),
      ),
    );
  }
}
