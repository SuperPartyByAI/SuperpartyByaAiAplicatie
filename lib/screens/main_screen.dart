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

class _DashboardTab extends StatelessWidget {
  const _DashboardTab();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF008069),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Icon(Icons.dashboard_customize, size: 80, color: Colors.grey),
            SizedBox(height: 20),
            Text(
              'Dashboard Angajați',
              style: TextStyle(fontSize: 20, color: Colors.black54),
            ),
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
                await /* Removed */ ;
                
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
