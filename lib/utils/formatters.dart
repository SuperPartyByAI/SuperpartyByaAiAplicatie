import 'dart:convert';

/// Utility: Normalize timestamps coming from backend.
/// Accepts: number (seconds), string, map with 'low' or '_seconds', nested numeric.
int normalizeTsDynamic(dynamic val) {
  if (val == null) return 0;
  if (val is int) return val;
  if (val is double) return val.toInt();
  if (val is String) {
    final n = int.tryParse(val);
    if (n != null) return n;
    final dn = double.tryParse(val);
    if (dn != null) return dn.toInt();
    return 0;
  }
  if (val is Map) {
    if (val.containsKey('low')) {
      final low = val['low'];
      if (low is int) return low;
      if (low is String) return int.tryParse(low) ?? 0;
    }
    if (val.containsKey('_seconds')) {
      final s = val['_seconds'];
      if (s is int) return s;
      if (s is String) return int.tryParse(s) ?? 0;
    }
    // try first numeric property
    for (final k in val.keys) {
      final possible = val[k];
      final n = normalizeTsDynamic(possible);
      if (n > 0) return n;
    }
  }
  return 0;
}

int normalizeUnreadDynamic(dynamic u) {
  if (u == null) return 0;
  if (u is int) return u;
  if (u is double) return u.toInt();
  if (u is String) return int.tryParse(u) ?? 0;
  if (u is Map) {
    if (u.containsKey('low')) {
      final low = u['low'];
      if (low is int) return low;
      if (low is String) return int.tryParse(low) ?? 0;
    }
    for (final k in u.keys) {
      final n = normalizeUnreadDynamic(u[k]);
      if (n > 0) return n;
    }
  }
  return 0;
}
