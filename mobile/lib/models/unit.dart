// lib/models/unit.dart

class Unit {
  final int id;
  final String unitNumber;
  final String buildingCode;
  final int floorNumber;
  final String? meterNumber;
  final String? residentName;
  final double previousReading;
  final String readingStatus; // pending | submitted | approved
  final double avgConsumption;

  const Unit({
    required this.id,
    required this.unitNumber,
    required this.buildingCode,
    required this.floorNumber,
    this.meterNumber,
    this.residentName,
    required this.previousReading,
    required this.readingStatus,
    this.avgConsumption = 0,
  });

  Unit copyWith({
    String? readingStatus,
    double? previousReading,
    double? avgConsumption,
  }) {
    return Unit(
      id: id,
      unitNumber: unitNumber,
      buildingCode: buildingCode,
      floorNumber: floorNumber,
      meterNumber: meterNumber,
      residentName: residentName,
      previousReading: previousReading ?? this.previousReading,
      readingStatus: readingStatus ?? this.readingStatus,
      avgConsumption: avgConsumption ?? this.avgConsumption,
    );
  }

  factory Unit.fromJson(Map<String, dynamic> json) => Unit(
        id: json['unit_id'] as int,
        unitNumber: json['unit_number'] as String,
        buildingCode: json['building_code'] as String,
        floorNumber: json['floor_number'] as int,
        meterNumber: json['meter_number'] as String?,
        residentName: json['resident_name'] as String?,
        previousReading: (json['previous_reading'] as num).toDouble(),
        readingStatus: json['reading_status'] as String? ?? 'pending',
      );

  factory Unit.fromDb(Map<String, dynamic> row) => Unit(
        id: row['id'] as int,
        unitNumber: row['unit_number'] as String,
        buildingCode: row['building_code'] as String,
        floorNumber: row['floor_number'] as int,
        meterNumber: row['meter_number'] as String?,
        residentName: row['resident_name'] as String?,
        previousReading: (row['previous_reading'] as num).toDouble(),
        readingStatus: row['reading_status'] as String? ?? 'pending',
        avgConsumption: (row['avg_consumption'] as num?)?.toDouble() ?? 0,
      );
}
