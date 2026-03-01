import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// WhatsApp-style UI utilities for consistent UX across the app
class WhatsAppUIUtils {
  /// Format timestamp exactly like WhatsApp Web
  /// Today: "12:45"
  /// Yesterday: "Yesterday"
  /// This week: "Monday"
  /// Older: "12/01/2026"
  static String formatMessageTime(Timestamp? timestamp) {
    if (timestamp == null) return '';
    
    final date = timestamp.toDate();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final messageDate = DateTime(date.year, date.month, date.day);
    
    // Today - show time
    if (messageDate == today) {
      return DateFormat('HH:mm').format(date);
    }
    
    // Yesterday
    if (messageDate == yesterday) {
      return 'Yesterday';
    }
    
    // This week - show day name
    final daysDiff = today.difference(messageDate).inDays;
    if (daysDiff < 7) {
      return DateFormat('EEEE').format(date); // Monday, Tuesday, etc.
    }
    
    // Same year - show day and month
    if (date.year == now.year) {
      return DateFormat('dd/MM').format(date);
    }
    
    // Different year - show full date
    return DateFormat('dd/MM/yyyy').format(date);
  }

  /// Format timestamp for inbox preview (shorter version)
  /// Today: "12:45"
  /// Yesterday: "Yesterday"
  /// This week: "Mon"
  /// Older: "12/01"
  static String formatInboxTime(Timestamp? timestamp) {
    if (timestamp == null) return '';
    
    final date = timestamp.toDate();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final messageDate = DateTime(date.year, date.month, date.day);
    
    if (messageDate == today) {
      return DateFormat('HH:mm').format(date);
    }
    
    if (messageDate == yesterday) {
      return 'Yesterday';
    }
    
    final daysDiff = today.difference(messageDate).inDays;
    if (daysDiff < 7) {
      return DateFormat('EEE').format(date); // Mon, Tue, etc.
    }
    
    return DateFormat('dd/MM').format(date);
  }

  /// Get initials from name for avatar
  /// "John Doe" -> "JD"
  /// "Maria" -> "M"
  /// "+40722..." -> "Phone icon"
  static String getInitials(String name) {
    // Handle phone numbers
    if (name.startsWith('+') || name.contains('@')) {
      return '📱';
    }
    
    final trimmed = name.trim();
    if (trimmed.isEmpty) return '?';
    
    final words = trimmed.split(' ');
    if (words.length == 1) {
      return words[0].substring(0, 1).toUpperCase();
    }
    
    return (words[0].substring(0, 1) + words[1].substring(0, 1)).toUpperCase();
  }

  /// Get consistent avatar color from ID (same color for same contact)
  static Color getAvatarColor(String id) {
    final hash = id.hashCode;
    final colors = [
      const Color(0xFF00BFA5), // WhatsApp teal
      const Color(0xFF00897B),
      const Color(0xFF7CB342),
      const Color(0xFFFBC02D),
      const Color(0xFFFF6F00),
      const Color(0xFFE53935),
      const Color(0xFF8E24AA),
      const Color(0xFF5E35B1),
      const Color(0xFF3949AB),
      const Color(0xFF1E88E5),
    ];
    return colors[hash.abs() % colors.length];
  }

  /// Format message preview for inbox
  /// Image message: "📷 Photo"
  /// Video: "🎥 Video"
  /// Audio: "🎵 Audio"
  /// Document: "📄 Document"
  static String formatMessagePreview(Map<String, dynamic> clientData) {
    final text = clientData['lastMessageText'] as String?;
    final mediaType = clientData['lastMessageMediaType'] as String?;
    
    if (text != null && text.isNotEmpty) {
      return text;
    }
    
    if (mediaType != null) {
      switch (mediaType) {
        case 'image':
          return '📷 Photo';
        case 'video':
          return '🎥 Video';
        case 'audio':
        case 'ptt':
          return '🎵 Audio';
        case 'document':
          return '📄 Document';
        case 'sticker':
          return '🎬 Sticker';
        default:
          return '📎 Media';
      }
    }
    
    return 'No messages yet';
  }

  /// WhatsApp green color (primary)
  static const Color whatsappGreen = Color(0xFF25D366);
  
  /// WhatsApp dark green (for app bar)
  static const Color whatsappDarkGreen = Color(0xFF075E54);
  
  /// WhatsApp teal (accent)
  static const Color whatsappTeal = Color(0xFF128C7E);
  
  /// Message bubble colors
  static const Color sentMessageBg = Color(0xFFDCF8C6); // Light green for sent
  static const Color receivedMessageBg = Colors.white; // White for received
  
  /// Status icon for message delivery
  static Widget buildStatusIcon(int? status, {bool isRead = false}) {
    switch (status) {
      case 0: // ERROR
        return const Icon(Icons.error, size: 16, color: Colors.red);
      case 1: // PENDING
        return const Icon(Icons.access_time, size: 16, color: Colors.grey);
      case 2: // SERVER_ACK (sent)
        return const Icon(Icons.done, size: 16, color: Colors.grey);
      case 3: // DELIVERED
        return const Icon(Icons.done_all, size: 16, color: Colors.grey);
      case 4: // READ
        return const Icon(Icons.done_all, size: 16, color: Colors.blue);
      default:
        return const SizedBox(width: 16);
    }
  }
  
  /// Build skeleton loader (WhatsApp style)
  static Widget buildSkeletonTile() {
    return ListTile(
      leading: Container(
        width: 50,
        height: 50,
        decoration: BoxDecoration(
          color: Colors.grey.shade300,
          shape: BoxShape.circle,
        ),
      ),
      title: Container(
        height: 12,
        width: double.infinity,
        decoration: BoxDecoration(
          color: Colors.grey.shade300,
          borderRadius: BorderRadius.circular(4),
        ),
      ),
      subtitle: Container(
        height: 10,
        width: 200,
        margin: const EdgeInsets.only(top: 4),
        decoration: BoxDecoration(
          color: Colors.grey.shade200,
          borderRadius: BorderRadius.circular(4),
        ),
      ),
    );
  }
}
