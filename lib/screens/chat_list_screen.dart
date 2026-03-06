import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';
import 'chat_detail_screen.dart';



class ConversationsRepo {
  final SupabaseClient supabase;
  ConversationsRepo(this.supabase);

  Future<List<Map<String, dynamic>>> fetchPage(int pageIndex, {int pageSize = 50}) async {
    // Calling the newly created RPC for conversations to enforce server limits and indexing
    final res = await supabase.rpc('get_conversations_page', params: {
      'p_page': pageIndex,
      'p_page_size': pageSize,
    });
    return List<Map<String, dynamic>>.from(res as List);
  }
}

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  // Internal numbers — filter out our own WA accounts from client list
  static const Set<String> _internalNumbers = {
    '40737571397',
    '0737571397',
    '737571397',
  };

  final ConversationsRepo _repo = ConversationsRepo(Supabase.instance.client);
  final ScrollController _scrollController = ScrollController();
  
  List<Map<String, dynamic>> _conversations = [];
  bool _loading = false;
  bool _isLoadingMore = false;
  bool _hasMore = true;
  int _page = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadNextPage();
    _scrollController.addListener(() {
      if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
        if (!_loading && !_isLoadingMore && _hasMore) {
          _loadNextPage();
        }
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  bool _isInternalJid(String? jid) {
    if (jid == null || jid.isEmpty) return false;
    final phone = jid.split('@')[0];
    return _internalNumbers.contains(phone);
  }

  Future<void> _loadNextPage() async {
    if (_loading || _isLoadingMore || !_hasMore) return;
    
    if (_page == 0) {
      setState(() { _loading = true; _error = null; });
    } else {
      setState(() { _isLoadingMore = true; });
    }

    try {
      final data = await _repo.fetchPage(_page, pageSize: 50);

      final filtered = data.where((row) {
        final name = row['name']?.toString() ?? '';
        final jid = row['jid']?.toString() ?? '';
        if (name == 'System') return false;
        if (_isInternalJid(jid)) return false;
        return true;
      }).toList();

      if (!mounted) return;
      
      setState(() {
        if (filtered.isEmpty && data.isEmpty) {
          _hasMore = false;
        } else {
          _conversations.addAll(filtered);
          if (data.length < 50) _hasMore = false;
          _page++;
        }
        _loading = false;
        _isLoadingMore = false;
      });
    } catch (e, stack) {
      debugPrint('Error loading conversations page $_page: $e');
      if (mounted) {
        setState(() { 
          if (_page == 0) _error = e.toString();
          _loading = false; 
          _isLoadingMore = false; 
        });
        if (_page > 0) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare la încărcare. Trage spre refresh.')));
        }
      }
    }
  }

  Future<void> _refreshList() async {
    setState(() {
      _page = 0;
      _conversations.clear();
      _hasMore = true;
      _error = null;
    });
    await _loadNextPage();
  }

  // --- Avatar tap handler: agent-safe, no phone exposed ---
  Future<void> _onAvatarTap(BuildContext context, Map<String, dynamic> row) async {
    final conversationId = (row['id'] ?? '').toString();
    final displayName = _resolveDisplayName(row);
    final status = row['identity_resolution_status']?.toString() ?? 'unknown';
    final isPartial = status == 'partial' || status == 'unresolved';

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(displayName.isNotEmpty ? displayName : 'Client'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isPartial ? Icons.warning_amber_rounded : Icons.verified_user,
                  size: 16,
                  color: isPartial ? Colors.orange : Colors.green,
                ),
                const SizedBox(width: 6),
                Text(isPartial ? 'Identitate parțială' : 'Identitate rezolvată',
                    style: const TextStyle(fontSize: 13, color: Colors.grey)),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Închide'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              try {
                final backendService = Provider.of<BackendService>(context, listen: false);
                await backendService.callClient(conversationId);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Apel inițiat…')));
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Eroare apel: $e')));
                }
              }
            },
            child: const Text('Sună'),
          ),
        ],
      ),
    );
  }

  // ── Identity helpers ───────────────────────────────────────
  String? _nonEmpty(dynamic v) {
    final s = v?.toString().trim();
    return (s != null && s.isNotEmpty) ? s : null;
  }

  // NOTE: No phone_e164 or JID derivation — agent sees only display name.
  String _resolveDisplayName(Map<String, dynamic> row) {
    final status = row['identity_resolution_status']?.toString();
    final displayName = _nonEmpty(row['client_display_name']);
    if (displayName != null) return displayName;
    // Neutral placeholder — never exposes a phone number
    final suffix = (status == 'partial' || status == 'unresolved') ? ' ⚠' : '';
    return 'Client$suffix';
  }

  bool _isIdentityPartial(Map<String, dynamic> row) {
    final s = row['identity_resolution_status']?.toString();
    return s == 'partial' || s == 'unresolved';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WhatsApp SuperPartyByAi', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF008069),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: () { _refreshList(); },
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text('Eroare: $_error', style: const TextStyle(color: Colors.red)));
    if (_conversations.isEmpty) return const Center(child: Text('Nicio conversație cu clienți'));
    return _buildList();
  }

  Widget _buildList() {
    return RefreshIndicator(
      onRefresh: _refreshList,
      child: ListView.builder(
        controller: _scrollController,
        itemCount: _conversations.length + (_hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _conversations.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            );
          }

          final row = _conversations[index];
          final displayName = _resolveDisplayName(row);
          final isPartial = _isIdentityPartial(row);

          // dynamic
          final ts = row['last_message_at'];
          DateTime? lastDt;
          if (ts != null && ts is String) {
            lastDt = DateTime.tryParse(ts);
          } else if (ts != null && ts is int) {
            lastDt = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
          }

          final preview = row['last_message_preview'] ?? '';
          final accountLabel = row['account_label']?.toString() ?? '';
          final photoUrl = row['photo_url']?.toString() ?? '';
          final assignedTo = row['assigned_employee_id'];

          return ListTile(
            leading: GestureDetector(
              onTap: () => _onAvatarTap(context, row),
              child: CircleAvatar(
                backgroundColor: Colors.grey,
                backgroundImage: photoUrl.isNotEmpty
                    ? ResizeImage(NetworkImage(photoUrl), width: 100, height: 100)
                    : null,
                child: photoUrl.isEmpty ? const Icon(Icons.person, color: Colors.white) : null,
              ),
            ),
            title: Row(
              children: [
                Expanded(child: Text(displayName, overflow: TextOverflow.ellipsis)),
                if (isPartial)
                  const Padding(
                    padding: EdgeInsets.only(left: 4),
                    child: Tooltip(
                      message: 'Identitate nerezolvată',
                      child: Icon(Icons.warning_amber_rounded, size: 14, color: Colors.orange),
                    ),
                  ),
                if (accountLabel.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(left: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.blue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: Colors.blue.withOpacity(0.3)),
                    ),
                    child: Text(accountLabel, style: const TextStyle(fontSize: 10, color: Colors.blue)),
                  ),
              ],
            ),
            subtitle: Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (lastDt != null)
                  Text(DateFormat('HH:mm').format(lastDt),
                      style: const TextStyle(fontSize: 12, color: Colors.grey)),
                if (assignedTo != null)
                  const Icon(Icons.assignment_ind, size: 16, color: Colors.blue),
              ],
            ),
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ChatDetailScreen(
                    conversationId: row['id'] ?? '',
                    name: displayName,
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
