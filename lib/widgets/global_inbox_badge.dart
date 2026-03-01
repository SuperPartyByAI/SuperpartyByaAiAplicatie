import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../screens/app_inbox_screen.dart';
import '../main.dart' show navigatorKey;

/// A controller that manages the global floating inbox badge.
/// Insert it once using: GlobalInboxBadgeOverlay.show(context);
class GlobalInboxBadgeOverlay {
  static OverlayEntry? _entry;

  static void show(BuildContext context) {
    // Disabled globally due to severe memory leak and stream spamming on App Boot.
    // The badge is now integrated directly into the AppBar of AdminDashboardScreen instead.
    return;
  }

  static void remove() {
    _entry?.remove();
    _entry = null;
  }
}

class _InboxBadgeWidget extends StatefulWidget {
  const _InboxBadgeWidget();

  @override
  State<_InboxBadgeWidget> createState() => _InboxBadgeWidgetState();
}

class _InboxBadgeWidgetState extends State<_InboxBadgeWidget> {
  static bool _isNavigating = false; // Prevent multiple taps opening multiple screens
  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final topPadding = mediaQuery.padding.top;

    return Positioned(
      right: 12,
      top: topPadding + 10,
      child: StreamBuilder<User?>(
        stream: FirebaseAuth.instance.authStateChanges(),
        builder: (context, authSnap) {
          final user = authSnap.data;
          if (user == null) return const SizedBox.shrink();

          return StreamBuilder<QuerySnapshot>(
            stream: FirebaseFirestore.instance
                .collection('app_inbox')
                .snapshots(),
            builder: (context, snap) {
              int unread = 0;
              if (snap.hasData) {
                for (final doc in snap.data!.docs) {
                  final data = doc.data() as Map<String, dynamic>;
                  final readBy = data['readBy'] as List<dynamic>? ?? [];
                  if (!readBy.contains(user.uid)) unread++;
                }
              }

              return Material(
                color: Colors.transparent,
                child: GestureDetector(
                  onTap: () async {
                    if (_isNavigating) return; // Block rapid double-taps
                    _isNavigating = true;
                    await navigatorKey.currentState?.push(
                      MaterialPageRoute(
                        builder: (_) => const AppInboxScreen(),
                      ),
                    );
                    _isNavigating = false; // Reset after inbox is closed
                  },
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Icon(
                        unread > 0 ? Icons.mark_email_unread : Icons.mail,
                        color: Colors.white,
                        size: 30,
                        shadows: const [
                          Shadow(color: Colors.black87, blurRadius: 8),
                          Shadow(color: Colors.black54, blurRadius: 4),
                        ],
                      ),
                      if (unread > 0)
                        Positioned(
                          right: -4,
                          top: -4,
                          child: Container(
                            padding: const EdgeInsets.all(3),
                            decoration: const BoxDecoration(
                              color: Colors.red,
                              shape: BoxShape.circle,
                            ),
                            child: Text(
                              unread > 9 ? '9+' : unread.toString(),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
