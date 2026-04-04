import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class ReadingInputWidget extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode? focusNode;
  final String? errorText;
  final ValueChanged<String> onChanged;
  final bool autofocus;

  const ReadingInputWidget({
    super.key,
    required this.controller,
    required this.onChanged,
    this.focusNode,
    this.errorText,
    this.autofocus = false,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      autofocus: autofocus,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*'))],
      style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
      decoration: InputDecoration(
        hintText: '0.00',
        suffixText: 'cu.m',
        errorText: errorText,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF1D4ED8), width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.red),
        ),
      ),
      onChanged: onChanged,
    );
  }
}
