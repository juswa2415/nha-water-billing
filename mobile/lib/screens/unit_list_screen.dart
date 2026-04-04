// lib/screens/unit_list_screen.dart

import 'package:flutter/material.dart';
import '../services/database_service.dart';
import '../models/unit.dart';
import 'reading_entry_screen.dart';

class UnitListScreen extends StatefulWidget {
  final int cycleId;
  final String buildingCode;
  final int floor;

  const UnitListScreen({
    super.key,
    required this.cycleId,
    required this.buildingCode,
    required this.floor,
  });

  @override
  State<UnitListScreen> createState() => _UnitListScreenState();
}

class _UnitListScreenState extends State<UnitListScreen> {
  List<Unit> _units = [];
  bool _loading = true;
  String _filter = 'all'; // all | pending | done

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final units = await DatabaseService.instance.getUnitsForFloor(
      widget.cycleId,
      widget.buildingCode,
      widget.floor,
    );
    setState(() { _units = units; _loading = false; });
  }

  List<Unit> get _filtered {
    switch (_filter) {
      case 'pending':
        return _units.where((u) => u.readingStatus == 'pending').toList();
      case 'done':
        return _units.where((u) => u.readingStatus != 'pending').toList();
      default:
        return _units;
    }
  }

  @override
  Widget build(BuildContext context) {
    final done = _units.where((u) => u.readingStatus != 'pending').length;

    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.buildingCode} · Floor ${widget.floor}'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(44),
          child: Container(
            color: const Color(0xFF1D4ED8),
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Row(
              children: [
                for (final f in ['all', 'pending', 'done'])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: GestureDetector(
                      onTap: () => setState(() => _filter = f),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          color: _filter == f ? Colors.white : Colors.white24,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          f == 'all' ? 'All (${_units.length})'
                              : f == 'pending' ? 'Pending (${_units.length - done})'
                              : 'Done ($done)',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _filter == f ? const Color(0xFF1D4ED8) : Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _filtered.isEmpty
                  ? Center(
                      child: Text(
                        _filter == 'pending' ? 'All units on this floor are done!' : 'No units found.',
                        style: const TextStyle(color: Colors.grey),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (ctx, i) => _UnitTile(
                        unit: _filtered[i],
                        cycleId: widget.cycleId,
                        onSaved: _load,
                      ),
                    ),
            ),
    );
  }
}

class _UnitTile extends StatelessWidget {
  final Unit unit;
  final int cycleId;
  final VoidCallback onSaved;

  const _UnitTile({
    required this.unit,
    required this.cycleId,
    required this.onSaved,
  });

  Color get _statusColor {
    switch (unit.readingStatus) {
      case 'submitted': return Colors.green.shade600;
      case 'flagged':   return Colors.orange.shade600;
      default:          return Colors.grey.shade400;
    }
  }

  IconData get _statusIcon {
    switch (unit.readingStatus) {
      case 'submitted': return Icons.check_circle;
      case 'flagged':   return Icons.warning_amber;
      default:          return Icons.radio_button_unchecked;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isPending = unit.readingStatus == 'pending';

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ReadingEntryScreen(unit: unit, billingCycleId: cycleId),
        ),
      ).then((_) => onSaved()),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: isPending ? Colors.white : Colors.green.shade50,
          border: Border.all(
            color: isPending ? Colors.grey.shade200 : Colors.green.shade200,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            // Status dot
            Icon(_statusIcon, color: _statusColor, size: 22),
            const SizedBox(width: 12),
            // Unit info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        'Unit ${unit.unitNumber}',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                      if (unit.meterNumber != null) ...[
                        const SizedBox(width: 8),
                        Text(
                          unit.meterNumber!,
                          style: TextStyle(fontSize: 11, color: Colors.grey.shade500, fontFamily: 'monospace'),
                        ),
                      ],
                    ],
                  ),
                  if (unit.residentName != null)
                    Text(
                      unit.residentName!,
                      style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  Text(
                    'Prev: ${unit.previousReading.toStringAsFixed(2)} cu.m',
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                  ),
                ],
              ),
            ),
            // Action indicator
            Icon(
              isPending ? Icons.chevron_right : Icons.edit_outlined,
              color: Colors.grey.shade400,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}