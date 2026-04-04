import 'package:flutter/material.dart';

import '../services/database_service.dart';
import 'floor_list_screen.dart';

class AssignmentsScreen extends StatefulWidget {
  final VoidCallback onOpenSync;

  const AssignmentsScreen({
    super.key,
    required this.onOpenSync,
  });

  @override
  State<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends State<AssignmentsScreen> {
  late Future<_AssignmentsData> _future;

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

  Future<_AssignmentsData> _load() async {
    final db = DatabaseService.instance;
    final cycle = await db.getLatestCycleSummary();
    if (cycle == null) {
      return const _AssignmentsData.empty();
    }

    final buildings = await db.getBuildingSummaries(cycle['id'] as int);
    return _AssignmentsData(cycle: cycle, buildings: buildings);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Assignments'),
        actions: [
          TextButton.icon(
            onPressed: widget.onOpenSync,
            icon: const Icon(Icons.sync, color: Colors.white),
            label: const Text('Sync', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: FutureBuilder<_AssignmentsData>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          final data = snapshot.data ?? const _AssignmentsData.empty();
          if (!data.hasCycle) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.assignment_late_outlined,
                        size: 64, color: Colors.grey.shade400),
                    const SizedBox(height: 16),
                    const Text(
                      'No assignments yet',
                      style:
                          TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Import a desktop reading list to start field work.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: widget.onOpenSync,
                      icon: const Icon(Icons.sync),
                      label: const Text('Open Sync Center'),
                    ),
                  ],
                ),
              ),
            );
          }

          final cycleId = data.cycle!['id'] as int;
          final total = data.cycle!['total'] as int;
          final entered = data.cycle!['entered'] as int;
          final pending = data.cycle!['pending'] as int;
          final progress = total > 0 ? entered / total : 0.0;

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
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
                        'Current assignment',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${data.cycle!['period_start']} to ${data.cycle!['period_end']}',
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: progress,
                          minHeight: 8,
                          backgroundColor: Colors.grey.shade200,
                          valueColor: const AlwaysStoppedAnimation<Color>(
                              Color(0xFF1D4ED8)),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '$entered entered, $pending still pending',
                        style: TextStyle(color: Colors.grey.shade600),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Buildings',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Choose a building, then a floor, then the unit list for actual reading entry.',
                  style: TextStyle(color: Colors.grey.shade600),
                ),
                const SizedBox(height: 14),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: data.buildings!.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.05,
                  ),
                  itemBuilder: (context, index) {
                    final building = data.buildings![index];
                    return _BuildingCard(
                      building: building,
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => FloorListScreen(
                            cycleId: cycleId,
                            buildingCode: building['building_code'] as String,
                          ),
                        ),
                      ).then((_) => _refresh()),
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _BuildingCard extends StatelessWidget {
  final Map<String, dynamic> building;
  final VoidCallback onTap;

  const _BuildingCard({
    required this.building,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final total = building['total'] as int;
    final entered = building['entered'] as int;
    final pending = building['pending'] as int;
    final flagged = building['flagged'] as int;
    final complete = total > 0 && entered == total;
    final progress = total > 0 ? entered / total : 0.0;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: complete ? Colors.green.shade50 : Colors.white,
          border: Border.all(
            color: complete ? Colors.green.shade200 : Colors.grey.shade200,
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color:
                        complete ? Colors.green.shade100 : Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    complete ? Icons.check_circle : Icons.apartment,
                    color:
                        complete ? Colors.green.shade700 : Colors.blue.shade700,
                  ),
                ),
                const Spacer(),
                Icon(Icons.chevron_right, color: Colors.grey.shade400),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              building['building_code'] as String,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 8,
                backgroundColor: Colors.grey.shade200,
                valueColor: AlwaysStoppedAnimation<Color>(
                  complete ? Colors.green.shade500 : const Color(0xFF1D4ED8),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '$entered / $total entered',
              style: TextStyle(
                  color: Colors.grey.shade700, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              '$pending pending${flagged > 0 ? ' • $flagged flagged' : ''}',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssignmentsData {
  final Map<String, dynamic>? cycle;
  final List<Map<String, dynamic>>? buildings;

  const _AssignmentsData({
    required this.cycle,
    required this.buildings,
  });

  const _AssignmentsData.empty()
      : cycle = null,
        buildings = null;

  bool get hasCycle => cycle != null;
}
