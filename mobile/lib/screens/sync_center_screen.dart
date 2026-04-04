import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/database_service.dart';
import '../services/session_provider.dart';
import '../services/sync_service.dart';

class SyncCenterScreen extends StatefulWidget {
  final VoidCallback onOpenAssignments;
  final VoidCallback onImportComplete;

  const SyncCenterScreen({
    super.key,
    required this.onOpenAssignments,
    required this.onImportComplete,
  });

  @override
  State<SyncCenterScreen> createState() => _SyncCenterScreenState();
}

class _SyncCenterScreenState extends State<SyncCenterScreen> {
  bool _loading = true;
  bool _busy = false;
  int? _selectedCycleId;
  List<Map<String, dynamic>> _cycles = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final cycles = await DatabaseService.instance.getStoredCycles();
    setState(() {
      _cycles = cycles;
      _selectedCycleId = cycles.isEmpty
          ? null
          : (_selectedCycleId ?? cycles.first['id'] as int);
      _loading = false;
    });
  }

  Future<void> _importReadingList() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['json'],
    );
    if (result == null || result.files.single.path == null) return;

    setState(() => _busy = true);
    try {
      final file = File(result.files.single.path!);
      final content = await file.readAsString();
      final payload = jsonDecode(content) as Map<String, dynamic>;
      final count = await DatabaseService.instance.importReadingList(payload);

      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Imported $count units for ${payload['period_start']} to ${payload['period_end']}',
          ),
          backgroundColor: Colors.green.shade700,
        ),
      );
      widget.onImportComplete();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Import failed: $error'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _exportReadings() async {
    if (_selectedCycleId == null) return;

    setState(() => _busy = true);
    final session = context.read<SessionProvider>();
    final syncService = SyncService();

    final result = await syncService.exportReadings(
      cycleId: _selectedCycleId!,
      exportedBy: session.username ?? 'unknown',
    );

    if (!mounted) return;
    setState(() => _busy = false);

    if (result.cancelled) return;

    if (result.success) {
      final message = result.shared
          ? 'Exported ${result.count} readings. Share sheet opened.'
          : 'Exported ${result.count} readings to ${result.filePath}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Colors.green.shade700,
        ),
      );
      await _load();
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
    final desktopStyleExport =
        Platform.isWindows || Platform.isLinux || Platform.isMacOS;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sync Center'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue.shade50,
                      border: Border.all(color: Colors.blue.shade100),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'How sync works',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '1. Import a desktop reading list.\n'
                          '2. Record readings in the field.\n'
                          '3. Export the completed readings back to the desktop app.',
                          style: TextStyle(
                              color: Colors.grey.shade700, height: 1.5),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _ActionCard(
                    title: 'Import desktop assignment',
                    subtitle:
                        'Load the current reading list from the desktop app.',
                    note: 'Current import format: JSON',
                    buttonLabel: 'Import Reading List',
                    icon: Icons.upload_file,
                    busy: _busy,
                    onPressed: _importReadingList,
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
                          'Export completed readings',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Choose a stored cycle and export the unsynced readings back to desktop.',
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                        const SizedBox(height: 14),
                        if (_cycles.isEmpty)
                          Text(
                            'No imported cycle yet. Import first.',
                            style: TextStyle(color: Colors.grey.shade600),
                          )
                        else ...[
                          DropdownButtonFormField<int>(
                            value: _selectedCycleId,
                            items: _cycles
                                .map(
                                  (cycle) => DropdownMenuItem<int>(
                                    value: cycle['id'] as int,
                                    child: Text(
                                      '${cycle['period_start']} to ${cycle['period_end']}',
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: _busy
                                ? null
                                : (value) =>
                                    setState(() => _selectedCycleId = value),
                            decoration: const InputDecoration(
                              labelText: 'Cycle to export',
                            ),
                          ),
                          const SizedBox(height: 14),
                          FilledButton.icon(
                            onPressed: _busy ? null : _exportReadings,
                            icon: Icon(
                              desktopStyleExport ? Icons.save_alt : Icons.share,
                            ),
                            label: Text(
                              desktopStyleExport
                                  ? 'Save JSON Export'
                                  : 'Share JSON Export',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: widget.onOpenAssignments,
                    icon: const Icon(Icons.assignment),
                    label: const Text('Return to Assignments'),
                  ),
                ],
              ),
            ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String note;
  final String buttonLabel;
  final IconData icon;
  final bool busy;
  final VoidCallback onPressed;

  const _ActionCard({
    required this.title,
    required this.subtitle,
    required this.note,
    required this.buttonLabel,
    required this.icon,
    required this.busy,
    required this.onPressed,
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
          Text(title,
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(subtitle, style: TextStyle(color: Colors.grey.shade700)),
          const SizedBox(height: 8),
          Text(note,
              style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: busy ? null : onPressed,
            icon: Icon(icon),
            label: Text(buttonLabel),
          ),
        ],
      ),
    );
  }
}
