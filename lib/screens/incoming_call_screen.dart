import 'package:flutter/material.dart';
import 'package:twilio_voice/twilio_voice.dart';

class IncomingCallScreen extends StatelessWidget {
  final CallEvent? callEvent;
  final String callerId;

  const IncomingCallScreen({super.key, this.callEvent, required this.callerId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black87,
      body: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Spacer(),
          const CircleAvatar(
            radius: 60,
            backgroundColor: Colors.grey,
            child: Icon(Icons.person, size: 80, color: Colors.white),
          ),
          const SizedBox(height: 20),
          Text(
            callerId.isNotEmpty ? callerId : 'Apel Necunoscut',
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Incoming Audio Call...',
            style: TextStyle(
              fontSize: 18,
              color: Colors.white70,
            ),
          ),
          const Spacer(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              // Reject Button
              Column(
                children: [
                  FloatingActionButton(
                    heroTag: 'reject',
                    backgroundColor: Colors.red,
                    onPressed: () {
                      TwilioVoice.instance.call.hangUp();
                      Navigator.of(context).pop();
                    },
                    child: const Icon(Icons.call_end, color: Colors.white),
                  ),
                  const SizedBox(height: 8),
                  const Text('Refuză', style: TextStyle(color: Colors.white)),
                ],
              ),
              
              // Answer Button
              Column(
                children: [
                  FloatingActionButton(
                    heroTag: 'answer',
                    backgroundColor: Colors.green,
                    onPressed: () async {
                      // Answer the call
                      // Note: activeCall might be null initially?
                      // TwilioVoice SDK usually requires `TwilioVoice.instance.call.answer()`
                      // or similar. In 0.3.x refer to `answer()`.
                      // Actually, the plugin automatically handles intent if configured correctly,
                      // but manual UI needs this.
                      final result = await TwilioVoice.instance.call.answer();
                      if (result == true) {
                         Navigator.of(context).pop(); 
                         // Maybe go to 'InCallScreen' or stay here with 'Mute/Hangup'
                         // For MVP, just pop back and show floating overlay or let user talk.
                         // Better: Go to ConnectedCallScreen.
                      }
                    },
                    child: const Icon(Icons.call, color: Colors.white),
                  ),
                  const SizedBox(height: 8),
                  const Text('Răspunde', style: TextStyle(color: Colors.white)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 60),
        ],
      ),
    );
  }
}
