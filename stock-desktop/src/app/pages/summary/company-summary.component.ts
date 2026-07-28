import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SupabaseService } from '../../core/supabase.service';
import type {
  CompanyMemberRole,
  CompanyMonthlyFinancialRow,
  CompanyProductMonthlySalesRow,
  CompanyYearlyFinancialRow,
} from '../../models/stock.types';

type PeriodTotals = {
  salesRevenue: number;
  purchaseSpend: number;
  grossProfit: number;
  netBalance: number;
};

type TopProduct = {
  productName: string;
  unitsSold: number;
  salesRevenue: number;
  grossProfit: number;
};

type TimezoneOption = {
  value: string;
  label: string;
};

@Component({
  selector: 'app-company-summary',
  imports: [RouterLink],
  templateUrl: './company-summary.component.html',
  styleUrl: './company-summary.component.scss',
})
export class CompanySummaryComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly route = inject(ActivatedRoute);

  readonly companyId = signal<string | null>(null);
  readonly companyName = signal<string | null>(null);
  readonly myRole = signal<CompanyMemberRole | null>(null);
  readonly dayStr = signal(this.isoToday());
  readonly reportingTimezone = signal('UTC');
  readonly loading = signal(true);
  readonly loadingSummary = signal(false);
  readonly savingTimezone = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly timezoneOptions: TimezoneOption[] = [
    { value: 'UTC', label: 'UTC (universal)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
    { value: 'America/Santiago', label: 'Chile (Santiago)' },
    { value: 'America/La_Paz', label: 'Bolivia (La Paz)' },
    { value: 'America/Lima', label: 'Perú (Lima)' },
    { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
    { value: 'America/Caracas', label: 'Venezuela (Caracas)' },
    { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
    { value: 'America/New_York', label: 'EEUU Este (New York)' },
    { value: 'America/Los_Angeles', label: 'EEUU Pacífico (Los Angeles)' },
    { value: 'Europe/Madrid', label: 'España (Madrid)' },
  ];

  readonly monthCurrent = signal<PeriodTotals>(this.emptyTotals());
  readonly monthPrevious = signal<PeriodTotals>(this.emptyTotals());
  readonly yearCurrent = signal<PeriodTotals>(this.emptyTotals());
  readonly yearPrevious = signal<PeriodTotals>(this.emptyTotals());
  readonly topProductsMonth = signal<TopProduct[]>([]);

  readonly monthDeltaRevenuePct = computed(() =>
    this.safeDeltaPct(this.monthCurrent().salesRevenue, this.monthPrevious().salesRevenue),
  );
  readonly monthDeltaNetPct = computed(() =>
    this.safeDeltaPct(this.monthCurrent().netBalance, this.monthPrevious().netBalance),
  );
  readonly yearDeltaRevenuePct = computed(() =>
    this.safeDeltaPct(this.yearCurrent().salesRevenue, this.yearPrevious().salesRevenue),
  );
  readonly yearDeltaNetPct = computed(() =>
    this.safeDeltaPct(this.yearCurrent().netBalance, this.yearPrevious().netBalance),
  );

  get canEditCompanySettings(): boolean {
    return this.access.canEditCompanySettings(this.myRole());
  }

  roleLabel(): string {
    return this.access.roleLabel(this.myRole());
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('companyId');
    this.companyId.set(id);
    if (!id) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no válida.');
      return;
    }
    await this.loadCompany(id);
    if (this.errorMessage()) {
      return;
    }
    await this.loadSummary(id);
  }

  private isoToday(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private emptyTotals(): PeriodTotals {
    return { salesRevenue: 0, purchaseSpend: 0, grossProfit: 0, netBalance: 0 };
  }

  private rowToTotals(row: { sales_revenue: number | string | null; purchase_spend: number | string | null; gross_profit: number | string | null } | null): PeriodTotals {
    const salesRevenue = row?.sales_revenue == null ? 0 : Number(row.sales_revenue);
    const purchaseSpend = row?.purchase_spend == null ? 0 : Number(row.purchase_spend);
    const grossProfit = row?.gross_profit == null ? 0 : Number(row.gross_profit);
    const safeSales = Number.isFinite(salesRevenue) ? salesRevenue : 0;
    const safeSpend = Number.isFinite(purchaseSpend) ? purchaseSpend : 0;
    const safeGross = Number.isFinite(grossProfit) ? grossProfit : 0;
    return {
      salesRevenue: safeSales,
      purchaseSpend: safeSpend,
      grossProfit: safeGross,
      netBalance: safeSales - safeSpend,
    };
  }

  private safeDeltaPct(current: number, previous: number): number | null {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return null;
    }
    if (Math.abs(previous) < 1e-9) {
      return current === 0 ? 0 : null;
    }
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  formatMoney(value: number): string {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatQty(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toLocaleString('es-AR', { maximumFractionDigits: 4 });
  }

  formatDeltaPct(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'n/a';
    }
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  monthLabel(): string {
    const [y, m] = this.dayStr().split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }

  previousMonthLabel(): string {
    const [y, m] = this.dayStr().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }

  yearLabel(): string {
    return this.dayStr().slice(0, 4);
  }

  previousYearLabel(): string {
    const y = Number(this.dayStr().slice(0, 4));
    return String(y - 1);
  }

  async onDayChange(ev: Event): Promise<void> {
    const v = (ev.target as HTMLInputElement).value;
    if (!v) {
      return;
    }
    this.dayStr.set(v);
    const cid = this.companyId();
    if (cid) {
      await this.loadSummary(cid);
    }
  }

  async saveTimezone(rawTz: string): Promise<void> {
    const cid = this.companyId();
    if (!cid) {
      return;
    }
    if (!this.canEditCompanySettings) {
      this.errorMessage.set('Solo owner o admin pueden cambiar la zona horaria.');
      return;
    }
    const tz = rawTz.trim();
    if (!tz) {
      this.errorMessage.set('La zona horaria no puede quedar vacía.');
      return;
    }
    this.errorMessage.set(null);
    this.savingTimezone.set(true);
    const { error } = await this.supabase.client
      .from('companies')
      .update({ reporting_timezone: tz })
      .eq('id', cid);
    this.savingTimezone.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    this.reportingTimezone.set(tz);
    await this.loadSummary(cid);
  }

  timezoneOptionsForSelect(): TimezoneOption[] {
    const current = this.reportingTimezone();
    if (!current) {
      return this.timezoneOptions;
    }
    const exists = this.timezoneOptions.some((z) => z.value === current);
    if (exists) {
      return this.timezoneOptions;
    }
    return [{ value: current, label: `${current} (actual)` }, ...this.timezoneOptions];
  }

  private async loadCompany(companyId: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const [companyRes, role] = await Promise.all([
      this.supabase.client
        .from('companies')
        .select('name, reporting_timezone')
        .eq('id', companyId)
        .maybeSingle(),
      this.access.getMyRole(companyId),
    ]);
    this.loading.set(false);
    this.myRole.set(role);
    if (companyRes.error) {
      this.errorMessage.set(companyRes.error.message);
      return;
    }
    if (!companyRes.data) {
      this.errorMessage.set('No encontramos esa empresa o no tenés acceso.');
      return;
    }
    this.companyName.set(String(companyRes.data.name));
    const tz = companyRes.data.reporting_timezone == null ? 'UTC' : String(companyRes.data.reporting_timezone);
    this.reportingTimezone.set(tz || 'UTC');
  }

  private async loadSummary(companyId: string): Promise<void> {
    this.loadingSummary.set(true);
    this.errorMessage.set(null);
    const [y, m] = this.dayStr().split('-').map(Number);
    const prevMonth = new Date(y, m - 2, 1);
    const prevYear = y - 1;

    const [monthCurrentRes, monthPreviousRes, yearCurrentRes, yearPreviousRes, topProductsRes] = await Promise.all([
      this.supabase.client
        .from('company_monthly_financials')
        .select('company_id, report_year, report_month, sales_revenue, purchase_spend, gross_profit')
        .eq('company_id', companyId)
        .eq('report_year', y)
        .eq('report_month', m)
        .maybeSingle(),
      this.supabase.client
        .from('company_monthly_financials')
        .select('company_id, report_year, report_month, sales_revenue, purchase_spend, gross_profit')
        .eq('company_id', companyId)
        .eq('report_year', prevMonth.getFullYear())
        .eq('report_month', prevMonth.getMonth() + 1)
        .maybeSingle(),
      this.supabase.client
        .from('company_yearly_financials')
        .select('company_id, report_year, sales_revenue, purchase_spend, gross_profit')
        .eq('company_id', companyId)
        .eq('report_year', y)
        .maybeSingle(),
      this.supabase.client
        .from('company_yearly_financials')
        .select('company_id, report_year, sales_revenue, purchase_spend, gross_profit')
        .eq('company_id', companyId)
        .eq('report_year', prevYear)
        .maybeSingle(),
      this.supabase.client
        .from('company_product_monthly_sales')
        .select('company_id, report_year, report_month, product_id, product_name, units_sold, sales_revenue, gross_profit')
        .eq('company_id', companyId)
        .eq('report_year', y)
        .eq('report_month', m)
        .order('sales_revenue', { ascending: false })
        .limit(7),
    ]);

    this.loadingSummary.set(false);
    const err =
      monthCurrentRes.error ??
      monthPreviousRes.error ??
      yearCurrentRes.error ??
      yearPreviousRes.error ??
      topProductsRes.error;
    if (err) {
      this.errorMessage.set(err.message);
      return;
    }

    this.monthCurrent.set(this.rowToTotals((monthCurrentRes.data as CompanyMonthlyFinancialRow | null) ?? null));
    this.monthPrevious.set(this.rowToTotals((monthPreviousRes.data as CompanyMonthlyFinancialRow | null) ?? null));
    this.yearCurrent.set(this.rowToTotals((yearCurrentRes.data as CompanyYearlyFinancialRow | null) ?? null));
    this.yearPrevious.set(this.rowToTotals((yearPreviousRes.data as CompanyYearlyFinancialRow | null) ?? null));

    const topRows = (topProductsRes.data ?? []) as CompanyProductMonthlySalesRow[];
    this.topProductsMonth.set(
      topRows.map((r) => ({
        productName: r.product_name,
        unitsSold: Number(r.units_sold),
        salesRevenue: Number(r.sales_revenue),
        grossProfit: Number(r.gross_profit),
      })),
    );
  }
}
