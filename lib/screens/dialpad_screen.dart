import 'package:flutter/material.dart';
import '../services/voip_service.dart';
import 'active_call_screen.dart';

class DialpadScreen extends StatefulWidget {
  const DialpadScreen({super.key});

  @override
  State<DialpadScreen> createState() => _DialpadScreenState();
}

class _DialpadScreenState extends State<DialpadScreen> {
  final TextEditingController _controller = TextEditingController();

  void _onDigitPress(String digit) {
    setState(() {
      _controller.text += digit;
    });
  }

  void _onBackspace() {
    if (_controller.text.isNotEmpty) {
      setState(() {
        _controller.text = _controller.text.substring(0, _controller.text.length - 1);
      });
    }
  }

  Future<void> _call() async {
    if (_controller.text.isEmpty) return;
    final number = _controller.text;
    
    debugPrint('CALL_FLOW: Dialpad _call PRESSED pt $number');

    try {
      debugPrint('CALL_FLOW: invoking voip.makeCall($number)');
      final voip = VoipService();
      await voip.makeCall(number);
      debugPrint('CALL_FLOW: makeCall finished without throwing');
    } catch (e, st) {
      debugPrint('CALL_FLOW: ERROR in Dialpad _call => $e\n$st');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Eroare apel: $e')));
      }
      return; 
    }

    // Navigate immediately to Active Call Screen
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ActiveCallScreen(
          remoteId: number,
          isOutgoing: true,
        ),
      ),
    );
  }

  Widget _buildButton(String label, {VoidCallback? onPressed, Color? color, IconData? icon}) {
    return InkWell(
      onTap: onPressed ?? () => _onDigitPress(label),
      borderRadius: BorderRadius.circular(50),
      child: Container(
        width: 70,
        height: 70,
        decoration: BoxDecoration(
          color: color ?? Colors.grey[200],
          shape: BoxShape.circle,
        ),
        alignment: Alignment.center,
        child: icon != null 
          ? Icon(icon, color: Colors.white, size: 30)
          : Text(
              label,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTapDown: (TapDownDetails details) {
        debugPrint('CALL_FLOW: SCREEN_TAP at ${details.globalPosition}');
        final AbsorbPointer? ap = context.findAncestorWidgetOfExactType<AbsorbPointer>();
        if (ap != null) {
          debugPrint('CALL_FLOW: Found AbsorbPointer ancestor -> absorbing=${ap.absorbing}');
          
          Widget? w = context.widget;
          Element? e = context as Element;
          debugPrint('CALL_FLOW: Dumping ancestor chain:');
          e.visitAncestorElements((ancestor) {
            debugPrint('CALL_FLOW: ancestor widget: ${ancestor.widget.runtimeType}');
            return true;
          });
        } else {
          final IgnorePointer? ip = context.findAncestorWidgetOfExactType<IgnorePointer>();
          if (ip != null) debugPrint('CALL_FLOW: Found IgnorePointer ancestor');
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text("Tastatură"), backgroundColor: const Color(0xFF008069)),
      body: Column(
        children: [
          const Spacer(),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              _controller.text,
              style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const Spacer(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildButton("1"),
              _buildButton("2"),
              _buildButton("3"),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildButton("4"),
              _buildButton("5"),
              _buildButton("6"),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildButton("7"),
              _buildButton("8"),
              _buildButton("9"),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildButton("*"),
              _buildButton("0"),
              _buildButton("#"),
            ],
          ),
          const SizedBox(height: 30),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              const SizedBox(width: 70), // Spacer
              _buildButton("Call", onPressed: _call, color: Colors.green, icon: Icons.call),
              _buildButton("Back", onPressed: _onBackspace, color: Colors.transparent, icon: Icons.backspace),
            ],
          ),
          const SizedBox(height: 40),
        ],
      ),
      ),
    );
  }
}
