// lib/screens/reading_entry_screen.dart

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../models/unit.dart';
import '../models/reading.dart';
import '../services/database_service.dart';

class ReadingEntryScreen extends StatefulWidget {
  final Unit unit;
  final int billingCycleId;

  const ReadingEntryScreen({
    super.key,
    required this.unit,
    required this.billingCycleId,
  });

  @override
  State<ReadingEntryScreen> createState() => _ReadingEntryScreenState();
}

class _ReadingEntryScreenState extends State<ReadingEntryScreen> {
  final _ctrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  final _focusNode = FocusNode();

  double? _currentReading;
  String? _error;
  String? _warning;
  String? _photoPath;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadExisting();
  }

  Future<void> _loadExisting() async {
    final existing = await DatabaseService.instance.getReadingForUnit(
      widget.unit.id,
      widget.billingCycleId,
    );
    if (existing != null && mounted) {
      setState(() {
        _ctrl.text = existing.currentReading.toStringAsFixed(2);
        _notesCtrl.text = existing.notes ?? '';
        _photoPath = existing.photoPath;
        _currentReading = existing.currentReading;
      });
      _validate(existing.currentReading.toStringAsFixed(2));
    }
  }

  void _validate(String val) {
    final current = double.tryParse(val);
    if (current == null) {
      setState(() {
        _currentReading = null;
        _error = null;
        _warning = null;
      });
      return;
    }

    final consumption = current - widget.unit.previousReading;

    setState(() {
      _currentReading = current;

      if (current < widget.unit.previousReading) {
        _error = null;
        _warning =
            'Current (${current.toStringAsFixed(2)}) is below previous (${widget.unit.previousReading.toStringAsFixed(2)}). It will be saved and flagged for review.';
        return;
      }
      _error = null;

      if (consumption == 0) {
        _warning = 'Zero consumption — verify meter is connected.';
        return;
      }

      final avg = widget.unit.avgConsumption;
      if (avg > 0 && consumption > avg * 3) {
        _warning = 'Abnormal spike: ${consumption.toStringAsFixed(2)} cu.m '
            '(avg ${avg.toStringAsFixed(2)} cu.m). Will be flagged for review.';
        return;
      }

      _warning = null;
    });
  }

  Future<void> _pickPhoto() async {
    final picker = ImagePicker();
    final image = await picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 70,
      maxWidth: 1280,
    );
    if (image != null) {
      setState(() => _photoPath = image.path);
    }
  }

  Future<void> _save() async {
    final current = _currentReading;
    if (current == null || _error != null) return;

    setState(() => _saving = true);

    final consumption = current - widget.unit.previousReading;
    final avg = widget.unit.avgConsumption;
    final isSpike = avg > 0 && consumption > avg * 3;
    final isBelowPrev = current < widget.unit.previousReading;

    final String status;
    final String? flagReason;

    if (isBelowPrev) {
      status = 'flagged';
      flagReason = 'CURRENT_BELOW_PREVIOUS';
    } else if (isSpike) {
      status = 'flagged';
      flagReason =
          'ABNORMAL_SPIKE: ${consumption.toStringAsFixed(2)} cu.m vs avg ${avg.toStringAsFixed(2)}';
    } else {
      status = 'submitted';
      flagReason = null;
    }

    final reading = Reading(
      unitId: widget.unit.id,
      billingCycleId: widget.billingCycleId,
      previousReading: widget.unit.previousReading,
      currentReading: current,
      readAt: DateTime.now().toIso8601String(),
      status: status,
      flagReason: flagReason,
      notes: _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim(),
      photoPath: _photoPath,
    );

    await DatabaseService.instance.saveReading(reading);
    setState(() => _saving = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            status == 'flagged'
                ? 'Saved & flagged for review.'
                : 'Reading saved: ${consumption.toStringAsFixed(2)} cu.m',
          ),
          backgroundColor: status == 'flagged'
              ? Colors.orange.shade700
              : Colors.green.shade700,
          duration: const Duration(seconds: 2),
        ),
      );
      Navigator.pop(context, true);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _notesCtrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final consumption = _currentReading != null
        ? _currentReading! - widget.unit.previousReading
        : null;

    return Scaffold(
      appBar: AppBar(
        title: Text('Unit ${widget.unit.unitNumber}'),
        bottom: widget.unit.residentName != null
            ? PreferredSize(
                preferredSize: const Size.fromHeight(24),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      widget.unit.residentName!,
                      style:
                          const TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ),
                ),
              )
            : null,
      ),
      body: GestureDetector(
        onTap: () => FocusScope.of(context).unfocus(),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Previous reading info card
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  border: Border.all(color: Colors.grey.shade200),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Previous Reading',
                              style: TextStyle(
                                  fontSize: 11, color: Colors.grey.shade500)),
                          const SizedBox(height: 2),
                          Text(
                            '${widget.unit.previousReading.toStringAsFixed(2)} cu.m',
                            style: const TextStyle(
                                fontSize: 22, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    if (widget.unit.meterNumber != null)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('Meter No.',
                              style: TextStyle(
                                  fontSize: 11, color: Colors.grey.shade500)),
                          const SizedBox(height: 2),
                          Text(widget.unit.meterNumber!,
                              style: const TextStyle(
                                  fontFamily: 'monospace', fontSize: 13)),
                        ],
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Current reading input
              Text(
                'Current Reading (cu.m)',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade700),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _ctrl,
                focusNode: _focusNode,
                autofocus: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*'))
                ],
                style:
                    const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                decoration: InputDecoration(
                  hintText: '0.00',
                  hintStyle:
                      TextStyle(fontSize: 28, color: Colors.grey.shade300),
                  suffixText: 'cu.m',
                  suffixStyle:
                      TextStyle(fontSize: 14, color: Colors.grey.shade500),
                  errorText: _error,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12)),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: Colors.grey.shade300),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide:
                        const BorderSide(color: Color(0xFF1D4ED8), width: 2),
                  ),
                  errorBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Colors.red),
                  ),
                ),
                onChanged: _validate,
              ),
              const SizedBox(height: 12),

              // Consumption display
              if (consumption != null && _error == null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: consumption < 0
                        ? Colors.red.shade50
                        : consumption == 0
                            ? Colors.grey.shade50
                            : Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: consumption < 0
                          ? Colors.red.shade200
                          : Colors.blue.shade200,
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Consumption',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: Colors.grey.shade700,
                        ),
                      ),
                      Text(
                        '${consumption.toStringAsFixed(2)} cu.m',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: consumption < 0
                              ? Colors.red.shade700
                              : consumption == 0
                                  ? Colors.grey.shade600
                                  : Colors.blue.shade800,
                        ),
                      ),
                    ],
                  ),
                ),

              // Warning banner
              if (_warning != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade50,
                    border: Border.all(color: Colors.orange.shade300),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.warning_amber,
                          color: Colors.orange.shade700, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _warning!,
                          style: TextStyle(
                              fontSize: 13, color: Colors.orange.shade900),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),

              // Notes
              TextField(
                controller: _notesCtrl,
                maxLines: 2,
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(
                  labelText: 'Notes (optional)',
                  hintText: 'e.g. Meter cover broken, cannot read clearly',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),

              // Photo capture
              GestureDetector(
                onTap: _pickPhoto,
                child: Container(
                  height: _photoPath != null ? 180 : 70,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade50,
                    border: Border.all(
                      color: _photoPath != null
                          ? Colors.blue.shade300
                          : Colors.grey.shade300,
                      style: BorderStyle.solid,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: _photoPath != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(11),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              Image.file(File(_photoPath!), fit: BoxFit.cover),
                              Positioned(
                                top: 8,
                                right: 8,
                                child: GestureDetector(
                                  onTap: () =>
                                      setState(() => _photoPath = null),
                                  child: Container(
                                    padding: const EdgeInsets.all(4),
                                    decoration: BoxDecoration(
                                      color: Colors.black54,
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                    child: const Icon(Icons.close,
                                        color: Colors.white, size: 16),
                                  ),
                                ),
                              ),
                              Positioned(
                                bottom: 8,
                                right: 8,
                                child: GestureDetector(
                                  onTap: _pickPhoto,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 10, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: Colors.black54,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.camera_alt,
                                            color: Colors.white, size: 14),
                                        SizedBox(width: 4),
                                        Text('Retake',
                                            style: TextStyle(
                                                color: Colors.white,
                                                fontSize: 12)),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        )
                      : Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.camera_alt_outlined,
                                color: Colors.grey.shade400, size: 20),
                            const SizedBox(width: 8),
                            Text(
                              'Take meter photo (optional)',
                              style: TextStyle(
                                  color: Colors.grey.shade500, fontSize: 13),
                            ),
                          ],
                        ),
                ),
              ),
              const SizedBox(height: 24),

              // Save button
              ElevatedButton.icon(
                onPressed:
                    (_currentReading == null || _error != null || _saving)
                        ? null
                        : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Icon(_warning != null ? Icons.flag : Icons.save),
                label: Text(
                  _saving
                      ? 'Saving…'
                      : _warning != null
                          ? 'Save & Flag for Review'
                          : 'Save Reading',
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _warning != null
                      ? Colors.orange.shade700
                      : const Color(0xFF1D4ED8),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),

              // Skip option
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Skip this unit',
                    style: TextStyle(color: Colors.grey)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
