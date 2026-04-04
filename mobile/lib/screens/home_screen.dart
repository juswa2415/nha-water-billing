import 'package:flutter/material.dart';

import '../services/database_service.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback onOpenAssignments;
  final VoidCallback onOpenSync;

  const HomeScreen({
    super.key,
    required this.onOpenAssignments,
    required this.onOpenSync,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<_HomeData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<void> _refresh() async {
    final future = _load();
    setState(() => _future = future);
    await future;
  }

  Future<_HomeData> _load() async {
    final db = DatabaseService.instance;
    final cycle = await db.getLatestCycleSummary();
    if (cycle == null) {
      return const _HomeData.empty();
    }

    final cycleId = cycle['id'] as int;
    final buildings = await db.getBuildingSummaries(cycleId);
    final unsynced = await db.getUnsyncedCount(cycleId);

    return _HomeData(
      cycle: cycle,
      buildings: buildings,
      unsyncedCount: unsynced,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Field Dashboard'),
      ),
      body: FutureBuilder<_HomeData>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          final data = snapshot.data ?? const _HomeData.empty();
          if (!data.hasCycle) {
            return _NoCycleState(onOpenSync: widget.onOpenSync);
          }

          final total = data.total;
          final entered = data.entered;
          final pending = data.pending;
          final flagged = data.flagged;
          final progress = total > 0 ? entered / total : 0.0;

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF1D4ED8), Color(0xFF2563EB)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Active reading cycle',
                        style: TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _cycleLabel(data.cycle!),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: _HeroStat(
                              label: 'Buildings',
                              value: '${data.cycle!['building_count']}',
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _HeroStat(
                              label: 'Units',
                              value: '$total',
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _HeroStat(
                              label: 'Unsynced',
                              value: '${data.unsyncedCount}',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: progress,
                          minHeight: 10,
                          backgroundColor: Colors.white24,
                          valueColor:
                              const AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '$entered of $total units entered',
                        style: const TextStyle(color: Colors.white70),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          FilledButton.icon(
                            onPressed: widget.onOpenAssignments,
                            style: FilledButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: const Color(0xFF1D4ED8),
                            ),
                            icon: const Icon(Icons.playlist_add_check),
                            label: const Text('Open Assignments'),
                          ),
                          OutlinedButton.icon(
                            onPressed: widget.onOpenSync,
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.white,
                              side: const BorderSide(color: Colors.white54),
                            ),
                            icon: const Icon(Icons.sync),
                            label: const Text('Sync'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    _MetricCard(
                      label: 'Needs entry',
                      value: '$pending',
                      tone: Colors.amber,
                    ),
                    _MetricCard(
                      label: 'Entered',
                      value: '$entered',
                      tone: Colors.blue,
                    ),
                    _MetricCard(
                      label: 'Flagged',
                      value: '$flagged',
                      tone: Colors.orange,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Colors.grey.shade200),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Building progress',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Use this to see where the remaining field work is concentrated.',
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 13),
                      ),
                      const SizedBox(height: 14),
                      ...data.buildings!.take(5).map(
                            (building) => Padding(
                              padding: const EdgeInsets.only(bottom: 14),
                              child: _BuildingProgressRow(building: building),
                            ),
                          ),
                      if (data.buildings!.length > 5)
                        TextButton(
                          onPressed: widget.onOpenAssignments,
                          child: Text(
                              'View all ${data.buildings!.length} buildings'),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _NoCycleState extends StatelessWidget {
  final VoidCallback onOpenSync;

  const _NoCycleState({required this.onOpenSync});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.folder_open, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            const Text(
              'No assignment loaded',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              'Import the desktop reading list first, then the field workflow becomes available here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onOpenSync,
              icon: const Icon(Icons.sync),
              label: const Text('Open Sync Center'),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  final String label;
  final String value;

  const _HeroStat({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white70, fontSize: 12)),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final MaterialColor tone;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.tone,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 170,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: tone.shade50,
          border: Border.all(color: tone.shade100),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: TextStyle(color: tone.shade700, fontSize: 12)),
            const SizedBox(height: 6),
            Text(
              value,
              style: TextStyle(
                color: tone.shade900,
                fontSize: 28,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BuildingProgressRow extends StatelessWidget {
  final Map<String, dynamic> building;

  const _BuildingProgressRow({required this.building});

  @override
  Widget build(BuildContext context) {
    final total = building['total'] as int;
    final entered = building['entered'] as int;
    final pending = building['pending'] as int;
    final progress = total > 0 ? entered / total : 0.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              building['building_code'] as String,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            Text(
              '$entered / $total entered',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 8,
            backgroundColor: Colors.grey.shade200,
            valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF1D4ED8)),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '$pending still pending',
          style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
        ),
      ],
    );
  }
}

class _HomeData {
  final Map<String, dynamic>? cycle;
  final List<Map<String, dynamic>>? buildings;
  final int unsyncedCount;

  const _HomeData({
    required this.cycle,
    required this.buildings,
    required this.unsyncedCount,
  });

  const _HomeData.empty()
      : cycle = null,
        buildings = null,
        unsyncedCount = 0;

  bool get hasCycle => cycle != null;
  int get total => (cycle?['total'] as int?) ?? 0;
  int get entered => (cycle?['entered'] as int?) ?? 0;
  int get pending => (cycle?['pending'] as int?) ?? 0;
  int get flagged => (cycle?['flagged'] as int?) ?? 0;
}

String _cycleLabel(Map<String, dynamic> cycle) {
  return '${cycle['period_start']} to ${cycle['period_end']}';
}
