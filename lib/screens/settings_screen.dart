import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/backend_service.dart';
import '../services/auth_service.dart';
import 'diagnostics_screen.dart';
import 'voip_onboarding_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isLoading = true;
  bool _aiAnalysisEnabled = true; // Default to true if missing, but we'll fetch
  final TextEditingController _deletionReasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final backend = Provider.of<BackendService>(context, listen: false);
    try {
      final profile = await backend.getUserProfile();
      if (mounted) {
        setState(() {
          // If privacySettings exists use it, otherwise default (true or false?)
          // Usually consent implies 'v1' which implies broad agreement, but granular control is good.
          if (profile['privacySettings'] != null) {
             _aiAnalysisEnabled = profile['privacySettings']['aiAnalysisEnabled'] ?? true;
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleAiAnalysis(bool value) async {
    setState(() => _aiAnalysisEnabled = value);
    final backend = Provider.of<BackendService>(context, listen: false);
    try {
      await backend.updatePrivacySettings(aiAnalysisEnabled: value);
    } catch (e) {
      if (mounted) {
        // Revert on failure
        setState(() => _aiAnalysisEnabled = !value);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Eroare: $e')));
      }
    }
  }

  Future<void> _openDeletionDialog() async {
    return showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ștergere cont și date'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Această acțiune va trimite o cerere de ștergere a datelor asociate contului tău. Vei fi contactat pe email în 30 de zile.'),
            const SizedBox(height: 10),
            TextField(
              controller: _deletionReasonController,
              decoration: const InputDecoration(
                labelText: 'Motiv (opțional)',
                hintText: 'De ce dorești ștergerea?',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Anulează'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              _submitDeletionRequest();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
            child: const Text('Trimite Cererea'),
          ),
        ],
      ),
    );
  }

  Future<void> _submitDeletionRequest() async {
    final backend = Provider.of<BackendService>(context, listen: false);
    try {
      await backend.requestDeletion(_deletionReasonController.text);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cererea a fost trimisă cu succes.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Eroare: $e')));
      }
    }
  }

  Future<void> _openPrivacyPolicy() async {
    const url = 'https://superpartybyai.github.io/superparty-privacy/';
    if (await canLaunchUrl(Uri.parse(url))) {
      await launchUrl(Uri.parse(url));
    }
  }

  Future<void> _signOut() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    await auth.signOut();
    if (mounted) {
       Navigator.of(context).popUntil((route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Setări & Confidențialitate', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF008069),
        foregroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildSectionHeader('Confidențialitate AI'),
          SwitchListTile(
            title: const Text('Permite analiza AI a apelurilor'),
            subtitle: const Text('Ajută-ne să îmbunătățim serviciile prin analiza anonimizată a conversațiilor.'),
            value: _aiAnalysisEnabled,
            onChanged: _toggleAiAnalysis,
            activeColor: const Color(0xFF008069),
          ),
          const Divider(),
          _buildSectionHeader('Informații Legale'),
          ListTile(
            leading: const Icon(Icons.policy),
            title: const Text('Politica de Confidențialitate'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: _openPrivacyPolicy,
          ),
          ListTile(
            leading: const Icon(Icons.description),
            title: const Text('Termeni și Condiții'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () async {
               const url = 'https://superpartybyai.github.io/superparty-privacy/terms.html';
               if (await canLaunchUrl(Uri.parse(url))) await launchUrl(Uri.parse(url));
            },
          ),
          const Divider(),
          _buildSectionHeader('Zona de Pericol'),
          ListTile(
            leading: const Icon(Icons.delete_forever, color: Colors.red),
            title: const Text('Solicită Ștergerea Datelor', style: TextStyle(color: Colors.red)),
            onTap: _openDeletionDialog,
          ),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            onPressed: _signOut,
            icon: const Icon(Icons.logout),
            label: const Text('Deconectare'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.grey[200],
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
          const SizedBox(height: 20),
          const Center(
            child: Text(
              'Versiune App: 1.0.8 (Compliance Update)',
              style: TextStyle(color: Colors.grey),
            ),
          ),
          const SizedBox(height: 8),
          // ── VoIP Onboarding ──
          Card(
            margin: const EdgeInsets.symmetric(vertical: 4),
            child: ListTile(
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFE8F5E9),
                child: Icon(Icons.phone_in_talk, color: Color(0xFF008069)),
              ),
              title: const Text('Configurare Apeluri VoIP',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text(
                  'Permisiuni, baterie, înregistrare Twilio',
                  style: TextStyle(fontSize: 12)),
              trailing: const Icon(Icons.arrow_forward_ios, size: 16),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const VoipOnboardingScreen())),
            ),
          ),
          // ── VoIP Diagnostics (developer) ──
          ListTile(
            leading: const Icon(Icons.bug_report, color: Colors.grey),
            title: const Text('VoIP Diagnostics', style: TextStyle(color: Colors.grey)),
            subtitle: const Text('Developer: test & debug VoIP calls', style: TextStyle(fontSize: 11)),
            trailing: const Icon(Icons.arrow_forward_ios, size: 14, color: Colors.grey),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DiagnosticsScreen())),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0, horizontal: 4.0),
      child: Text(
        title,
        style: const TextStyle(
          color: Color(0xFF008069),
          fontWeight: FontWeight.bold,
          fontSize: 14,
        ),
      ),
    );
  }
}
