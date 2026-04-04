import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/database_service.dart';
import '../services/session_provider.dart';
import 'login_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final db = DatabaseService.instance;
    final cycles = await db.getStoredCycles();
    final latestCycle = await db.getLatestCycleSummary();
    return {
      'cycle_count': cycles.length,
      'latest_cycle': latestCycle,
    };
  }

  Future<void> _signOut() async {
    await context.read<SessionProvider>().logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          final data = snapshot.data ?? const <String, dynamic>{};
          final latestCycle = data['latest_cycle'] as Map<String, dynamic>?;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: Colors.grey.shade200),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: Colors.blue.shade100,
                      child: Text(
                        (session.fullName?.isNotEmpty ?? false)
                            ? session.fullName!.substring(0, 1).toUpperCase()
                            : 'U',
                        style: TextStyle(
                          color: Colors.blue.shade800,
                          fontWeight: FontWeight.w700,
                          fontSize: 20,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            session.fullName ?? 'Field Staff',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '@${session.username ?? 'offline'}',
                            style: TextStyle(color: Colors.grey.shade600),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            (session.role ?? 'field_staff')
                                .replaceAll('_', ' '),
                            style: TextStyle(
                              color: Colors.blue.shade700,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              _InfoCard(
                title: 'Device and storage',
                rows: [
                  _InfoRow(label: 'Platform', value: Platform.operatingSystem),
                  _InfoRow(
                      label: 'Stored cycles',
                      value: '${data['cycle_count'] ?? 0}'),
                  _InfoRow(
                    label: 'Latest loaded cycle',
                    value: latestCycle == null
                        ? 'None'
                        : '${latestCycle['period_start']} to ${latestCycle['period_end']}',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const _InfoCard(
                title: 'Offline behavior',
                rows: [
                  _InfoRow(
                    label: 'Reading storage',
                    value: 'All readings stay on this device until exported.',
                  ),
                  _InfoRow(
                    label: 'Recommended workflow',
                    value:
                        'Import from desktop, read in the field, export back to desktop.',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _signOut,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.red,
                ),
                icon: const Icon(Icons.logout),
                label: const Text('Sign Out'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final String title;
  final List<_InfoRow> rows;

  const _InfoCard({
    required this.title,
    required this.rows,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.grey.shade200),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          ...rows.map(
            (row) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 132,
                    child: Text(
                      row.label,
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      row.value,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow {
  final String label;
  final String value;

  const _InfoRow({
    required this.label,
    required this.value,
  });
}
