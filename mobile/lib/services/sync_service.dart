import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../models/sync_payload.dart';
import 'database_service.dart';

class ExportResult {
  final bool success;
  final bool cancelled;
  final bool shared;
  final int count;
  final String? error;
  final String? filePath;

  const ExportResult.ok({
    required this.count,
    required this.filePath,
    required this.shared,
  })  : success = true,
        cancelled = false,
        error = null;

  const ExportResult.fail(this.error)
      : success = false,
        cancelled = false,
        shared = false,
        count = 0,
        filePath = null;

  const ExportResult.cancelled()
      : success = false,
        cancelled = true,
        shared = false,
        count = 0,
        error = null,
        filePath = null;
}

class SyncService {
  Future<ExportResult> exportReadings({
    required int cycleId,
    required String exportedBy,
  }) async {
    try {
      final db = DatabaseService.instance;
      final rows = await db.getAllUnsynced(cycleId);

      if (rows.isEmpty) {
        return const ExportResult.fail('No unsynced readings found for this cycle.');
      }

      final mobileReadings = rows
          .map(
            (row) => MobileReading(
              unitId: row['unit_id'] as int,
              unitNumber: row['unit_number'] as String,
              buildingCode: row['building_code'] as String,
              previousReading: (row['previous_reading'] as num).toDouble(),
              currentReading: (row['current_reading'] as num).toDouble(),
              notes: row['notes'] as String?,
              photoFilename: row['photo_path'] != null
                  ? (row['photo_path'] as String).split(Platform.pathSeparator).last
                  : null,
              readAt: row['read_at'] as String,
              submittedByUsername: exportedBy,
            ),
          )
          .toList();

      final payload = SyncPayload(
        version: '1.0.0',
        exportedAt: DateTime.now().toIso8601String(),
        billingCycleId: cycleId,
        exportedBy: exportedBy,
        readings: mobileReadings,
      );

      final timestamp = DateTime.now().toIso8601String().replaceAll(':', '-').substring(0, 19);
      final fileName = 'nha_readings_cycle${cycleId}_$timestamp.json';
      final json = payload.toJsonString();

      final saveToFile = Platform.isWindows || Platform.isLinux || Platform.isMacOS;
      late final File file;
      var shared = false;

      if (saveToFile) {
        final outputPath = await FilePicker.platform.saveFile(
          dialogTitle: 'Save mobile readings export',
          fileName: fileName,
          type: FileType.custom,
          allowedExtensions: ['json'],
        );

        if (outputPath == null) {
          return const ExportResult.cancelled();
        }

        file = File(outputPath);
        await file.writeAsString(json);
      } else {
        final dir = await getTemporaryDirectory();
        file = File('${dir.path}/$fileName');
        await file.writeAsString(json);

        await Share.shareXFiles(
          [XFile(file.path, mimeType: 'application/json')],
          subject: 'NHA Water Readings - Cycle $cycleId - $exportedBy',
          text: 'Water meter readings export from NHA mobile app.\n'
              'Cycle: $cycleId | Readings: ${mobileReadings.length} | Exported by: $exportedBy',
        );
        shared = true;
      }

      final ids = rows.map((row) => row['id'] as int).toList();
      await db.markSynced(ids);

      return ExportResult.ok(
        count: mobileReadings.length,
        filePath: file.path,
        shared: shared,
      );
    } catch (error) {
      return ExportResult.fail(error.toString());
    }
  }
}
