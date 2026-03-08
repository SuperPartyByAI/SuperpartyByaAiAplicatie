import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'chat_list_screen.dart';
import 'ai_chat_screen.dart';
import 'admin_requests_screen.dart';
import 'calls_screen.dart';
import 'settings_screen.dart';
import 'accounts_screen.dart';
import 'team_management_screen.dart';
import 'evenimente_screen.dart';
import 'whatsapp_monitor_screen.dart';
import 'app_inbox_screen.dart';
import 'logistics/inventory_checklist_screen.dart';
import 'logistics/evidence_upload_screen.dart';
import 'logistics/staff_hours_screen.dart';
import 'admin_trip_review_screen.dart';
import '../services/trips_api_service.dart';
import 'dart:async';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _selectedIndex = 1; // Default to Dashboard Tab

  static const List<Widget> _pages = <Widget>[
    CallsScreen(),                                // 0: Centrala & Appeals
    _DashboardTab(),                              // 1: CRM / Angajati Dashboard
    ChatListScreen(),                             // 2: WhatsApp
    EvenimenteScreen(),                           // 3: Evenimente Rezervate
    AIChatScreen(),                               // 4: AI Control
  ];

  void _onAdminTap() {
    final user = (Supabase.instance.client.auth.currentUser);
    if (user != null && user.email == 'ursache.andrei1995@gmail.com') {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _AdminDashboardScreen()));
    } else {
      // Do nothing for unauthorized users
      print('DEBUG: Unauthorized Admin Dashboard tap attempt by ${user?.email}');
    }
  }
  void _onItemTapped(int index) {
    if (index == 4) {
      // AI Control - Open as standard navigation page (like WhatsApp)
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => const AIChatScreen(),
      ));
      return;
    }
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Scaffold(
          body: _pages.elementAt(_selectedIndex),
          bottomNavigationBar: BottomNavigationBar(
            type: BottomNavigationBarType.fixed, // Needed for 4+ items
            items: const <BottomNavigationBarItem>[
              BottomNavigationBarItem(
                icon: Icon(Icons.phone_in_talk),
                label: 'Apeluri',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.dashboard),
                label: 'Dashboard',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.chat),
                label: 'WhatsApp',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.event),
                label: 'Evenimente',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.auto_awesome), // Sparkles icon for AI
                label: 'AI',
                backgroundColor: Colors.purple,
              ),
            ],
            currentIndex: _selectedIndex,
            selectedItemColor: _selectedIndex == 4 ? Colors.purple : const Color(0xFF008069),
            onTap: _onItemTapped,
          ),
        ),
        // Hidden 12-tap gesture detector over the top-left corner
        Positioned(
          left: 0,
          top: 0,
          width: 80,
          height: 120, // slightly taller to capture taps near the top edge easily
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: _onAdminTap,
            child: const SizedBox(width: 80, height: 120),
          ),
        ),
      ],
    );
  }
}

class _DashboardTab extends StatefulWidget {
  const _DashboardTab();

  @override
  State<_DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<_DashboardTab> {
  bool _isLoading = false;
  String? _activeTripId;
  DateTime? _startTime;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _checkActiveTrip();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_startTime != null && mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _checkActiveTrip() async {
    final trip = await TripsApiService.getActiveTrip();
    if (mounted) {
      setState(() {
        _activeTripId = trip?['id'];
        _startTime = trip != null ? DateTime.parse(trip['started_at']) : null;
      });
    }
  }

  Future<void> _startTrip() async {
    setState(() => _isLoading = true);
    final tripId = await TripsApiService.startTrip();
    if (mounted) {
      if (tripId != null) {
        setState(() {
          _activeTripId = tripId;
          _startTime = DateTime.now();
        });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cursă începută!', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare la pornire cursă.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      }
      setState(() => _isLoading = false);
    }
  }

  Future<void> _endTrip() async {
    setState(() => _isLoading = true);
    final success = await TripsApiService.endTrip();
    if (mounted) {
      if (success) {
        setState(() {
          _activeTripId = null;
          _startTime = null;
        });
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Cursă Finalizată ✔️'),
            content: const Text('Logurile de rută și estimările de kilometri au fost trimise la AI Manager.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
            ],
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare la finalizare cursă.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      }
      setState(() => _isLoading = false);
    }
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, "0");
    String twoDigitMinutes = twoDigits(d.inMinutes.remainder(60));
    String twoDigitSeconds = twoDigits(d.inSeconds.remainder(60));
    return "${twoDigits(d.inHours)}:$twoDigitMinutes:$twoDigitSeconds";
  }

  @override
  Widget build(BuildContext context) {
    final isActive = _activeTripId != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Logistică & Transport', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: isActive ? Colors.indigo : const Color(0xFF008069),
        elevation: 0,
      ),
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 500),
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isActive ? Colors.indigo.withOpacity(0.1) : Colors.grey.withOpacity(0.1),
                  boxShadow: isActive ? [BoxShadow(color: Colors.indigo.withOpacity(0.2), blurRadius: 30, spreadRadius: 10)] : [],
                ),
                child: Icon(
                  isActive ? Icons.local_shipping : Icons.hail,
                  size: 100,
                  color: isActive ? Colors.indigo : Colors.grey[400],
                ),
              ),
              const SizedBox(height: 32),
              Text(
                isActive ? 'Cursă în Desfășurare' : 'Gata de Plecare?',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: isActive ? Colors.indigo : Colors.black87,
                ),
              ),
              const SizedBox(height: 8),
              if (isActive && _startTime != null) ...[
                Text(
                  _formatDuration(DateTime.now().difference(_startTime!)),
                  style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w300, color: Colors.indigo),
                ),
                const SizedBox(height: 4),
                const Text('Se înregistrează ruta GPS în fundal...', style: TextStyle(color: Colors.black54)),
              ] else ...[
                const Text(
                  'Pornește cursa pentru a activa logarea rutelor și estimarea automată de combustibil / distanțe.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, color: Colors.black54),
                ),
              ],
              const SizedBox(height: 48),
              _isLoading
                  ? const CircularProgressIndicator()
                  : ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isActive ? Colors.redAccent : Colors.indigo,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                        elevation: 4,
                      ),
                      onPressed: isActive ? _endTrip : _startTrip,
                      icon: Icon(isActive ? Icons.stop : Icons.play_arrow, size: 28),
                      label: Text(
                        isActive ? 'ÎNCHEIE CURSA' : 'START CURSĂ',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.2),
                      ),
                    ),
              const SizedBox(height: 40),
              // Acțiuni Rapide de Logistică
              if (isActive) ...[
                const Divider(),
                const SizedBox(height: 16),
                const Text('Acțiuni Cursă', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.black87)),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  alignment: WrapAlignment.center,
                  children: [
                    _buildActionButton(
                      context,
                      icon: Icons.inventory_2,
                      label: 'Verificare\nRecuzită',
                      color: Colors.orange,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InventoryChecklistScreen(eventId: 'test_event'))),
                    ),
                    _buildActionButton(
                      context,
                      icon: Icons.add_a_photo,
                      label: 'Încărcare\nDovezi',
                      color: Colors.blue,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const EvidenceUploadScreen(eventId: 'test_event'))),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 16),
              ListTile(
                leading: const CircleAvatar(backgroundColor: Colors.indigo, child: Icon(Icons.access_time, color: Colors.white)),
                title: const Text('Orele Mele (Payroll)', style: TextStyle(fontWeight: FontWeight.bold)),
                subtitle: const Text('Istoric prezențe și validări pentru calculatoare salariale.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const StaffHoursScreen())),
              ),
              const Divider(),
              ListTile(
                leading: const CircleAvatar(backgroundColor: Colors.purple, child: Icon(Icons.admin_panel_settings, color: Colors.white)),
                title: const Text('Admin Panel (Review AI)', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.purple)),
                subtitle: const Text('Aprobare / respingere penalizări propuse de AI.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminTripReviewScreen())),
              ),
            ],
          ),
        ),
      ),
      ),
    );
  }

  Widget _buildActionButton(BuildContext context, {required IconData icon, required String label, required Color color, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 140,
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, 4))
          ],
        ),
        child: Column(
          children: [
            Icon(icon, size: 40, color: color),
            const SizedBox(height: 12),
            Text(label, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black87)),
          ],
        ),
      ),
    );
  }
}

class _AdminDashboardScreen extends StatelessWidget {
  const _AdminDashboardScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Dashboard', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: Colors.black87,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.mail, color: Colors.white),
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const AppInboxScreen(),
              ));
            },
          ),
        ],
      ),
      backgroundColor: Colors.grey[100],
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildMenuCard(
            context,
            icon: Icons.campaign,
            title: 'Anunțuri Echipă (Cutie Poștală)',
            subtitle: 'Trimite o notificare în Inbox-ul tuturor angajaților',
            onTap: () => _showAnnouncementDialog(context),
            color: Colors.purple,
          ),
          const SizedBox(height: 16),
          _buildMenuCard(
            context,
            icon: Icons.person_add,
            title: 'Cereri de Înregistrare',
            color: Colors.orange,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminRequestsScreen())),
          ),
          const SizedBox(height: 16),
          _buildMenuCard(
            context,
            icon: Icons.people,
            title: 'Administrare Utilizatori',
            color: Colors.blue,
            onTap: () {
               Navigator.push(context, MaterialPageRoute(builder: (_) => const TeamManagementScreen()));
            },
          ),
          const SizedBox(height: 16),
          _buildMenuCard(
            context,
            icon: Icons.settings,
            title: 'Setări & Confidențialitate',
            color: Colors.green,
            onTap: () {
              Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
            },
          ),
          const SizedBox(height: 16),
          _buildMenuCard(
            context,
            icon: Icons.qr_code_scanner,
            title: 'Conectare WhatsApp (QR)',
            color: const Color(0xFF008069),
            onTap: () {
              Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountsScreen()));
            },
          ),
          const SizedBox(height: 16),
          _buildMenuCard(
            context,
            icon: Icons.monitor_heart,
            title: 'Server Monitor (Live)',
            color: Colors.redAccent,
            onTap: () {
              Navigator.push(context, MaterialPageRoute(builder: (_) => const WhatsAppMonitorScreen()));
            },
          ),
        ],
      ),
    );
  }

  Widget _buildMenuCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
    required VoidCallback onTap,
    Color color = const Color(0xFF008069),
  }) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 32),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(subtitle, style: TextStyle(color: Colors.grey[600])),
                    ],
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.grey[400]),
            ],
          ),
        ),
      ),
    );
  }

  void _showAnnouncementDialog(BuildContext context) {
    final titleController = TextEditingController();
    final bodyController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Trimite Anunț Global'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(
                labelText: 'Titlu (ex: Ziua de Salariu)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: bodyController,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Mesajul tău...',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Anulează', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.purple),
            onPressed: () async {
              if (titleController.text.isEmpty || bodyController.text.isEmpty) return;
              
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Se trimite anunțul...')),
              );

              try {
                await Supabase.instance.client.functions.invoke('sendGlobalAnnouncement', body: {
                  'title': titleController.text,
                  'body': bodyController.text
                });
                
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Anunț trimis cu succes!'), backgroundColor: Colors.green),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Eroare: $e'), backgroundColor: Colors.red),
                  );
                }
              }
            },
            child: const Text('Trimite', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }
}
