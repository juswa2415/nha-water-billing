import clsx from 'clsx';
import { Printer } from 'lucide-react';

interface PrintPreviewProps {
  title: string;
  subtitle?: string;
  onPrint?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PrintPreview({
  title,
  subtitle,
  onPrint,
  actions,
  children,
  className,
}: PrintPreviewProps) {
  return (
    <div className={clsx('space-y-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Printer size={14} />
              Print
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {children}
      </div>
    </div>
  );
}
