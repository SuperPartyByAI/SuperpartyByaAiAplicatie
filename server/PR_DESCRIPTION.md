# Flutter Stability Hardening

## Summary

This PR implements comprehensive stability hardening for the Flutter app:
- **Boot-time robustness**: UI appears immediately; Supabase init happens asynchronously with retry (3 attempts, 10s/20s delays)
- **Global error boundaries**: `runZonedGuarded` catches all unhandled errors
- **Single MaterialApp**: Enforced via CI guardrails (only in `lib/app/app_shell.dart`)
- **Null-safety**: Fixed unsafe `.data()!` and casts; `EvidenceModel` returns safe fallback on invalid data
- **CI gates**: Format, analyze, test, and guardrails run on PRs

## Changes

### Core Stability
- `lib/main.dart`: Wrapped in `runZonedGuarded`, improved error boundaries
- `lib/app/app_shell.dart`: `SupabaseInitGate` with dependency injection for testing
- `lib/screens/error/error_screen.dart`: Removed MaterialApp (returns Scaffold only)

### Null-Safety
- `lib/models/evidence_model.dart`: Safe fallback on invalid data (no app crash)
- `lib/services/evidence_service.dart`: Uses `tryFromDatabase` and filters null
- `lib/widgets/user_display_name.dart`: Fixed unsafe casts
- `lib/services/supabase_service.dart`: Replaced `print()` with `debugPrint()`

### CI & Tests
- `.github/workflows/flutter-ci.yml`: Format, analyze, test, guardrails
- `test/app/supabase_init_gate_test.dart`: Deterministic tests for retry behavior

## Verification

### Local
```bash
cd superparty_flutter
dart format --set-exit-if-changed lib test
flutter analyze
flutter test
```

### Expected Behavior
1. **Boot**: UI appears immediately (no blank screen)
2. **Supabase init**: Shows loading → on failure shows error UI with attempt counter → auto-retries or manual Retry
3. **After 3 attempts**: Shows "Te rog repornește aplicația." (exhausted state)
4. **Errors**: Caught by `runZonedGuarded`, logged, app continues
5. **Invalid Database data**: `EvidenceModel` returns safe fallback (no crash)

## DoD Checklist

- ✅ A) Boot-time robustness: UI immediate, timeout 10s, retry 3 attempts (10s/20s delays), error UI after each failure
- ✅ B) Global error boundaries: `runZonedGuarded`, `FlutterError.onError`, `PlatformDispatcher.onError`
- ✅ C) Single MaterialApp: Only in `lib/app/app_shell.dart`, guardrails check both `MaterialApp(` and `MaterialApp.router(`
- ✅ D) Null-safety: No `.data()!` in lib/, safe casts, `EvidenceModel` fallback
- ✅ E) CI gates: Format, analyze, test, guardrails
- ✅ F) Tests: Deterministic tests with dependency injection

## Files Changed

- `.github/workflows/flutter-ci.yml` (NEW)
- `STABILITY_HARDENING.md` (NEW)
- `superparty_flutter/lib/app/app_shell.dart` (NEW)
- `superparty_flutter/lib/main.dart`
- `superparty_flutter/lib/models/evidence_model.dart`
- `superparty_flutter/lib/screens/error/error_screen.dart`
- `superparty_flutter/lib/services/evidence_service.dart`
- `superparty_flutter/lib/services/supabase_service.dart`
- `superparty_flutter/lib/widgets/user_display_name.dart`
- `superparty_flutter/test/app/supabase_init_gate_test.dart` (NEW)

**Total:** 10 files changed, 1177 insertions(+), 388 deletions(-)
