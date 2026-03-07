import 'package:flutter/material.dart';

class InventoryChecklistScreen extends StatefulWidget {
  final String eventId;
  const InventoryChecklistScreen({super.key, required this.eventId});

  @override
  State<InventoryChecklistScreen> createState() => _InventoryChecklistScreenState();
}

class _InventoryChecklistScreenState extends State<InventoryChecklistScreen> {
  // TODO: Fetch requirements from BackendService API

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Componență Recuzită'),
        backgroundColor: Colors.indigo,
      ),
      body: const Center(
        child: Text('Lista de inventar și scanare/bifare manuală (Faza D)'),
      ),
    );
  }
}
