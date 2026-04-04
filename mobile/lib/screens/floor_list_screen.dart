// lib/screens/floor_list_screen.dart

import 'package:flutter/material.dart';
import '../services/database_service.dart';
import 'continuous_entry_screen.dart';
import 'unit_list_screen.dart';

class FloorListScreen extends StatefulWidget {
  final int cycleId;
  final String buildingCode;

  const FloorListScreen({
    super.key,
    required this.cycleId,
    required this.buildingCode,
  });

  @override
  State<FloorListScreen> createState() => _FloorListScreenState();
}

class _FloorListScreenState extends State<FloorListScreen> {
  List<_FloorStat> _floors = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final db = DatabaseService.instance;
    final floorNumbers =
        await db.getFloors(widget.cycleId, widget.buildingCode);
    final stats = <_FloorStat>[];

    for (final f in floorNumbers) {
      final units =
          await db.getUnitsForFloor(widget.cycleId, widget.buildingCode, f);
      final done = units.where((u) => u.readingStatus != 'pending').length;
      stats.add(_FloorStat(floor: f, total: units.length, done: done));
    }

    setState(() {
      _floors = stats;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.buildingCode)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _floors.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (ctx, i) {
                  final f = _floors[i];
                  final complete = f.total > 0 && f.done == f.total;
                  final pct = f.total > 0 ? f.done / f.total : 0.0;

                  return InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ContinuousEntryScreen(
                          cycleId: widget.cycleId,
                          buildingCode: widget.buildingCode,
                          floor: f.floor,
                        ),
                      ),
                    ).then((_) => _load()),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: complete ? Colors.green.shade50 : Colors.white,
                        border: Border.all(
                          color: complete
                              ? Colors.green.shade300
                              : Colors.grey.shade200,
                          width: complete ? 1.5 : 1,
                        ),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: complete
                                      ? Colors.green.shade100
                                      : Colors.blue.shade50,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Center(
                                  child: complete
                                      ? Icon(Icons.check_circle,
                                          color: Colors.green.shade700,
                                          size: 24)
                                      : Text(
                                          'F${f.floor}',
                                          style: TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 15,
                                            color: Colors.blue.shade700,
                                          ),
                                        ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Floor ${f.floor}',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: ClipRRect(
                                            borderRadius:
                                                BorderRadius.circular(3),
                                            child: LinearProgressIndicator(
                                              value: pct,
                                              minHeight: 5,
                                              backgroundColor:
                                                  Colors.grey.shade200,
                                              valueColor:
                                                  AlwaysStoppedAnimation<Color>(
                                                complete
                                                    ? Colors.green.shade500
                                                    : Colors.blue.shade500,
                                              ),
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 10),
                                        Text(
                                          '${f.done}/${f.total}',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: complete
                                                ? Colors.green.shade700
                                                : Colors.grey.shade600,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              Expanded(
                                child: FilledButton.icon(
                                  onPressed: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => ContinuousEntryScreen(
                                        cycleId: widget.cycleId,
                                        buildingCode: widget.buildingCode,
                                        floor: f.floor,
                                      ),
                                    ),
                                  ).then((_) => _load()),
                                  icon: const Icon(Icons.speed),
                                  label: const Text('Quick Entry'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => UnitListScreen(
                                        cycleId: widget.cycleId,
                                        buildingCode: widget.buildingCode,
                                        floor: f.floor,
                                      ),
                                    ),
                                  ).then((_) => _load()),
                                  icon: const Icon(Icons.view_list),
                                  label: const Text('Unit List'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class _FloorStat {
  final int floor;
  final int total;
  final int done;
  const _FloorStat(
      {required this.floor, required this.total, required this.done});
}
