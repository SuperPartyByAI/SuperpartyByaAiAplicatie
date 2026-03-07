import 'package:flutter/material.dart';

class StaffHoursScreen extends StatelessWidget {
  const StaffHoursScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Orele Mele (Payroll)'),
        backgroundColor: Colors.indigo,
      ),
      body: const Center(
        child: Text('Istoric prezențe și validări pentru calculul salarial (Faza F)'),
      ),
    );
  }
}
