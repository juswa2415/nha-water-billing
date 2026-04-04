import { Receipt, RotateCcw } from 'lucide-react';
import { formatDate, php } from '../../utils/formatters';
import { StatusBadge } from '../shared/StatusBadge';

interface ReceiptCardProps {
  receiptNumber: string;
  residentName: string;
  buildingCode: string;
  unitNumber: string;
  paymentDate: string;
  amountPaid: number;
  remainingBalance: number;
  isVoid?: boolean;
  onOpen?: () => void;
}

export function ReceiptCard({
  receiptNumber,
  residentName,
  buildingCode,
  unitNumber,
  paymentDate,
  amountPaid,
  remainingBalance,
  isVoid = false,
  onOpen,
}: ReceiptCardProps) {
  const status = isVoid ? 'adjusted' : remainingBalance > 0 ? 'partial' : 'paid';
  const content = (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-green-300 hover:shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-gray-900">#{receiptNumber}</p>
          <p className="mt-1 text-xs text-gray-500">{formatDate(paymentDate)}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-gray-900">{residentName}</p>
        <p className="font-mono text-xs text-gray-500">{buildingCode}-{unitNumber}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-green-50 p-3">
          <p className="text-green-700">Paid</p>
          <p className="mt-1 font-semibold text-green-900">{php(amountPaid)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-gray-500">Balance</p>
          <p className="mt-1 font-semibold text-gray-900">{php(remainingBalance)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
          {isVoid ? <RotateCcw size={13} /> : <Receipt size={13} />}
          Open receipt
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
