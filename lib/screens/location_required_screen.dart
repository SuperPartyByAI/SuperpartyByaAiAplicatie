import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:app_settings/app_settings.dart';
import 'dart:io' show Platform;

class LocationRequiredScreen extends StatelessWidget {
  final List<String> reasons;
  final VoidCallback onRetry;

  const LocationRequiredScreen({
    super.key,
    required this.reasons,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Atenție: Locație Obligatorie'),
        backgroundColor: Colors.red[800],
        foregroundColor: Colors.white,
        automaticallyImplyLeading: false, 
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(
                Icons.location_off,
                size: 80,
                color: Colors.redAccent,
              ),
              const SizedBox(height: 24),
              const Text(
                'Aplicația necesită acces permanent la locație pentru operare.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: Colors.black87,
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.red[50],
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red[200]!),
                ),
                child: Column(
                  children: reasons.map((reason) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.error_outline, color: Colors.red, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              reason,
                              style: const TextStyle(fontSize: 15, color: Colors.black87),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 32),
              ElevatedButton.icon(
                icon: const Icon(Icons.settings),
                label: const Text('Deschide Setările Aplicației'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue[700],
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                onPressed: () {
                  AppSettings.openAppSettings(type: AppSettingsType.settings);
                },
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                icon: const Icon(Icons.gps_fixed),
                label: const Text('Activează GPS / Locația'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange[700],
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                onPressed: () {
                  // Direct to Location source settings toggle (GPS hardware)
                  AppSettings.openAppSettings(type: AppSettingsType.location);
                },
              ),
              const Spacer(),
              const Text(
                'Te rugăm să remediezi setările de mai sus, apoi apasă pe "Reîncearcă".',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 13),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.refresh),
                label: const Text('R E Î N C E A R C Ă', style: TextStyle(fontSize: 16, letterSpacing: 1.2)),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  foregroundColor: Colors.blue[800],
                  side: BorderSide(color: Colors.blue[800]!, width: 2),
                ),
                onPressed: onRetry,
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
