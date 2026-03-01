import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:google_sign_in/google_sign_in.dart';

class AuthService extends ChangeNotifier {
  final GoTrueClient _auth = Supabase.instance.client.auth;
  User? _user;
  bool _isLoading = true;

  AuthService() {
    _user = _auth.currentUser;
    _isLoading = false;
    
    _auth.onAuthStateChange.listen((data) {
      final AuthChangeEvent event = data.event;
      final Session? session = data.session;
      final User? user = session?.user;
      
      print("DEBUG: [AuthService] authStateChange. Event: $event, User: ${user?.id}");
      _user = user;
      _isLoading = false;
      notifyListeners();
    });
  }

  User? get user => _user;
  User? get currentUser => _auth.currentUser;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _user != null;

  // Sign in anonymously (Supabase supports anonymous login if enabled)
  Future<void> signInAnonymously() async {
    try {
      await _auth.signInAnonymously();
    } catch (e) {
      debugPrint("Error signing in anonymously: $e");
      rethrow;
    }
  }

  // Sign in with Email/Password
  Future<void> signInWithEmailPassword(String email, String password) async {
    try {
      _isLoading = true;
      notifyListeners();
      final response = await _auth.signInWithPassword(email: email, password: password);
      _user = response.user;
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> signUpWithEmailPassword(String email, String password) async {
    try {
      _isLoading = true;
      notifyListeners();
      final response = await _auth.signUp(email: email, password: password);
      _user = response.user;
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> refreshUser() async {
    final response = await _auth.refreshSession();
    _user = response.session?.user;
    notifyListeners();
  }

  Future<void> sendPasswordReset(String email) async {
    await _auth.resetPasswordForEmail(email);
  }

  Future<void> signOut() async {
    await _auth.signOut();
  }

  Future<String?> getIdToken() async {
    return _auth.currentSession?.accessToken;
  }

  // Sign in with Google (using Supabase)
  Future<void> signInWithGoogle() async {
    try {
      _isLoading = true;
      notifyListeners();

      // Required by Supabase for obtaining a valid idToken via Native flow
      const webClientId = '560987331446-7uv4tju5ephn8921aotkq4939tl01lpi.apps.googleusercontent.com';
      try {
        final GoogleSignInAccount? googleUser = await GoogleSignIn(serverClientId: webClientId).signIn();
        if (googleUser == null) {
          // User canceled the sign-in flow
          _isLoading = false;
          notifyListeners();
          return;
        }

        final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
        final accessToken = googleAuth.accessToken;
        final idToken = googleAuth.idToken;

        if (idToken == null) {
          throw 'No ID Token found.';
        }

        final response = await _auth.signInWithIdToken(
          provider: OAuthProvider.google,
          idToken: idToken,
          accessToken: accessToken,
        );

        _user = response.user ?? _auth.currentSession?.user;
      } catch (e) {
        debugPrint("Native Google Sign-In failed (likely no GMS on Huawei): $e");
        debugPrint("Falling back to Supabase Web OAuth flow...");
        // Fallback for Huawei / non-GMS devices
        await _auth.signInWithOAuth(
          OAuthProvider.google,
          redirectTo: 'com.superpartybyai.app://login-callback',
        );
      }
    } catch (e) {
      debugPrint("Error signing in with Google: $e");
      rethrow;
    } finally {
      // Note: for OAuth redirect, the app might restart or resume later via onAuthStateChange
      _isLoading = false;
      notifyListeners();
    }
  }
}
