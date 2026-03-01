import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../services/whatsapp_api_service.dart';
import '../../config/admin_phone.dart';

/// Staff Accounts Inbox - Shows list of WhatsApp ACCOUNTS (not conversations)
/// Each account is clickable to see its conversations
/// EXCLUDES admin phone (0737571397)
class StaffAccountsInbox extends StatefulWidget {
  const StaffAccountsInbox({super.key});

  @override
  State<StaffAccountsInbox> createState() => _StaffAccountsInboxState();
}

class _StaffAccountsInboxState extends State<StaffAccountsInbox> {
  final WhatsAppApiService _apiService = WhatsAppApiService.instance;

  List<Map<String, dynamic>> _accounts = [];
  bool _isLoading = true;
  String? _errorMessage;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadAccounts();
    
    // Auto-refresh every 30 seconds
    Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) _loadAccounts();
    });
  }

  Future<void> _loadAccounts() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final response = await _apiService.getAccountsStaff();

      if (response['success'] == true) {
        final accounts = (response['accounts'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();

        // FILTER: Exclude admin phone (0737571397)
        final filteredAccounts = accounts.where((account) {
          final phone = account['phone'] as String? ?? 
                       account['phoneNumber'] as String?;
          return !isAdminPhone(phone); // ← EXCLUDE 0737571397
        }).toList();

        if (kDebugMode) {
          debugPrint('[StaffAccountsInbox] Loaded ${filteredAccounts.length} accounts (${accounts.length} total, excluded admin)');
        }

        if (mounted) {
          setState(() {
            _accounts = filteredAccounts;
            _isLoading = false;
          });
        }
      } else {
        final errorMsg = response['message'] as String? ?? 'Failed to load accounts';
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorMessage = errorMsg;
          });
        }
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('[StaffAccountsInbox] Error loading accounts: $e');
      }
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  List<Map<String, dynamic>> get _filteredAccounts {
    if (_searchQuery.isEmpty) return _accounts;

    return _accounts.where((account) {
      final phone = account['phone'] as String? ??
                   account['phoneNumber'] as String? ??
                   '';
      final name = account['name'] as String? ?? '';
      final query = _searchQuery.toLowerCase();

      return phone.toLowerCase().contains(query) ||
             name.toLowerCase().contains(query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () {
            if (Navigator.canPop(context)) {
              Navigator.pop(context);
            } else {
              context.go('/home');
            }
          },
        ),
        title: const Text('WhatsApp Accounts - Staff'),
        backgroundColor: const Color(0xFF25D366),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadAccounts,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Search by phone or name...',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
              onChanged: (value) {
                setState(() => _searchQuery = value);
              },
            ),
          ),

          // Accounts list
          Expanded(
            child: _isLoading
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('Loading WhatsApp accounts...',
                            style: TextStyle(color: Colors.grey)),
                      ],
                    ),
                  )
                : _errorMessage != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error, color: Colors.red, size: 48),
                            const SizedBox(height: 16),
                            Text(_errorMessage!,
                                textAlign: TextAlign.center),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _loadAccounts,
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      )
                    : _filteredAccounts.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.inbox,
                                    color: Colors.grey, size: 64),
                                const SizedBox(height: 16),
                                Text(
                                  _searchQuery.isEmpty
                                      ? 'No WhatsApp accounts available'
                                      : 'No accounts match your search',
                                  style: const TextStyle(color: Colors.grey),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            itemCount: _filteredAccounts.length,
                            itemBuilder: (context, index) {
                              final account = _filteredAccounts[index];
                              return _AccountTile(
                                account: account,
                                onTap: () {
                                  // Navigate to this account's conversation list
                                  final accountId = account['id'] as String;
                                  final accountName = account['name'] as String? ??
                                                     account['phone'] as String? ??
                                                     accountId;
                                  
                                  context.push(
                                    '/whatsapp/account/$accountId/conversations',
                                    extra: {
                                      'accountId': accountId,
                                      'accountName': accountName,
                                    },
                                  );
                                },
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}

class _AccountTile extends StatelessWidget {
  final Map<String, dynamic> account;
  final VoidCallback onTap;

  const _AccountTile({
    required this.account,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final phone = account['phone'] as String? ??
                 account['phoneNumber'] as String? ??
                 'Unknown';
    final name = account['name'] as String? ?? phone;
    final status = account['status'] as String? ?? 'unknown';
    final isConnected = status == 'connected';
    
    // Get last activity timestamp
    final lastActivity = account['lastRealtimeMessageAt'];
    String? lastActivityText;
    if (lastActivity != null) {
      if (lastActivity is Timestamp) {
        final date = lastActivity.toDate();
        final now = DateTime.now();
        final diff = now.difference(date);
        
        if (diff.inMinutes < 1) {
          lastActivityText = 'Active now';
        } else if (diff.inHours < 1) {
          lastActivityText = '${diff.inMinutes}m ago';
        } else if (diff.inDays < 1) {
          lastActivityText = '${diff.inHours}h ago';
        } else {
          lastActivityText = DateFormat('MMM d').format(date);
        }
      }
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        onTap: isConnected ? onTap : null,
        leading: CircleAvatar(
          backgroundColor: isConnected 
              ? const Color(0xFF25D366)
              : Colors.grey,
          child: Icon(
            Icons.phone_android,
            color: Colors.white,
          ),
        ),
        title: Text(
          name,
          style: const TextStyle(
            fontWeight: FontWeight.w500,
            fontSize: 16,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              phone,
              style: const TextStyle(fontSize: 14),
            ),
            if (lastActivityText != null)
              Text(
                lastActivityText,
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey.shade600,
                ),
              ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Status indicator
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isConnected
                    ? Colors.green
                    : status == 'connecting'
                        ? Colors.orange
                        : Colors.red,
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
