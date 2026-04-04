import 'dart:convert';

import 'package:crypto/crypto.dart';

class MobileReading {
  final int unitId;
  final String unitNumber;
  final String buildingCode;
  final double previousReading;
  final double currentReading;
  final String? notes;
  final String? photoFilename;
  final String readAt;
  final String submittedByUsername;

  const MobileReading({
    required this.unitId,
    required this.unitNumber,
    required this.buildingCode,
    required this.previousReading,
    required this.currentReading,
    this.notes,
    this.photoFilename,
    required this.readAt,
    required this.submittedByUsername,
  });

  Map<String, dynamic> toJson() => {
        'unit_id': unitId,
        'unit_number': unitNumber,
        'building_code': buildingCode,
        'previous_reading': previousReading,
        'current_reading': currentReading,
        'notes': notes,
        'photo_filename': photoFilename,
        'read_at': readAt,
        'submitted_by_username': submittedByUsername,
      };
}

class SyncPayload {
  final String version;
  final String exportedAt;
  final int billingCycleId;
  final String exportedBy;
  final List<MobileReading> readings;

  const SyncPayload({
    required this.version,
    required this.exportedAt,
    required this.billingCycleId,
    required this.exportedBy,
    required this.readings,
  });

  String _computeChecksum() {
    final input = readings.map((reading) => '${reading.unitId}:${reading.currentReading}').join('|');
    return sha256.convert(utf8.encode(input)).toString();
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'exported_at': exportedAt,
        'billing_cycle_id': billingCycleId,
        'exported_by': exportedBy,
        'readings': readings.map((reading) => reading.toJson()).toList(),
        'checksum': _computeChecksum(),
      };

  String toJsonString() => jsonEncode(toJson());
}
