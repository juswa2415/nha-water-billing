// src/components/shared/StatusBadge.tsx
import clsx from 'clsx';

type Status =
  | 'active' | 'vacant' | 'inactive' | 'disconnected'
  | 'pending' | 'submitted' | 'flagged' | 'approved' | 'skipped'
  | 'draft' | 'finalized' | 'locked' | 'adjusted'
  | 'reading_phase' | 'review_phase' | 'billing'
  | 'paid' | 'unpaid' | 'overdue' | 'partial';

const STATUS_STYLES: Record<string, string> = {
  // Unit statuses
  active:       'bg-green-50 text-green-700 border-green-200',
  vacant:       'bg-gray-50 text-gray-500 border-gray-200',
  inactive:     'bg-yellow-50 text-yellow-700 border-yellow-200',
  disconnected: 'bg-red-50 text-red-600 border-red-200',
  // Reading statuses
  pending:      'bg-gray-50 text-gray-500 border-gray-200',
  submitted:    'bg-blue-50 text-blue-700 border-blue-200',
  flagged:      'bg-orange-50 text-orange-700 border-orange-200',
  approved:     'bg-green-50 text-green-700 border-green-200',
  skipped:      'bg-gray-50 text-gray-400 border-gray-200',
  // Bill / cycle statuses
  draft:         'bg-gray-50 text-gray-500 border-gray-200',
  reading_phase: 'bg-blue-50 text-blue-700 border-blue-200',
  review_phase:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  billing:       'bg-purple-50 text-purple-700 border-purple-200',
  finalized:     'bg-green-50 text-green-700 border-green-200',
  locked:        'bg-gray-100 text-gray-600 border-gray-300',
  adjusted:      'bg-orange-50 text-orange-600 border-orange-200',
  // Payment
  paid:    'bg-green-50 text-green-700 border-green-200',
  unpaid:  'bg-red-50 text-red-600 border-red-200',
  partial: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  overdue: 'bg-red-100 text-red-700 border-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  reading_phase: 'Reading',
  review_phase:  'Review',
};

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  label?: string;
}

export function StatusBadge({ status, size = 'sm', label }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-50 text-gray-500 border-gray-200';
  const displayLabel = label ?? STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
  return (
    <span className={clsx(
      'inline-flex items-center border rounded-full font-medium capitalize',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
      style
    )}>
      {displayLabel}
    </span>
  );
}
