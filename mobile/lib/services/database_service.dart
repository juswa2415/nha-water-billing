// lib/services/database_service.dart

import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/unit.dart';
import '../models/reading.dart';

class DatabaseService {
  static final DatabaseService instance = DatabaseService._();
  static Database? _db;

  DatabaseService._();

  Future<Database> get db async {
    _db ??= await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'nha_mobile.db');
    return openDatabase(
      path,
      version: 1,
      onCreate: _onCreate,
      onConfigure: (db) async {
        await db.execute('PRAGMA foreign_keys = ON');
        await db.execute('PRAGMA journal_mode = WAL');
      },
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE session (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        login_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE billing_cycles (
        id INTEGER PRIMARY KEY,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        exported_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE units (
        id INTEGER PRIMARY KEY,
        billing_cycle_id INTEGER NOT NULL,
        unit_number TEXT NOT NULL,
        building_code TEXT NOT NULL,
        floor_number INTEGER NOT NULL,
        meter_number TEXT,
        resident_name TEXT,
        previous_reading REAL NOT NULL DEFAULT 0,
        reading_status TEXT NOT NULL DEFAULT 'pending',
        avg_consumption REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id)
      )
    ''');

    await db.execute('''
      CREATE TABLE readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id INTEGER NOT NULL,
        billing_cycle_id INTEGER NOT NULL,
        previous_reading REAL NOT NULL,
        current_reading REAL NOT NULL,
        read_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        flag_reason TEXT,
        notes TEXT,
        photo_path TEXT,
        synced INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (unit_id) REFERENCES units(id)
      )
    ''');

    await db.execute(
        'CREATE INDEX idx_units_building ON units(building_code, floor_number)');
    await db.execute('CREATE INDEX idx_units_cycle ON units(billing_cycle_id)');
    await db.execute('CREATE INDEX idx_readings_unit ON readings(unit_id)');
  }

  // ── Session ─────────────────────────────────────────────────────

  Future<void> saveSession(
      String username, String fullName, String role) async {
    final d = await db;
    await d.delete('session');
    await d.insert('session', {
      'username': username,
      'full_name': fullName,
      'role': role,
      'login_at': DateTime.now().toIso8601String(),
    });
  }

  Future<Map<String, dynamic>?> getSession() async {
    final d = await db;
    final rows = await d.query('session', limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<void> clearSession() async {
    final d = await db;
    await d.delete('session');
  }

  // ── Import reading list from desktop ────────────────────────────

  Future<int> importReadingList(Map<String, dynamic> payload) async {
    final d = await db;
    final cycleId = payload['billing_cycle_id'] as int;
    final periodStart = payload['period_start'] as String;
    final periodEnd = payload['period_end'] as String;
    final exportedAt = payload['exported_at'] as String;
    final units = (payload['units'] as List).cast<Map<String, dynamic>>();

    await d.transaction((txn) async {
      // Upsert billing cycle
      await txn.insert(
          'billing_cycles',
          {
            'id': cycleId,
            'period_start': periodStart,
            'period_end': periodEnd,
            'exported_at': exportedAt,
          },
          conflictAlgorithm: ConflictAlgorithm.replace);

      // Clear old units for this cycle
      await txn
          .delete('units', where: 'billing_cycle_id = ?', whereArgs: [cycleId]);

      // Insert units
      for (final u in units) {
        await txn.insert(
            'units',
            {
              'id': u['unit_id'],
              'billing_cycle_id': cycleId,
              'unit_number': u['unit_number'],
              'building_code': u['building_code'],
              'floor_number': u['floor_number'],
              'meter_number': u['meter_number'],
              'resident_name': u['resident_name'],
              'previous_reading': u['previous_reading'],
              'reading_status': u['reading_status'] ?? 'pending',
              'avg_consumption': u['avg_consumption'] ?? 0,
            },
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });

    return units.length;
  }

  // ── Units ────────────────────────────────────────────────────────

  Future<List<String>> getBuildings(int cycleId) async {
    final d = await db;
    final rows = await d.rawQuery(
      'SELECT DISTINCT building_code FROM units WHERE billing_cycle_id = ? ORDER BY building_code',
      [cycleId],
    );
    return rows.map((r) => r['building_code'] as String).toList();
  }

  Future<List<int>> getFloors(int cycleId, String buildingCode) async {
    final d = await db;
    final rows = await d.rawQuery(
      'SELECT DISTINCT floor_number FROM units WHERE billing_cycle_id = ? AND building_code = ? ORDER BY floor_number',
      [cycleId, buildingCode],
    );
    return rows.map((r) => r['floor_number'] as int).toList();
  }

  Future<List<Unit>> getUnitsForFloor(
      int cycleId, String buildingCode, int floor) async {
    final d = await db;
    final rows = await d.query(
      'units',
      where: 'billing_cycle_id = ? AND building_code = ? AND floor_number = ?',
      whereArgs: [cycleId, buildingCode, floor],
      orderBy: 'unit_number',
    );
    return rows.map(Unit.fromDb).toList();
  }

  Future<int> getActiveCycleId() async {
    final d = await db;
    final rows = await d.rawQuery(
        'SELECT id FROM billing_cycles ORDER BY exported_at DESC LIMIT 1');
    if (rows.isEmpty) return -1;
    return rows.first['id'] as int;
  }

  Future<List<Map<String, dynamic>>> getStoredCycles() async {
    final d = await db;
    final rows = await d.rawQuery(
      'SELECT id, period_start, period_end, exported_at '
      'FROM billing_cycles ORDER BY exported_at DESC',
    );
    return rows
        .map(
          (row) => {
            'id': row['id'] as int,
            'period_start': row['period_start'] as String,
            'period_end': row['period_end'] as String,
            'exported_at': row['exported_at'] as String,
          },
        )
        .toList();
  }

  Future<Map<String, int>> getCycleStatusCounts(int cycleId) async {
    final d = await db;
    final rows = await d.rawQuery(
      '''
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN reading_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN reading_status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
        SUM(CASE WHEN reading_status IN ('submitted', 'flagged') THEN 1 ELSE 0 END) AS entered
      FROM units
      WHERE billing_cycle_id = ?
      ''',
      [cycleId],
    );
    final row = rows.first;
    return {
      'total': (row['total'] as num?)?.toInt() ?? 0,
      'pending': (row['pending'] as num?)?.toInt() ?? 0,
      'flagged': (row['flagged'] as num?)?.toInt() ?? 0,
      'entered': (row['entered'] as num?)?.toInt() ?? 0,
    };
  }

  Future<Map<String, dynamic>?> getLatestCycleSummary() async {
    final d = await db;
    final rows = await d.rawQuery(
      'SELECT id, period_start, period_end, exported_at '
      'FROM billing_cycles ORDER BY exported_at DESC LIMIT 1',
    );
    if (rows.isEmpty) return null;

    final cycle = rows.first;
    final cycleId = cycle['id'] as int;
    final stats = await getCycleStatusCounts(cycleId);
    final buildingCount = Sqflite.firstIntValue(
          await d.rawQuery(
            'SELECT COUNT(DISTINCT building_code) FROM units WHERE billing_cycle_id = ?',
            [cycleId],
          ),
        ) ??
        0;

    return {
      'id': cycleId,
      'period_start': cycle['period_start'] as String,
      'period_end': cycle['period_end'] as String,
      'exported_at': cycle['exported_at'] as String,
      'building_count': buildingCount,
      ...stats,
    };
  }

  Future<List<Map<String, dynamic>>> getBuildingSummaries(int cycleId) async {
    final d = await db;
    final rows = await d.rawQuery(
      '''
      SELECT
        building_code,
        COUNT(*) AS total,
        SUM(CASE WHEN reading_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN reading_status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
        SUM(CASE WHEN reading_status IN ('submitted', 'flagged') THEN 1 ELSE 0 END) AS entered
      FROM units
      WHERE billing_cycle_id = ?
      GROUP BY building_code
      ORDER BY building_code
      ''',
      [cycleId],
    );

    return rows
        .map(
          (row) => {
            'building_code': row['building_code'] as String,
            'total': (row['total'] as num?)?.toInt() ?? 0,
            'pending': (row['pending'] as num?)?.toInt() ?? 0,
            'flagged': (row['flagged'] as num?)?.toInt() ?? 0,
            'entered': (row['entered'] as num?)?.toInt() ?? 0,
          },
        )
        .toList();
  }

  Future<int> getUnsyncedCount(int cycleId) async {
    final d = await db;
    return Sqflite.firstIntValue(
          await d.rawQuery(
            'SELECT COUNT(*) FROM readings WHERE billing_cycle_id = ? AND synced = 0',
            [cycleId],
          ),
        ) ??
        0;
  }

  // ── Readings ─────────────────────────────────────────────────────

  Future<void> saveReading(Reading reading) async {
    final d = await db;
    await d.insert(
      'readings',
      reading.toDb(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
    // Update unit status
    await d.update(
      'units',
      {'reading_status': reading.status},
      where: 'id = ?',
      whereArgs: [reading.unitId],
    );
  }

  Future<Reading?> getReadingForUnit(int unitId, int cycleId) async {
    final d = await db;
    final rows = await d.query(
      'readings',
      where: 'unit_id = ? AND billing_cycle_id = ?',
      whereArgs: [unitId, cycleId],
      limit: 1,
      orderBy: 'read_at DESC',
    );
    if (rows.isEmpty) return null;
    final row = rows.first;
    return Reading(
      id: row['id'] as int?,
      unitId: row['unit_id'] as int,
      billingCycleId: row['billing_cycle_id'] as int,
      previousReading: (row['previous_reading'] as num).toDouble(),
      currentReading: (row['current_reading'] as num).toDouble(),
      readAt: row['read_at'] as String,
      status: row['status'] as String,
      flagReason: row['flag_reason'] as String?,
      notes: row['notes'] as String?,
      photoPath: row['photo_path'] as String?,
    );
  }

  Future<List<Map<String, dynamic>>> getAllUnsynced(int cycleId) async {
    final d = await db;
    return d.rawQuery(
      '''SELECT r.*, u.unit_number, u.building_code
         FROM readings r JOIN units u ON u.id = r.unit_id
         WHERE r.billing_cycle_id = ? AND r.synced = 0''',
      [cycleId],
    );
  }

  Future<void> markSynced(List<int> ids) async {
    final d = await db;
    await d.rawUpdate(
      'UPDATE readings SET synced = 1 WHERE id IN (${ids.map((_) => '?').join(',')})',
      ids,
    );
  }

  // Stats for header display
  Future<Map<String, int>> getCycleProgress(int cycleId) async {
    final d = await db;
    final total = Sqflite.firstIntValue(await d.rawQuery(
            'SELECT COUNT(*) FROM units WHERE billing_cycle_id = ?',
            [cycleId])) ??
        0;
    final done = Sqflite.firstIntValue(await d.rawQuery(
            "SELECT COUNT(*) FROM readings WHERE billing_cycle_id = ? AND status IN ('submitted','flagged')",
            [cycleId])) ??
        0;
    return {'total': total, 'done': done};
  }
}
