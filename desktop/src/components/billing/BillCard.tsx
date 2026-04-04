import { FileText } from 'lucide-react';
import { billPeriod, cubicM, php } from '../../utils/formatters';
import { StatusBadge } from '../shared/StatusBadge';

interface BillCardProps {
  residentName: string;
  buildingCode: string;
  unitNumber: string;
  periodStart: string;
  periodEnd: string;
  consumptionCubicM: number;
  totalAmountDue: number;
  status: string;
  onOpen?: () => void;
}

export function BillCard({
  residentName,
  buildingCode,
  unitNumber,
  periodStart,
  periodEnd,
  consumptionCubicM,
  totalAmountDue,
  status,
  onOpen,
}: BillCardProps) {
  const content = (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{residentName}</p>
          <p className="font-mono text-xs text-gray-500">{buildingCode}-{unitNumber}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-3 text-xs text-gray-500">{billPeriod(periodStart, periodEnd)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-gray-500">Consumption</p>
          <p className="mt-1 font-semibold text-gray-900">{cubicM(consumptionCubicM)}</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-blue-700">Total Due</p>
          <p className="mt-1 font-semibold text-blue-900">{php(totalAmountDue)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
          <FileText size={13} />
          View bill
        </span>
      </div>
    </div>
  );

  if (!onOpen) {
    return content;
  }

  return (
    <button type="button" onClick={onOpen} className="w-full text-left">
      {content}
    </button>
  );
}
