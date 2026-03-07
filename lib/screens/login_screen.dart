import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;

  void _login() async {
    debugPrint('[TIMING] login_start=${DateTime.now().toIso8601String()}');
    final sw = Stopwatch()..start();
    setState(() => _isLoading = true);
    final auth = Provider.of<AuthService>(context, listen: false);
    
    try {
        await auth.signInWithEmailPassword(
          _emailController.text.trim(), 
          _passwordController.text.trim()
        );
        debugPrint('[TIMING] signInWithEmailPassword_done=${sw.elapsedMilliseconds}ms');
        // Autofill cleanup
        TextInput.finishAutofillContext();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Login Failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _resetPassword() async {
    if (_emailController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your email to reset password')),
      );
      return;
    }
    try {
      // Direct Supabase call or via AuthService
      await Provider.of<AuthService>(context, listen: false).sendPasswordReset(_emailController.text.trim());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Password reset email sent!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Superparty Login')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: AutofillGroup(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              TextField(
                controller: _emailController,
                decoration: const InputDecoration(labelText: 'Email'),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                autofillHints: const [AutofillHints.password],
              ),
              const SizedBox(height: 20),
              _isLoading 
                ? const CircularProgressIndicator()
                : Column(
                    children: [
                      ElevatedButton.icon(
                        icon: const Icon(Icons.g_mobiledata, size: 32),
                        label: const Text('Sign in with Google'),
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 50),
                        ),
                        onPressed: () async {
                          debugPrint('[TIMING] google_login_start=${DateTime.now().toIso8601String()}');
                          final sw = Stopwatch()..start();
                          try {
                            await Provider.of<AuthService>(context, listen: false).signInWithGoogle();
                            debugPrint('[TIMING] signInWithGoogle_done=${sw.elapsedMilliseconds}ms');
                            
                            // Immediately request backend access so they appear in Admin requests
                            final backend = Provider.of<BackendService>(context, listen: false);
                            final auth = Provider.of<AuthService>(context, listen: false);
                            
                            if (auth.user != null) {
                              debugPrint('[TIMING] requestEmployeeAccess_start=${sw.elapsedMilliseconds}ms');
                              final swReq = Stopwatch()..start();
                              await backend.requestEmployeeAccess(
                                auth.user?.userMetadata?['name'] ?? 'Google User',
                                auth.user?.userMetadata?['phoneNumber'] ?? '0000000000'
                              );
                              debugPrint('[TIMING] requestEmployeeAccess_done=${swReq.elapsedMilliseconds}ms');
                            }
                          } catch (e) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Google Sign-In Failed: $e')),
                              );
                            }
                          }
                        },
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _login,
                        child: const Text('Login with Email'),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => SignupScreen()),
                          );
                        },
                        child: const Text('Create Account'),
                      ),
                      TextButton(
                        onPressed: _resetPassword,
                        child: const Text('Forgot Password?'),
                      ),
                    ],
                  ),
            ],
          ),
        ),
      ),
    );
  }
}
