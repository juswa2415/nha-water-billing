class Reading {
  final int? id;
  final int unitId;
  final int billingCycleId;
  final double previousReading;
  final double currentReading;
  final String readAt;
  final String status;
  final String? flagReason;
  final String? notes;
  final String? photoPath;

  double get consumption => currentReading - previousReading;

  const Reading({
    this.id,
    required this.unitId,
    required this.billingCycleId,
    required this.previousReading,
    required this.currentReading,
    required this.readAt,
    required this.status,
    this.flagReason,
    this.notes,
    this.photoPath,
  });

  Map<String, dynamic> toDb() => {
        'unit_id': unitId,
        'billing_cycle_id': billingCycleId,
        'previous_reading': previousReading,
        'current_reading': currentReading,
        'read_at': readAt,
        'status': status,
        'flag_reason': flagReason,
        'notes': notes,
        'photo_path': photoPath,
      };
}
