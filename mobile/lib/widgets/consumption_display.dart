import 'package:flutter/material.dart';

class ConsumptionDisplay extends StatelessWidget {
  final double? consumption;
  final bool hasError;

  const ConsumptionDisplay({
    super.key,
    required this.consumption,
    this.hasError = false,
  });

  @override
  Widget build(BuildContext context) {
    if (consumption == null || hasError) {
      return const SizedBox.shrink();
    }

    final value = consumption!;
    final background = value == 0
        ? Colors.grey.shade50
        : value < 0
            ? Colors.red.shade50
            : Colors.blue.shade50;
    final border = value < 0 ? Colors.red.shade200 : Colors.blue.shade200;
    final color = value == 0
        ? Colors.grey.shade600
        : value < 0
            ? Colors.red.shade700
            : Colors.blue.shade800;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            'Consumption',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: Colors.grey.shade700,
            ),
          ),
          Text(
            '${value.toStringAsFixed(2)} cu.m',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
