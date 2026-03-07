import 'package:flutter/material.dart';

class EvidenceUploadScreen extends StatefulWidget {
  final String eventId;
  const EvidenceUploadScreen({super.key, required this.eventId});

  @override
  State<EvidenceUploadScreen> createState() => _EvidenceUploadScreenState();
}

class _EvidenceUploadScreenState extends State<EvidenceUploadScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Încărcare Dovezi'),
        backgroundColor: Colors.indigo,
      ),
      body: const Center(
        child: Text('Formular foto/video pentru ETA, Pickup, Arrived (Faza D)'),
      ),
    );
  }
}
