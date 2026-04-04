// lib/services/session_provider.dart

import 'package:flutter/foundation.dart';
import 'database_service.dart';

class SessionProvider extends ChangeNotifier {
  bool loading = true;
  String? username;
  String? fullName;
  String? role;

  bool get isLoggedIn => username != null;

  Future<void> hydrate() async {
    final session = await DatabaseService.instance.getSession();
    if (session != null) {
      username = session['username'] as String?;
      fullName = session['full_name'] as String?;
      role = session['role'] as String?;
    }
    loading = false;
    notifyListeners();
  }

  Future<void> login(String user, String name, String userRole) async {
    await DatabaseService.instance.saveSession(user, name, userRole);
    username = user;
    fullName = name;
    role = userRole;
    notifyListeners();
  }

  Future<void> logout() async {
    await DatabaseService.instance.clearSession();
    username = null;
    fullName = null;
    role = null;
    notifyListeners();
  }
}