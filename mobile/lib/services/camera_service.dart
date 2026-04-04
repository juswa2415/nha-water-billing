// lib/services/camera_service.dart

import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

class CameraService {
  static final CameraService instance = CameraService._();
  CameraService._();

  final _picker = ImagePicker();

  /// Captures a photo from the camera and saves it permanently to the
  /// app's documents directory (survives app restarts).
  /// Returns the saved file path, or null if cancelled.
  Future<String?> captureAndSave({
    int unitId = 0,
    int cycleId = 0,
  }) async {
    final image = await _picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 70,
      maxWidth: 1280,
      preferredCameraDevice: CameraDevice.rear,
    );

    if (image == null) return null;

    // Persist to app documents (not temp — needs to survive until synced)
    final docsDir = await getApplicationDocumentsDirectory();
    final photosDir = Directory(p.join(docsDir.path, 'meter_photos'));
    if (!await photosDir.exists()) await photosDir.create(recursive: true);

    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final dest = p.join(photosDir.path, 'unit${unitId}_cycle${cycleId}_$timestamp.jpg');
    await File(image.path).copy(dest);

    return dest;
  }

  /// Pick from gallery (for re-upload scenarios)
  Future<String?> pickFromGallery() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 70,
      maxWidth: 1280,
    );
    if (image == null) return null;

    final docsDir = await getApplicationDocumentsDirectory();
    final photosDir = Directory(p.join(docsDir.path, 'meter_photos'));
    if (!await photosDir.exists()) await photosDir.create(recursive: true);

    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final dest = p.join(photosDir.path, 'gallery_$timestamp.jpg');
    await File(image.path).copy(dest);

    return dest;
  }

  /// Delete a stored photo (after confirmed sync)
  Future<void> deletePhoto(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  /// Returns total size of all stored meter photos in bytes
  Future<int> storageUsedBytes() async {
    final docsDir = await getApplicationDocumentsDirectory();
    final photosDir = Directory(p.join(docsDir.path, 'meter_photos'));
    if (!await photosDir.exists()) return 0;

    int total = 0;
    await for (final entity in photosDir.list()) {
      if (entity is File) total += await entity.length();
    }
    return total;
  }
}