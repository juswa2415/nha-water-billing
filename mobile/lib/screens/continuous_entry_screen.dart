import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/reading.dart';
import '../models/unit.dart';
import '../services/database_service.dart';
import 'reading_entry_screen.dart';

class ContinuousEntryScreen extends StatefulWidget {
  final int cycleId;
  final String buildingCode;
  final int floor;

  const ContinuousEntryScreen({
    super.key,
    required this.cycleId,
    required this.buildingCode,
    required this.floor,
  });

  @override
  State<ContinuousEntryScreen> createState() => _ContinuousEntryScreenState();
}

class _ContinuousEntryScreenState extends State<ContinuousEntryScreen> {
  final _readingController = TextEditingController();
  final _focusNode = FocusNode();

  bool _loading = true;
  bool _saving = false;
  List<Unit> _units = [];
  int _index = 0;
  double? _currentReading;
  String? _error;
  String? _warning;

  Unit? get _activeUnit => _units.isEmpty ? null : _units[_index];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _readingController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _load({int? preserveUnitId}) async {
    setState(() => _loading = true);
    final units = await DatabaseService.instance.getUnitsForFloor(
      widget.cycleId,
      widget.buildingCode,
      widget.floor,
    );

    var index = 0;
    if (preserveUnitId != null) {
      final found = units.indexWhere((unit) => unit.id == preserveUnitId);
      if (found >= 0) {
        index = found;
      }
    } else {
      final pendingIndex =
          units.indexWhere((unit) => unit.readingStatus == 'pending');
      if (pendingIndex >= 0) {
        index = pendingIndex;
      }
    }

    setState(() {
      _units = units;
      _index = units.isEmpty ? 0 : index.clamp(0, units.length - 1);
      _loading = false;
    });

    await _loadActiveReading();
  }

  Future<void> _loadActiveReading() async {
    final unit = _activeUnit;
    if (unit == null) {
      _readingController.clear();
      setState(() {
        _currentReading = null;
        _error = null;
        _warning = null;
      });
      return;
    }

    final existing = await DatabaseService.instance.getReadingForUnit(
      unit.id,
      widget.cycleId,
    );

    final initial = existing?.currentReading;
    _readingController.text = initial != null ? initial.toStringAsFixed(2) : '';
    _validate(_readingController.text);

    if (mounted) {
      FocusScope.of(context).requestFocus(_focusNode);
    }
  }

  void _validate(String value) {
    final unit = _activeUnit;
    if (unit == null) return;

    final current = double.tryParse(value);
    if (current == null) {
      setState(() {
        _currentReading = null;
        _error = null;
        _warning = null;
      });
      return;
    }

    final consumption = current - unit.previousReading;
    final avg = unit.avgConsumption;

    setState(() {
      _currentReading = current;

      if (current < unit.previousReading) {
        _error = null;
        _warning =
            'Current reading is below previous reading. It will be saved and flagged for review.';
        return;
      }

      _error = null;

      if (consumption == 0) {
        _warning = 'Zero consumption. Confirm before saving.';
        return;
      }

      if (avg > 0 && consumption > avg * 3) {
        _warning =
            'High spike detected: ${consumption.toStringAsFixed(2)} cu.m versus average ${avg.toStringAsFixed(2)}.';
        return;
      }

      _warning = null;
    });
  }

  Future<void> _save({required bool moveNext}) async {
    final unit = _activeUnit;
    final current = _currentReading;
    if (unit == null || current == null || _saving) return;

    setState(() => _saving = true);

    final consumption = current - unit.previousReading;
    final avg = unit.avgConsumption;
    final isBelowPrev = current < unit.previousReading;
    final isSpike = avg > 0 && consumption > avg * 3;

    final status = (isBelowPrev || isSpike) ? 'flagged' : 'submitted';
    final flagReason = isBelowPrev
        ? 'CURRENT_BELOW_PREVIOUS'
        : isSpike
            ? 'ABNORMAL_SPIKE'
            : null;

    final reading = Reading(
      unitId: unit.id,
      billingCycleId: widget.cycleId,
      previousReading: unit.previousReading,
      currentReading: current,
      readAt: DateTime.now().toIso8601String(),
      status: status,
      flagReason: flagReason,
      notes: null,
      photoPath: null,
    );

    await DatabaseService.instance.saveReading(reading);

    if (!mounted) return;

    setState(() {
      _units[_index] = unit.copyWith(readingStatus: status);
      _saving = false;
    });

    final nextIndex = moveNext ? _nextIndex() : _index;
    final complete = _pendingCount == 0;

    await _goTo(nextIndex);

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          complete
              ? 'Floor complete. All units now have readings.'
              : status == 'flagged'
                  ? 'Saved and flagged for review.'
                  : 'Reading saved.',
        ),
        backgroundColor: status == 'flagged'
            ? Colors.orange.shade700
            : Colors.green.shade700,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  int _nextIndex() {
    if (_units.isEmpty) return 0;

    for (var i = _index + 1; i < _units.length; i++) {
      if (_units[i].readingStatus == 'pending') {
        return i;
      }
    }
    if (_index + 1 < _units.length) {
      return _index + 1;
    }
    return _index;
  }

  Future<void> _goTo(int index) async {
    if (_units.isEmpty) return;
    setState(() {
      _index = index.clamp(0, _units.length - 1);
    });
    await _loadActiveReading();
  }

  Future<void> _openDetails() async {
    final unit = _activeUnit;
    if (unit == null) return;

    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ReadingEntryScreen(
          unit: unit,
          billingCycleId: widget.cycleId,
        ),
      ),
    );

    await _load(preserveUnitId: unit.id);
  }

  int get _pendingCount =>
      _units.where((unit) => unit.readingStatus == 'pending').length;

  @override
  Widget build(BuildContext context) {
    final unit = _activeUnit;

    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.buildingCode} - Floor ${widget.floor}'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : unit == null
              ? const Center(child: Text('No units found for this floor.'))
              : GestureDetector(
                  onTap: () => FocusScope.of(context).unfocus(),
                  child: RefreshIndicator(
                    onRefresh: () => _load(preserveUnitId: unit.id),
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        _HeaderCard(
                          currentIndex: _index + 1,
                          total: _units.length,
                          pending: _pendingCount,
                          entered: _units.length - _pendingCount,
                        ),
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.all(18),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            border: Border.all(color: Colors.grey.shade200),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Unit ${unit.unitNumber}',
                                          style: const TextStyle(
                                            fontSize: 26,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        if (unit.residentName != null) ...[
                                          const SizedBox(height: 4),
                                          Text(
                                            unit.residentName!,
                                            style: TextStyle(
                                              color: Colors.grey.shade700,
                                              fontSize: 15,
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                  _StatusChip(status: unit.readingStatus),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Row(
                                children: [
                                  Expanded(
                                    child: _ReadingInfoTile(
                                      label: 'Previous',
                                      value: unit.previousReading
                                          .toStringAsFixed(2),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: _ReadingInfoTile(
                                      label: 'Meter',
                                      value: unit.meterNumber ?? 'N/A',
                                      mono: true,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 18),
                              const Text(
                                'Current reading',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 8),
                              TextField(
                                controller: _readingController,
                                focusNode: _focusNode,
                                autofocus: true,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                                textInputAction: TextInputAction.done,
                                inputFormatters: [
                                  FilteringTextInputFormatter.allow(
                                    RegExp(r'^\d*\.?\d*'),
                                  ),
                                ],
                                style: const TextStyle(
                                  fontSize: 32,
                                  fontWeight: FontWeight.w700,
                                ),
                                decoration: InputDecoration(
                                  hintText: '0.00',
                                  suffixText: 'cu.m',
                                  errorText: _error,
                                ),
                                onChanged: _validate,
                                onSubmitted: (_) => _save(moveNext: true),
                              ),
                              if (_currentReading != null &&
                                  _error == null) ...[
                                const SizedBox(height: 12),
                                Container(
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: Colors.blue.shade50,
                                    borderRadius: BorderRadius.circular(14),
                                    border:
                                        Border.all(color: Colors.blue.shade100),
                                  ),
                                  child: Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Text(
                                        'Consumption',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      Text(
                                        '${(_currentReading! - unit.previousReading).toStringAsFixed(2)} cu.m',
                                        style: TextStyle(
                                          color: Colors.blue.shade800,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 18,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                              if (_warning != null) ...[
                                const SizedBox(height: 12),
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: Colors.orange.shade50,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: Colors.orange.shade200,
                                    ),
                                  ),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Icon(
                                        Icons.warning_amber,
                                        color: Colors.orange.shade700,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          _warning!,
                                          style: TextStyle(
                                            color: Colors.orange.shade900,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                              const SizedBox(height: 18),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _index > 0
                                          ? () => _goTo(_index - 1)
                                          : null,
                                      icon: const Icon(Icons.arrow_back),
                                      label: const Text('Previous'),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _openDetails,
                                      icon: const Icon(Icons.tune),
                                      label: const Text('Details'),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: _saving
                                          ? null
                                          : () => _save(moveNext: false),
                                      child: const Text('Save & Stay'),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: FilledButton.icon(
                                      onPressed: (_saving ||
                                              _currentReading == null ||
                                              _error != null)
                                          ? null
                                          : () => _save(moveNext: true),
                                      icon: _saving
                                          ? const SizedBox(
                                              width: 18,
                                              height: 18,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Colors.white,
                                              ),
                                            )
                                          : const Icon(Icons.arrow_forward),
                                      label: Text(
                                        _saving ? 'Saving...' : 'Save & Next',
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
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
                                'Upcoming units',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 10),
                              ..._units.skip(_index).take(5).map(
                                    (queuedUnit) => Padding(
                                      padding:
                                          const EdgeInsets.only(bottom: 10),
                                      child: Row(
                                        children: [
                                          Icon(
                                            queuedUnit.readingStatus ==
                                                    'pending'
                                                ? Icons.radio_button_unchecked
                                                : queuedUnit.readingStatus ==
                                                        'flagged'
                                                    ? Icons.warning_amber
                                                    : Icons.check_circle,
                                            size: 18,
                                            color: queuedUnit.readingStatus ==
                                                    'pending'
                                                ? Colors.grey.shade400
                                                : queuedUnit.readingStatus ==
                                                        'flagged'
                                                    ? Colors.orange.shade700
                                                    : Colors.green.shade700,
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Text(
                                              'Unit ${queuedUnit.unitNumber}'
                                              '${queuedUnit.residentName != null ? ' - ${queuedUnit.residentName}' : ''}',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  final int currentIndex;
  final int total;
  final int pending;
  final int entered;

  const _HeaderCard({
    required this.currentIndex,
    required this.total,
    required this.pending,
    required this.entered,
  });

  @override
  Widget build(BuildContext context) {
    final progress = total > 0 ? entered / total : 0.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.blue.shade100),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Continuous entry',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              Text(
                '$currentIndex / $total',
                style: TextStyle(
                  color: Colors.blue.shade700,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 8,
              backgroundColor: Colors.blue.shade100,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(Color(0xFF1D4ED8)),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '$entered entered • $pending pending',
            style: TextStyle(color: Colors.grey.shade700),
          ),
        ],
      ),
    );
  }
}

class _ReadingInfoTile extends StatelessWidget {
  final String label;
  final String value;
  final bool mono;

  const _ReadingInfoTile({
    required this.label,
    required this.value,
    this.mono = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              fontFamily: mono ? 'monospace' : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;

  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final (Color background, Color foreground, String label) = switch (status) {
      'submitted' => (Colors.green.shade50, Colors.green.shade700, 'Entered'),
      'flagged' => (Colors.orange.shade50, Colors.orange.shade800, 'Flagged'),
      _ => (Colors.grey.shade100, Colors.grey.shade700, 'Pending'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
