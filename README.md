# NHA Water Billing

NHA Water Billing is a two-part water billing workflow for Camarin Residences:

- a desktop admin and billing app built with Tauri, Rust, React, and TypeScript
- a mobile field app built with Flutter for offline meter reading

## Workspace Layout

- `desktop/` - desktop billing, reporting, collections, and cycle management
- `mobile/` - mobile meter-reading client
- `sample-data/` - demo CSV, JSON, SQL, and helper scripts for test data

## Desktop App

Development:

```powershell
cd desktop
npm install
npm run tauri dev
```

Production build:

```powershell
cd desktop
npm run tauri build
```

## Mobile App

Development on Windows:

```powershell
cd mobile
flutter pub get
flutter run -d windows
```

Android:

```powershell
cd mobile
flutter pub get
flutter run -d android
```

## Demo Data

Sample import files and generated test data are stored in `sample-data/`. These files are intended to help seed buildings, units, billing cycles, and mobile reading imports during development and testing.

## Notes

- This repository tracks source code and reusable sample files.
- Local build outputs, dependency folders, and machine-specific configuration files are ignored at the repository root.
