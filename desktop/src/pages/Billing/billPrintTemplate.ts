export interface PrintableBill {
  id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  period_start: string;
  period_end: string;
  rate_per_cubicm: number;
  consumption_cubicm: number;
  water_charge: number;
  sys_loss_charge: number;
  common_sys_loss: number;
  reconnection_fee: number;
  previous_balance: number;
  total_for_month: number;
  total_amount_due: number;
  due_date: string | null;
  generated_at: string;
  disconnection_notice: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return value.toFixed(2);
}

function formatConsumption(value: number) {
  return `${value.toFixed(2)} cu.m`;
}

export function getBillPrintStyles() {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #ffffff; font-family: Arial, sans-serif; color: #000; }
    .bill-page {
      width: 21cm;
      min-height: 14cm;
      margin: 0 auto;
      padding: 0.9cm;
      page-break-after: always;
      font-size: 10pt;
    }
    .bill-page:last-child { page-break-after: auto; }
    .bill-header { margin-bottom: 6px; text-align: center; }
    .bill-header .org { font-size: 11pt; font-weight: bold; }
    .bill-header .line { font-size: 10pt; }
    .bill-date { margin-bottom: 4px; display: flex; justify-content: flex-end; font-size: 9pt; }
    .bill-title { margin-bottom: 8px; text-align: center; font-size: 10pt; font-weight: bold; }
    .bill-grid { display: flex; gap: 20px; }
    .bill-left { flex: 0 0 42%; }
    .bill-right { flex: 1; }
    .label-row, .amount-row { display: flex; justify-content: space-between; gap: 8px; font-size: 9pt; margin-bottom: 2px; }
    .name-row { display: flex; gap: 6px; font-size: 9pt; margin-bottom: 4px; }
    .name-value { flex: 1; border-bottom: 1px solid #000; padding-bottom: 1px; }
    .unit-value { width: 60px; border-bottom: 1px solid #000; padding-bottom: 1px; }
    .section-rule { margin: 4px 0; border: none; border-top: 1px solid #000; }
    .double-rule { margin: 4px 0; border: none; border-top: 2px solid #000; }
    .amount-underline { border-bottom: 1px solid #000; padding-right: 4px; }
    .total-double { border-bottom: 3px double #000; padding-right: 4px; }
    .small-note { font-size: 8.5pt; }
    .italic { font-style: italic; }
    .notice { border-top: 1px solid #000; margin-top: 6px; padding-top: 4px; font-size: 8.5pt; }
    .table { width: 60%; border-collapse: collapse; font-size: 9pt; }
    .table td:last-child {
      border-bottom: 1px solid #000;
      padding-right: 4px;
      text-align: right;
      font-weight: bold;
    }
    .metric-list { margin-bottom: 8px; }
    .metric-title { margin-bottom: 3px; font-size: 9pt; font-weight: bold; }
    .metric-total {
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #000;
      padding-bottom: 2px;
      font-size: 9pt;
      font-weight: bold;
    }
    @media print {
      body { margin: 0; }
      .bill-page { width: 100%; padding: 0.8cm; }
    }
  `;
}

function renderBillPage(bill: PrintableBill) {
  return `
    <div class="bill-page">
      <div class="bill-header">
        <div class="org">NATIONAL HOUSING AUTHORITY</div>
        <div class="line">Caloocan District Office</div>
        <div class="line">Camarin Residences 3 - ${escapeHtml(bill.building_code)}</div>
      </div>

      <div class="bill-date">Date <strong>${escapeHtml(formatDate(bill.generated_at))}</strong></div>

      <div class="bill-title">
        STATEMENT OF ACCOUNT<br />
        <span style="font-size: 9pt; font-weight: normal;">
          ${escapeHtml(formatDate(bill.period_start))} - ${escapeHtml(formatDate(bill.period_end))}
        </span><br />
        WATER METER READING
      </div>

      <hr class="section-rule" />

      <div class="bill-grid">
        <div class="bill-left">
          <div class="name-row">
            <strong>Name</strong>
            <span class="name-value">${escapeHtml(bill.resident_name)}</span>
          </div>
          <div class="name-row" style="margin-bottom: 10px;">
            <strong>Unit</strong>
            <span class="unit-value">${escapeHtml(bill.unit_number)}</span>
          </div>

          <div class="amount-row"><span>Total Consumption</span><span>${escapeHtml(formatConsumption(bill.consumption_cubicm))}</span></div>
          <div class="amount-row"><span>Price/Cu. M.</span><span>P ${formatCurrency(bill.rate_per_cubicm)}</span></div>
          <div class="amount-row" style="margin-bottom: 4px;">
            <span>Water Bill for the Month</span>
            <span class="amount-underline"><strong>P ${formatCurrency(bill.water_charge)}</strong></span>
          </div>

          <div class="small-note" style="margin-bottom: 2px;">Add:</div>
          <div class="amount-row"><span>Building System Loss Charge</span><span class="amount-underline">${formatCurrency(bill.sys_loss_charge)}</span></div>
          <div class="amount-row"><span>Common Systems Loss Charge</span><span class="amount-underline">${formatCurrency(bill.common_sys_loss)}</span></div>
          <div class="amount-row"><span>Reconnection Fee</span><span class="amount-underline">${formatCurrency(bill.reconnection_fee)}</span></div>

          <hr class="section-rule" />

          <div class="amount-row"><strong>Total Due for the Month</strong><span class="amount-underline"><strong>P ${formatCurrency(bill.total_for_month)}</strong></span></div>
          <div class="amount-row" style="margin-bottom: 6px;"><span>Add Previous Balance</span><span>${formatCurrency(bill.previous_balance)}</span></div>

          <hr class="double-rule" />
          <div class="amount-row" style="font-size: 10pt; font-weight: bold; margin-bottom: 10px;">
            <span>TOTAL AMOUNT DUE</span>
            <span class="total-double">P ${formatCurrency(bill.total_amount_due)}</span>
          </div>

          <div class="small-note" style="margin-bottom: 6px;"><strong>DUE DATE:</strong> ${escapeHtml(formatDate(bill.due_date))}</div>

          <div class="small-note" style="margin-bottom: 4px;">Please pay your bill to:</div>
          <div class="small-note" style="font-weight: bold;">CRISTINA ALACEDA &amp;</div>
          <div class="small-note" style="font-weight: bold; margin-bottom: 2px;">LORENA SEVILLA</div>
          <div class="small-note">@ Camres 1 Livelihood Center</div>
          <div class="small-note" style="margin-bottom: 8px;">every Tues, Thurs. &amp; Fri. 9:30 AM - 12:00 PM</div>

          <div class="notice italic">
            <strong>Notice of Disconnection:</strong><br />
            ${escapeHtml(bill.disconnection_notice)}
          </div>
        </div>

        <div class="bill-right">
          <div class="metric-list">
            <div class="metric-title">Computation of Systems Loss @ ${escapeHtml(bill.building_code)}:</div>
            <div class="amount-row"><span>${escapeHtml(bill.building_code)} Sub-meter Present Reading (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Less: ${escapeHtml(bill.building_code)} Sub-meter Previous Reading (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Total Consumption of ${escapeHtml(bill.building_code)} (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Less: Total Consumption based on Individual Meter Reading (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Total System Loss of ${escapeHtml(bill.building_code)} (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Multiply by Rate per Cubic Meter in PhP</span><span>${formatCurrency(bill.rate_per_cubicm)}</span></div>
            <div class="amount-row"><span>Total System Loss of ${escapeHtml(bill.building_code)} in PhP</span><span>-</span></div>
            <div class="amount-row"><span>Divided by: No. of Units at ${escapeHtml(bill.building_code)}</span><span>-</span></div>
            <div class="metric-total"><span>Systems Loss per Unit at ${escapeHtml(bill.building_code)} in PhP</span><span>${formatCurrency(bill.sys_loss_charge)}</span></div>
          </div>

          <div class="metric-list">
            <div class="metric-title">Computation of Common Systems Loss at CamRes 3:</div>
            <div class="amount-row"><span>Total Consumption based on Maynilad Bill (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Less: Total Consumption from Submeters of buildings (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Common Systems Loss @ CamRes 3 (cu.m.)</span><span>-</span></div>
            <div class="amount-row"><span>Multiply by Rate per Cubic Meter (PhP)</span><span>${formatCurrency(bill.rate_per_cubicm)}</span></div>
            <div class="amount-row"><span>Total Common System Loss @ CamRes 3 (PhP)</span><span>-</span></div>
            <div class="amount-row"><span>Divided by: No. of Units at CamRes 3</span><span>-</span></div>
            <div class="metric-total"><span>Common System Loss Per Unit @ CamRes 3 (PhP)</span><span>${formatCurrency(bill.common_sys_loss)}</span></div>
          </div>

          <div class="metric-title">Individual Reading</div>
          <table class="table">
            <tbody>
              <tr><td>Present Reading</td><td>-</td></tr>
              <tr><td>Previous Reading</td><td>-</td></tr>
              <tr><td>Total Consumption</td><td>${escapeHtml(formatConsumption(bill.consumption_cubicm))}</td></tr>
            </tbody>
          </table>

          <div class="small-note italic" style="margin-top: 10px; text-align: center;">
            For bill correction, ask assistance from the billing office or your building representative.
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderBillPrintHtml(bills: PrintableBill[]) {
  return bills.map(renderBillPage).join('');
}
