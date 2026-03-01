import 'package:flutter/material.dart';

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
  @override
  Widget build(BuildContext context) {
    return const SizedBox.shrink();
  }
}
