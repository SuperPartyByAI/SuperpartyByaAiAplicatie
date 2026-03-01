import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';
import 'package:url_launcher/url_launcher.dart';

class ConsentScreen extends StatefulWidget {
  final VoidCallback onConsentGiven;

  const ConsentScreen({super.key, required this.onConsentGiven});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool _isLoading = false;

  Future<void> _handleConsent() async {
    setState(() => _isLoading = true);
    
    try {
      final backend = Provider.of<BackendService>(context, listen: false);
      // Hardcoded version for now, could be fetched from config
      await backend.submitConsent('v1'); 
      
      if (mounted) {
        widget.onConsentGiven();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleDecline() async {
    // If they decline, we must sign them out as they cannot use the app
    final auth = Provider.of<AuthService>(context, listen: false);
    await auth.signOut();
  }

  Future<void> _openPrivacyPolicy() async {
    const url = 'https://superpartybyai.github.io/superparty-privacy/';
    if (await canLaunchUrl(Uri.parse(url))) {
      await launchUrl(Uri.parse(url));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 20),
              const Icon(Icons.security, size: 64, color: Color(0xFF008069)),
              const SizedBox(height: 24),
              const Text(
                'Notificare privind înregistrarea apelurilor',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Pentru a utiliza aplicația SuperParty, este necesar acordul dumneavoastră privind înregistrarea apelurilor.',
                        style: TextStyle(fontSize: 16),
                      ),
                      const SizedBox(height: 16),
                      _buildBulletPoint('Apelurile efectuate și primite prin aplicație pot fi înregistrate și stocate.'),
                      _buildBulletPoint('Scopurile sunt operaționale, control al calității, dezvoltare CRM și îmbunătățirea serviciului (inclusiv prin AI).'),
                      _buildBulletPoint('Interlocutorii vor fi informați automat ("Acest apel poate fi înregistrat") înainte de conectare.'),
                      _buildBulletPoint('Aveți dreptul de a solicita ștergerea datelor oricând din setările aplicației.'),
                      const SizedBox(height: 20),
                      InkWell(
                        onTap: _openPrivacyPolicy,
                        child: const Text(
                          'Citește Politica de Confidențialitate completă',
                          style: TextStyle(
                            color: Colors.blue,
                            decoration: TextDecoration.underline,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              if (_isLoading)
                const Center(child: CircularProgressIndicator())
              else
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ElevatedButton(
                      onPressed: _handleConsent,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF008069),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      child: const Text('Sunt de acord', style: TextStyle(fontSize: 16)),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: _handleDecline,
                      child: const Text('Renunță și ieși din cont', style: TextStyle(color: Colors.grey)),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBulletPoint(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('• ', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 16, height: 1.4))),
        ],
      ),
    );
  }
}
