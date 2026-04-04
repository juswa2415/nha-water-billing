// lib/screens/building_list_screen.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:convert';
import 'dart:io';
import '../services/database_service.dart';
import '../services/session_provider.dart';
import '../services/sync_service.dart';
import 'floor_list_screen.dart';
import 'login_screen.dart';

class BuildingListScreen extends StatefulWidget {
  const BuildingListScreen({super.key});

  @override
  State<BuildingListScreen> createState() => _BuildingListScreenState();
}

class _BuildingListScreenState extends State<BuildingListScreen> {
  int _cycleId = -1;
  List<String> _buildings = [];
  Map<String, int> _progress = {'total': 0, 'done': 0};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final db = DatabaseService.instance;
    final cycleId = await db.getActiveCycleId();

    if (cycleId == -1) {
      setState(() { _cycleId = -1; _loading = false; });
      return;
    }

    final buildings = await db.getBuildings(cycleId);
    final progress = await db.getCycleProgress(cycleId);
    setState(() {
      _cycleId = cycleId;
      _buildings = buildings;
      _progress = progress;
      _loading = false;
    });
  }

  Future<void> _importReadingList() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['json'],
    );
    if (result == null || result.files.single.path == null) return;

    final file = File(result.files.single.path!);
    final content = await file.readAsString();
    final payload = jsonDecode(content) as Map<String, dynamic>;

    final db = DatabaseService.instance;
    final count = await db.importReadingList(payload);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Imported $count units for cycle ${payload['period_start']} – ${payload['period_end']}'),
          backgroundColor: Colors.green.shade700,
        ),
      );
      _load();
    }
  }

  Future<void> _exportReadings() async {
    if (_cycleId == -1) return;
    final session = context.read<SessionProvider>();
    final syncService = SyncService();

    final result = await syncService.exportReadings(
      cycleId: _cycleId,
      exportedBy: session.username ?? 'unknown',
    );

    if (!mounted) return;
    if (result.cancelled) {
      return;
    }

    if (result.success) {
      final message = result.shared
          ? 'Exported ${result.count} readings. Share sheet opened.'
          : 'Exported ${result.count} readings to:\n${result.filePath}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Colors.green.shade700,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Export failed: ${result.error}'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    final exportUsesSaveDialog = Platform.isWindows || Platform.isLinux || Platform.isMacOS;
    final done = _progress['done'] ?? 0;
    final total = _progress['total'] ?? 0;
    final pct = total > 0 ? done / total : 0.0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('NHA Water Reading'),
        actions: [
          IconButton(
            icon: const Icon(Icons.upload_file),
            tooltip: 'Import reading list',
            onPressed: _importReadingList,
          ),
          IconButton(
            icon: Icon(exportUsesSaveDialog ? Icons.save_alt : Icons.share),
            tooltip: exportUsesSaveDialog ? 'Export readings to JSON' : 'Share readings export',
            onPressed: _exportReadings,
          ),
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'logout') {
                await session.logout();
                if (mounted) {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute(builder: (_) => const LoginScreen()),
                  );
                }
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'user',
                enabled: false,
                child: Text(session.fullName ?? '', style: const TextStyle(fontSize: 13, color: Colors.grey)),
              ),
              const PopupMenuItem(value: 'logout', child: Text('Sign Out')),
            ],
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _cycleId == -1
              ? _buildNoCycle()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(
                    slivers: [
                      // Progress header
                      SliverToBoxAdapter(child: _buildProgressHeader(done, total, pct)),
                      // Building grid
                      if (_buildings.isEmpty)
                        const SliverFillRemaining(child: Center(child: Text('No buildings in reading list.', style: TextStyle(color: Colors.grey))))
                      else
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                          sliver: SliverGrid(
                            delegate: SliverChildBuilderDelegate(
                              (ctx, i) => _BuildingCard(
                                code: _buildings[i],
                                cycleId: _cycleId,
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => FloorListScreen(
                                      cycleId: _cycleId,
                                      buildingCode: _buildings[i],
                                    ),
                                  ),
                                ).then((_) => _load()),
                              ),
                              childCount: _buildings.length,
                            ),
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 3,
                              mainAxisSpacing: 10,
                              crossAxisSpacing: 10,
                              childAspectRatio: 1.1,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildNoCycle() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.folder_open, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            const Text(
              'No reading list loaded',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Import a reading list file from the desktop app to begin.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _importReadingList,
              icon: const Icon(Icons.upload_file),
              label: const Text('Import Reading List'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressHeader(int done, int total, double pct) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        border: Border.all(color: Colors.blue.shade200),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Reading Progress', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              Text(
                '$done / $total units',
                style: TextStyle(color: Colors.blue.shade700, fontWeight: FontWeight.bold, fontSize: 14),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 8,
              backgroundColor: Colors.blue.shade100,
              valueColor: AlwaysStoppedAnimation<Color>(Colors.blue.shade600),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${(pct * 100).toStringAsFixed(0)}% complete',
            style: TextStyle(fontSize: 12, color: Colors.blue.shade700),
          ),
        ],
      ),
    );
  }
}

class _BuildingCard extends StatefulWidget {
  final String code;
  final int cycleId;
  final VoidCallback onTap;
  const _BuildingCard({required this.code, required this.cycleId, required this.onTap});

  @override
  State<_BuildingCard> createState() => _BuildingCardState();
}

class _BuildingCardState extends State<_BuildingCard> {
  int _done = 0;
  int _total = 0;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final db = DatabaseService.instance;
    final floors = await db.getFloors(widget.cycleId, widget.code);
    int done = 0, total = 0;
    for (final floor in floors) {
      final units = await db.getUnitsForFloor(widget.cycleId, widget.code, floor);
      total += units.length;
      done += units.where((u) => u.readingStatus != 'pending').length;
    }
    if (mounted) setState(() { _done = done; _total = total; });
  }

  @override
  Widget build(BuildContext context) {
    final complete = _total > 0 && _done == _total;
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        decoration: BoxDecoration(
          color: complete ? Colors.green.shade50 : Colors.white,
          border: Border.all(
            color: complete ? Colors.green.shade300 : Colors.grey.shade300,
            width: complete ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              complete ? Icons.check_circle : Icons.apartment,
              size: 28,
              color: complete ? Colors.green.shade600 : Colors.blue.shade700,
            ),
            const SizedBox(height: 6),
            Text(
              widget.code,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: complete ? Colors.green.shade800 : Colors.grey.shade900,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              _total > 0 ? '$_done/$_total' : '...',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
            ),
          ],
        ),
      ),
    );
  }
}
