import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronDown, CreditCard, Search } from 'lucide-react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PaginationBar } from '../../components/shared/PaginationBar';
import { formatDate, php } from '../../utils/formatters';

interface UnpaidRow {
  bill_id: number;
  unit_number: string;
  building_code: string;
  resident_name: string;
  account_number: string;
  total_amount_due: number;
  outstanding_balance: number;
  due_date: string | null;
}

interface CycleOption {
  id: number;
  period_start: string;
  period_end: string;
}

export function UnpaidAccounts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const isPaymentQueue = pathname.startsWith('/payments/queue');
  const routeState = (location.state as {
    prefillQuery?: string;
    preselectCycleId?: number;
  } | null) ?? null;
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    let cancelled = false;
    invoke<CycleOption[]>('list_billing_cycles')
      .then(rows => {
        if (cancelled) return;
        setCycles(rows);
        if (rows.length) {
          const preferredCycleId =
            routeState?.preselectCycleId && rows.some(row => row.id === routeState.preselectCycleId)
              ? routeState.preselectCycleId
              : rows[0].id;
          setCycleId(preferredCycleId);
        }
        if (routeState?.prefillQuery) {
          setQuery(routeState.prefillQuery);
        }
        setPage(1);
      })
      .catch(error => {
        if (!cancelled) {
          toast.error(String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeState?.prefillQuery, routeState?.preselectCycleId]);

  useEffect(() => {
    if (!cycleId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPage(1);
    invoke<UnpaidRow[]>('unpaid_accounts', { cycleId })
      .then(rows => {
        if (!cancelled) {
          setData(rows);
        }
      })
      .catch(error => {
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

  const filteredData = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return data;
    }

    return data.filter(row =>
      `${row.building_code}-${row.unit_number}`.toLowerCase().includes(needle) ||
      row.resident_name.toLowerCase().includes(needle) ||
      row.account_number.toLowerCase().includes(needle),
    );
  }, [data, query]);

  const pagedData = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, page, pageSize]);

  const totalOutstanding = filteredData.reduce((sum, row) => sum + row.outstanding_balance, 0);

  const columns: Column<UnpaidRow>[] = [
    {
      key: 'unit',
      header: 'Unit',
      width: '120px',
      render: row => (
        <span className="font-mono text-xs font-medium text-gray-800">
          {row.building_code}-{row.unit_number}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Resident',
      render: row => <span className="text-xs text-gray-700">{row.resident_name}</span>,
    },
    {
      key: 'account',
      header: 'Account',
      width: '120px',
      render: row => <span className="font-mono text-xs text-gray-500">{row.account_number}</span>,
    },
    {
      key: 'due',
      header: 'Total Due',
      width: '110px',
      render: row => <span className="text-xs text-gray-600">{php(row.total_amount_due)}</span>,
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      width: '120px',
      render: row => (
        <span className="text-sm font-semibold text-red-600">
          {php(row.outstanding_balance)}
        </span>
      ),
    },
    {
      key: 'duedate',
      header: 'Due Date',
      width: '100px',
      render: row =>
        row.due_date ? (
          <span
            className={`text-xs ${
              new Date(row.due_date) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'
            }`}
          >
            {formatDate(row.due_date)}
          </span>
        ) : (
          <span className="text-gray-300">-</span>
        ),
    },
    {
      key: 'action',
      header: '',
      width: '90px',
      render: row => (
        <button
          onClick={event => {
            event.stopPropagation();
            navigate(`/payments/new/${row.bill_id}`);
          }}
          className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-800"
        >
          <CreditCard size={12} />
          Pay
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">
          {isPaymentQueue ? 'Cashier payment queue' : 'Unpaid accounts'}
        </p>
        <p className="mt-2 text-sm text-blue-900">
          {isPaymentQueue
            ? 'Cashiers should start here. Search the account, open the bill, then post the payment.'
            : 'This report shows unpaid and partially paid bills for the selected billing cycle.'}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="relative">
          <select
            value={cycleId ?? ''}
            onChange={event => setCycleId(Number(event.target.value))}
            className="appearance-none text-sm border border-gray-300 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {cycles.map(cycle => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.period_start} - {cycle.period_end}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search unit, resident, or account"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {filteredData.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-700">
            {filteredData.length} accounts in view
          </span>
          <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">
            Outstanding {php(totalOutstanding)}
          </span>
        </div>
      )}

      <DataTable
        columns={columns}
        data={pagedData}
        rowKey={row => row.bill_id}
        onRowClick={row => navigate(`/payments/new/${row.bill_id}`)}
        loading={loading}
        emptyMessage="All accounts are paid for this cycle."
      />

      {!loading && filteredData.length > 0 && (
        <PaginationBar
          currentPage={page}
          pageSize={pageSize}
          totalItems={filteredData.length}
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
