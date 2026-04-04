# Mobile Reading Redesign Plan

## Purpose

Redesign the mobile app so it aligns with the current desktop Readings workflow:

- desktop supports primary manual encoding and review
- mobile supports structured field collection
- both use compatible import and export formats
- field work remains possible offline

The mobile app should not feel like a side project. It should behave like a proper field collection client for water meter readings.

## Product Direction

The desktop app remains the control center.
The mobile app becomes a focused field tool.

Desktop responsibilities:

- create billing cycles
- export reading assignments
- import completed reading files
- review flagged readings
- approve readings
- generate bills

Mobile responsibilities:

- receive one assigned cycle
- show assigned buildings, floors, and units
- collect readings quickly in the field
- flag questionable entries immediately
- optionally attach meter photos
- export completed work back to desktop

## Recommended File Strategy

Do not treat all file types as equal.
Use one canonical format and a few optional interchange formats.

Recommended support:

- `JSON` as the canonical sync format
- `CSV` as a plain fallback export/import format
- `ZIP` bundle for JSON plus optional photos

Why:

- `JSON` can carry timestamps, user info, status, notes, flags, and validation metadata
- `CSV` is useful for simple backup and spreadsheet handling, but loses structure
- `ZIP` is the clean option when meter photos are included

Recommended rule:

- Desktop export reading list: `JSON`
- Mobile import reading list: `JSON`
- Mobile export completed readings: `JSON` and optional `CSV`
- If photos are included: export a `ZIP` that contains:
  - `manifest.json`
  - `photos/...`

Desktop import should support:

- `JSON`
- `CSV`
- `ZIP` bundle

Internally, all imports should normalize into the same reading row model before saving.

## Roles and Access

### Desktop

- `admin`
  - full access
  - can create cycles, import/export, approve, override, generate bills
- `billing_staff`
  - can manage readings, encode manually, import mobile files, review and approve readings
- `cashier`
  - no reading entry
  - payment and receipt only

### Mobile

- `field_staff`
  - primary mobile user
  - can only work on assigned cycle data
  - can encode, edit their own unsent readings, add notes, attach photos, export
- `admin`
  - optional access for testing, supervision, troubleshooting
- `billing_staff`
  - optional access if desktop is unavailable in the field

Recommendation:

- Keep the real mobile production role set very small:
  - `field_staff`
  - `admin` for troubleshooting only

## Mobile App Information Architecture

Recommended top-level structure:

1. `Home`
2. `Assignments`
3. `Sync`
4. `Profile / Device`

### Home

Purpose:

- show current assigned cycle
- show total progress
- show today’s target or last resumed building/floor
- provide `Resume Entry`

Suggested content:

- active cycle card
- progress summary
- quick actions:
  - Resume
  - Buildings
  - Flagged
  - Export

### Assignments

Purpose:

- browse the work hierarchy cleanly

Suggested navigation:

- cycle
- building list
- floor list
- unit list

Each level should display progress.

### Sync

Purpose:

- import assignment
- export completed readings
- show sync history
- show export format options

Suggested actions:

- Import assignment file
- Export as JSON
- Export as CSV
- Export with photos as ZIP
- View last export details

### Profile / Device

Purpose:

- show current user
- show device name / app version
- logout
- clear local assignment only with confirmation

## Primary Mobile Reading Flow

Recommended default field flow:

1. Open app
2. Resume assigned cycle
3. Select building
4. Select floor
5. Enter sequential unit readings
6. Export completed data

The key change is this:
The mobile app should support **continuous sequential entry**, not just single-unit forms.

## Recommended Mobile Reading Screens

### 1. Login

Keep simple:

- username
- password or offline PIN

Long term:

- allow device-bound offline session after first successful login/import

### 2. Home / Cycle Dashboard

Show:

- cycle period
- total units
- completed / remaining
- flagged count
- last building / floor worked on

Primary CTA:

- `Resume Reading`

### 3. Building List

Show:

- building code
- building completion
- flagged count

### 4. Floor List

Show:

- floor number
- completed / remaining

### 5. Unit List

This should become the main field workspace.

Recommended layout:

- searchable list
- large readable unit labels
- previous reading visible
- status chip
- quick tap into entry

Recommended extra option:

- `Continuous Entry Mode`

This mode should let the user move unit to unit with minimal taps.

### 6. Reading Entry

Must be optimized for field speed.

Recommended content:

- unit number
- resident name
- meter number
- previous reading
- current reading input
- live consumption preview
- quick warning states
- note input
- optional photo

Primary actions:

- Save & Next
- Save & Flag
- Skip

This is the most important mobile improvement.

### 7. Flagged / Exceptions List

Purpose:

- review all unusual entries before export

Show:

- below previous
- abnormal spike
- missing photo if required
- missing note if required

### 8. Export Center

Show:

- unsent reading count
- flagged count
- export buttons by format
- last export timestamp

## Data Validation Rules

Validation should match desktop logic:

- current below previous -> flagged
- abnormal spike against average -> flagged
- zero consumption -> warning, not automatic failure
- missing reading -> pending

Optional future rules:

- require note for flagged readings
- require photo for flagged readings
- require export confirmation if pending rows remain

## Desktop Alignment

Desktop Readings should treat mobile imports as just one source.

Suggested desktop Readings structure:

- `Readings Workspace`
  - cycle lanes
  - manual entry
  - review & exceptions
  - mobile sync

Desktop import parser should accept:

- JSON manifest from mobile
- CSV flat export
- ZIP bundle

Each imported row should land in:

- source = `mobile`
- submitted_by
- read_at
- flag_reason if present

## UI Principles

### Mobile

- one-handed use
- large tap targets
- high-contrast progress states
- minimal text while working
- big numeric input
- keep context visible: building, floor, unit

### Desktop

- dense information for batch operations
- keyboard-first for manual entry
- review separated from entry
- sync as a secondary path

## Testing Strategy

Do not rely on emulator if the laptop is already struggling.

Recommended testing setup:

### For most UI and logic work

Use Flutter Windows:

```powershell
cd mobile
flutter run -d windows
```

This is enough for:

- layout
- navigation
- local database behavior
- import/export flows
- validation logic

### For real field behavior

Use a physical Android phone with USB debugging:

- no emulator required
- better for camera
- better for touch ergonomics
- better for actual field flow

Run:

```powershell
cd mobile
flutter devices
flutter run -d <your-phone-id>
```

### Only use emulator when necessary

Use it only for:

- Android-specific rendering bugs
- permission handling
- APK install checks

## Recommended Build Phases

### Phase 1: Mobile workflow correction

- redesign navigation
- add proper Home / Assignments / Sync structure
- align validation with desktop
- make export reliable

### Phase 2: Continuous entry mode

- Save & Next workflow
- sequential unit navigation
- strong progress visibility

### Phase 3: Multi-format export/import

- JSON export
- CSV export
- ZIP export with photos
- desktop import adapters

### Phase 4: Real field hardening

- offline session persistence
- device metadata
- export audit history
- crash recovery and partial export resume

## Immediate Recommendations

1. Keep `Mobile Sync` as a secondary tool in desktop, not the main Readings page.
2. Remove redundant top-level `Open Manual Entry` buttons if the cycle row already provides entry.
3. Redesign the mobile app around `Assignments -> Continuous Entry -> Export`.
4. Use `JSON` as canonical sync, then add `CSV` and `ZIP` as optional export formats.
5. Test mostly on Windows and on a real Android phone, not the emulator.
