import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';
import 'pending_approval_screen.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;

  void _signup() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    final auth = Provider.of<AuthService>(context, listen: false);
    final backend = Provider.of<BackendService>(context, listen: false);

    try {
      // 1. Create Supabase User (or sign in if already exists)
      print("DEBUG: [Signup] Calling signUpWithEmailPassword for ${_emailController.text}");
      try {
        await auth.signUpWithEmailPassword(
          _emailController.text.trim(),
          _passwordController.text.trim(),
        );
        print("DEBUG: [Signup] Supabase Auth Success. User: ${auth.user?.id}");
      } catch (authError) {
        // If email already exists, try to sign in instead
        final errMsg = authError.toString().toLowerCase();
        if (errMsg.contains('email-already-in-use') || errMsg.contains('already in use')) {
          print("DEBUG: [Signup] Account exists, signing in instead...");
          await auth.signInWithEmailPassword(
            _emailController.text.trim(),
            _passwordController.text.trim(),
          );
          print("DEBUG: [Signup] Sign-in fallback success. User: ${auth.user?.id}");
        } else {
          rethrow;
        }
      }

      // 2. Request Access in Backend
      print("DEBUG: [Signup] Requesting employee access for ${_nameController.text}");
      try {
        await backend.requestEmployeeAccess(
            _nameController.text.trim(), 
            _phoneController.text.trim()
        );
        print("DEBUG: [Signup] requestEmployeeAccess Success");
      } catch (apiError) {
        print("DEBUG: [Signup] Backend Request Failed: $apiError");
        throw apiError;
      }

      if (mounted) {
        print("DEBUG: [Signup] Popping context");
        Navigator.of(context).pop(); 
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Signup Failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Employee Signup')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: ListView(
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Full Name'),
                validator: (v) => v!.isEmpty ? 'Required' : null,
                autofillHints: const [AutofillHints.name],
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _phoneController,
                decoration: const InputDecoration(labelText: 'Phone Number'),
                validator: (v) => v!.isEmpty ? 'Required' : null,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _emailController,
                decoration: const InputDecoration(labelText: 'Email'),
                validator: (v) => v!.contains('@') ? null : 'Invalid Email',
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                validator: (v) => v!.length < 6 ? 'Min 6 chars' : null,
                autofillHints: const [AutofillHints.newPassword],
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _confirmPasswordController,
                decoration: const InputDecoration(labelText: 'Confirm Password'),
                obscureText: true,
                validator: (v) => v != _passwordController.text ? 'Mismatch' : null,
              ),
              const SizedBox(height: 20),
              _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : ElevatedButton(
                      onPressed: _signup,
                      child: const Text('Create Account'),
                    ),
            ],
          ),
        ),
      ),
    );
  }
}
