import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronDown, Receipt } from 'lucide-react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PaginationBar } from '../../components/shared/PaginationBar';
import { formatDate, php } from '../../utils/formatters';

interface CollRow {
  payment_id: number;
  payment_date: string;
  receipt_number: string;
  unit_number: string;
  building_code: string;
  resident_name: string;
  amount_paid: number;
  received_by: string;
  payment_method: string;
}

interface CycleOption {
  id: number;
  period_start: string;
  period_end: string;
}

export function CollectionReport() {
  const navigate = useNavigate();
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<CollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    let cancelled = false;
    invoke<CycleOption[]>('list_billing_cycles')
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setCycles(rows);
        if (rows.length > 0) {
          setCycleId(rows[0].id);
        }
        setPage(1);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cycleId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPage(1);
    invoke<CollRow[]>('collection_summary', { cycleId })
      .then((rows) => {
        if (!cancelled) {
          setData(rows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setData([]);
          toast.error(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  const total = data.reduce((sum, row) => sum + row.amount_paid, 0);
  const pagedData = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return data.slice(startIndex, startIndex + pageSize);
  }, [data, page, pageSize]);

  const columns: Column<CollRow>[] = [
    {
      key: 'date',
      header: 'Date',
      width: '100px',
      render: (row) => <span className="text-xs">{formatDate(row.payment_date)}</span>,
    },
    {
      key: 'payment',
      header: 'Payment ID',
      width: '95px',
      render: (row) => <span className="font-mono text-xs text-gray-700">{row.payment_id}</span>,
    },
    {
      key: 'receipt',
      header: 'Receipt #',
      width: '140px',
      render: (row) => (
        <button
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/payments/receipt/${row.payment_id}`);
          }}
          className="flex items-center gap-1 font-mono text-xs text-blue-700 hover:text-blue-900"
        >
          <Receipt size={12} />
          {row.receipt_number}
        </button>
      ),
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '100px',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.building_code}-{row.unit_number}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Resident',
      render: (row) => <span className="text-xs">{row.resident_name}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '100px',
      render: (row) => (
        <span className="text-xs font-medium text-green-700">{php(row.amount_paid)}</span>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      width: '90px',
      render: (row) => (
        <span className="text-xs capitalize text-gray-500">{row.payment_method}</span>
      ),
    },
    {
      key: 'by',
      header: 'Received by',
      render: (row) => <span className="text-xs text-gray-500">{row.received_by}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={16} className="text-gray-500" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Collection Report</h2>
          <p className="text-sm text-gray-500">
            Receipt-level list of posted collections for the selected cycle.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">Receipt log</p>
        <p className="mt-2 text-sm text-blue-900">
          This report is the running list of posted payments. Open any row to go back to
          the stored receipt with its payment ID and receipt number.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={cycleId ?? ''}
            onChange={(event) => setCycleId(Number(event.target.value))}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.period_start} - {cycle.period_end}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>

        {data.length > 0 && (
          <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-800">
            Total collected: {php(total)} from {data.length} payments
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={pagedData}
        rowKey={(row) => row.payment_id}
        onRowClick={(row) => navigate(`/payments/receipt/${row.payment_id}`)}
        loading={loading}
        emptyMessage="No payments recorded for this cycle."
      />

      {!loading && data.length > 0 && (
        <PaginationBar
          currentPage={page}
          pageSize={pageSize}
          totalItems={data.length}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
