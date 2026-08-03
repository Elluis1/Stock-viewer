import { DatePipe } from '@angular/common';
import { Component, DestroyRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, InventorySnapshotRow, MovementListRow } from '../../models/stock.types';
import { parseNonNegativeNumber, parsePositiveNumber } from '../../shared/form-numbers';

type PeriodMode = 'day' | '7d' | '30d';
type TypeFilter = 'all' | 'sale' | 'purchase';
type ActiveModal = 'sale' | 'purchase';

type LedgerGroup = {
  key: string;
  label: string;
  rows: MovementListRow[];
};

type PurchaseLine = {
  key: string;
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
};

@Component({
  selector: 'app-company-moves',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  templateUrl: './company-moves.component.html',
  styleUrl: './company-moves.component.scss',
})
export class CompanyMovesComponent implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly companyId = signal<string | null>(null);
  readonly companyName = signal<string | null>(null);
  readonly myRole = signal<CompanyMemberRole | null>(null);
  readonly inventory = signal<InventorySnapshotRow[]>([]);
  readonly movements = signal<MovementListRow[]>([]);
  readonly dayStr = signal(this.isoToday());
  readonly periodMode = signal<PeriodMode>('day');
  readonly typeFilter = signal<TypeFilter>('all');
  readonly searchQuery = signal('');
  readonly productIdFilter = signal<string | null>(null);
  readonly loading = signal(true);
  readonly loadingMoves = signal(false);
  readonly savingSale = signal(false);
  readonly savingPurchase = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly activeModal = signal<ActiveModal | null>(null);
  readonly saleStockAvailable = signal(0);
  readonly productPickerQuery = signal('');
  readonly productPickerOpen = signal(false);
  /** Producto elegido en el modal (signal: el FormControl solo no refresca la vista). */
  readonly modalProductId = signal<string | null>(null);
  readonly purchaseLines = signal<PurchaseLine[]>([]);
  readonly purchaseDraftQty = signal('1');
  readonly purchaseDraftCost = signal('');
  readonly purchaseNote = signal('');

  readonly purchaseLinesTotal = computed(() =>
    this.purchaseLines().reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
  );

  readonly filteredMovements = computed(() => {
    const type = this.typeFilter();
    const q = this.searchQuery().trim().toLowerCase();
    const productId = this.productIdFilter();
    return this.movements().filter((m) => {
      if (type !== 'all' && m.movement_type !== type) {
        return false;
      }
      if (productId && m.product_id !== productId) {
        return false;
      }
      if (q) {
        const name = this.productName(m).toLowerCase();
        if (!name.includes(q)) {
          return false;
        }
      }
      return true;
    });
  });

  readonly ledgerGroups = computed((): LedgerGroup[] => {
    const rows = this.filteredMovements();
    if (this.periodMode() === 'day') {
      return rows.length
        ? [{ key: this.dayStr(), label: this.formatDayLabel(this.dayStr()), rows }]
        : [];
    }
    const map = new Map<string, MovementListRow[]>();
    for (const row of rows) {
      const key = this.localDayKey(new Date(row.created_at));
      const list = map.get(key);
      if (list) {
        list.push(row);
      } else {
        map.set(key, [row]);
      }
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([key, groupRows]) => ({
        key,
        label: this.formatDayLabel(key),
        rows: groupRows,
      }));
  });

  readonly periodPurchasesSpend = computed(() =>
    this.filteredMovements().reduce((sum, m) => {
      if (m.movement_type !== 'purchase') {
        return sum;
      }
      const q = Number(m.quantity);
      const c = m.unit_cost != null ? Number(m.unit_cost) : NaN;
      if (!Number.isFinite(q) || !Number.isFinite(c)) {
        return sum;
      }
      return sum + q * c;
    }, 0),
  );

  readonly periodSalesRevenue = computed(() =>
    this.filteredMovements().reduce((sum, m) => {
      if (m.movement_type !== 'sale') {
        return sum;
      }
      const q = Math.abs(Number(m.quantity));
      const p = m.unit_sale_price != null ? Number(m.unit_sale_price) : NaN;
      if (!Number.isFinite(q) || !Number.isFinite(p)) {
        return sum;
      }
      return sum + q * p;
    }, 0),
  );

  readonly periodBalanceNet = computed(() => this.periodSalesRevenue() - this.periodPurchasesSpend());

  readonly periodMoveCount = computed(() => this.filteredMovements().length);

  readonly productFilterName = computed(() => {
    const id = this.productIdFilter();
    if (!id) {
      return null;
    }
    return this.inventory().find((r) => r.product_id === id)?.name ?? 'Producto';
  });

  readonly productPickerResults = computed(() => {
    const q = this.productPickerQuery().trim().toLowerCase();
    const rows = this.inventory();
    const filtered = !q
      ? rows
      : rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q),
        );
    return filtered.slice(0, 60);
  });

  readonly modalSelectedProduct = computed(() => {
    const id = this.modalProductId();
    if (!id) {
      return null;
    }
    return this.inventory().find((r) => r.product_id === id) ?? null;
  });

  get canOperateStock(): boolean {
    return this.access.canOperateStock(this.myRole());
  }

  roleLabel(): string {
    return this.access.roleLabel(this.myRole());
  }

  readonly saleForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    quantity: ['1', [Validators.required]],
    unitSalePrice: [''],
    unitCostAtSale: [''],
    note: [''],
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.activeModal()) {
      this.closeModal();
    }
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('companyId');
    this.companyId.set(id);
    if (!id) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no válida.');
      return;
    }
    const qProduct = this.route.snapshot.queryParamMap.get('productId');
    if (qProduct) {
      this.productIdFilter.set(qProduct);
    }
    void this.bootstrap(id);

    this.saleForm.controls.productId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.applySaleDefaultsFromProduct();
    });
  }

  openModal(kind: ActiveModal): void {
    this.errorMessage.set(null);
    const preferredId =
      this.productIdFilter() ??
      (this.saleForm.controls.productId.value || this.inventory()[0]?.product_id || '');
    this.modalProductId.set(preferredId || null);
    this.productPickerQuery.set('');
    this.productPickerOpen.set(false);
    if (kind === 'sale') {
      this.saleForm.patchValue({ productId: preferredId, quantity: '1', note: '' }, { emitEvent: false });
      this.applySaleDefaultsFromProduct();
    } else {
      this.purchaseLines.set([]);
      this.purchaseDraftQty.set('1');
      this.purchaseNote.set('');
      const row = this.inventory().find((r) => r.product_id === preferredId);
      const cost = row ? this.defaultCostForProduct(row) : null;
      this.purchaseDraftCost.set(cost !== null ? String(cost) : '');
    }
    this.activeModal.set(kind);
    document.body.style.overflow = 'hidden';
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.productPickerOpen.set(false);
    this.productPickerQuery.set('');
    this.modalProductId.set(null);
    this.purchaseLines.set([]);
    document.body.style.overflow = '';
  }

  onProductPickerInput(value: string): void {
    this.productPickerQuery.set(value);
    this.productPickerOpen.set(true);
  }

  openProductPicker(): void {
    this.productPickerOpen.set(true);
  }

  closeProductPickerSoon(): void {
    window.setTimeout(() => this.productPickerOpen.set(false), 140);
  }

  selectPickerProduct(productId: string): void {
    this.modalProductId.set(productId);
    const row = this.inventory().find((r) => r.product_id === productId) ?? null;
    if (this.activeModal() === 'sale') {
      this.saleForm.patchValue({ productId }, { emitEvent: true });
    } else if (row) {
      const cost = this.defaultCostForProduct(row);
      this.purchaseDraftCost.set(cost !== null ? String(cost) : '');
    }
    this.productPickerQuery.set('');
    this.productPickerOpen.set(false);
  }

  onPurchaseDraftQty(value: string): void {
    this.purchaseDraftQty.set(value);
  }

  onPurchaseDraftCost(value: string): void {
    this.purchaseDraftCost.set(value);
  }

  onPurchaseNote(value: string): void {
    this.purchaseNote.set(value);
  }

  addPurchaseLine(): void {
    this.errorMessage.set(null);
    const product = this.modalSelectedProduct();
    if (!product) {
      this.errorMessage.set('Elegí un producto de la lista.');
      return;
    }
    const qty = parsePositiveNumber(this.purchaseDraftQty());
    const cost = parseNonNegativeNumber(this.purchaseDraftCost());
    if (qty === null || qty <= 0) {
      this.errorMessage.set('La cantidad tiene que ser mayor que 0.');
      return;
    }
    if (cost === null || cost < 0) {
      this.errorMessage.set('El costo unitario es obligatorio (≥ 0).');
      return;
    }
    const existingIdx = this.purchaseLines().findIndex((l) => l.productId === product.product_id);
    if (existingIdx >= 0) {
      this.purchaseLines.update((lines) =>
        lines.map((line, i) =>
          i === existingIdx
            ? { ...line, quantity: line.quantity + qty, unitCost: cost }
            : line,
        ),
      );
    } else {
      this.purchaseLines.update((lines) => [
        ...lines,
        {
          key: `${product.product_id}-${Date.now()}`,
          productId: product.product_id,
          name: product.name,
          sku: product.sku ?? null,
          quantity: qty,
          unitCost: cost,
        },
      ]);
    }
    this.purchaseDraftQty.set('1');
    this.productPickerQuery.set('');
  }

  removePurchaseLine(key: string): void {
    this.purchaseLines.update((lines) => lines.filter((l) => l.key !== key));
  }

  productOptionLabel(row: InventorySnapshotRow): string {
    return row.sku ? `${row.name} — ${row.sku}` : row.name;
  }

  stockOnHand(row: InventorySnapshotRow): number {
    const raw = row.quantity_on_hand;
    const n =
      raw === undefined || raw === null
        ? NaN
        : typeof raw === 'string'
          ? Number(raw)
          : Number(raw);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  setPeriodMode(mode: PeriodMode): void {
    if (this.periodMode() === mode) {
      return;
    }
    this.periodMode.set(mode);
    const cid = this.companyId();
    if (cid) {
      void this.loadMovements(cid);
    }
  }

  async onDayChange(ev: Event): Promise<void> {
    const v = (ev.target as HTMLInputElement).value;
    if (!v) {
      return;
    }
    this.dayStr.set(v);
    this.periodMode.set('day');
    const cid = this.companyId();
    if (cid) {
      await this.loadMovements(cid);
    }
  }

  onTypeFilter(value: string): void {
    if (value === 'all' || value === 'sale' || value === 'purchase') {
      this.typeFilter.set(value);
    }
  }

  onSearch(value: string): void {
    this.searchQuery.set(value);
  }

  clearProductFilter(): void {
    this.productIdFilter.set(null);
  }

  periodHint(): string {
    switch (this.periodMode()) {
      case '7d':
        return 'Últimos 7 días (hasta hoy)';
      case '30d':
        return 'Últimos 30 días (hasta hoy)';
      default:
        return this.formatDayLabel(this.dayStr());
    }
  }

  private isoToday(): string {
    return this.localDayKey(new Date());
  }

  private localDayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatDayLabel(isoDay: string): string {
    const [y, m, d] = isoDay.split('-').map(Number);
    if (!y || !m || !d) {
      return isoDay;
    }
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  private periodRange(): { start: Date; end: Date } {
    const mode = this.periodMode();
    if (mode === 'day') {
      const [y, m, d] = this.dayStr().split('-').map(Number);
      const start = new Date(y, m - 1, d, 0, 0, 0, 0);
      const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
      return { start, end };
    }
    const days = mode === '7d' ? 7 : 30;
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 0, 0, 0);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1), 0, 0, 0, 0);
    return { start, end };
  }

  private async bootstrap(companyId: string): Promise<void> {
    await this.loadCompanyAndInventory(companyId);
    if (this.errorMessage()) {
      return;
    }
    await this.loadMovements(companyId);
    this.applySaleDefaultsFromProduct();
  }

  private async loadCompanyAndInventory(companyId: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const [companyRes, invRes, role] = await Promise.all([
      this.supabase.client.from('companies').select('name').eq('id', companyId).maybeSingle(),
      this.supabase.client
        .from('product_inventory_snapshot')
        .select('*')
        .eq('company_id', companyId)
        .order('name'),
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
    this.companyName.set(companyRes.data.name as string);
    if (invRes.error) {
      this.errorMessage.set(invRes.error.message);
      return;
    }
    const rows = (invRes.data ?? []) as InventorySnapshotRow[];
    this.inventory.set(rows);
    const preferred =
      (this.productIdFilter() && rows.some((r) => r.product_id === this.productIdFilter())
        ? this.productIdFilter()
        : null) ??
      rows[0]?.product_id ??
      '';
    this.saleForm.patchValue({ productId: preferred }, { emitEvent: false });
    this.refreshSaleStockAvailable();
  }

  async loadMovements(companyId: string): Promise<void> {
    this.loadingMoves.set(true);
    this.movements.set([]);
    this.errorMessage.set(null);
    const { start, end } = this.periodRange();
    const movementRes = await this.supabase.client
      .from('stock_movements')
      .select(
        'id, created_at, product_id, movement_type, quantity, unit_cost, unit_sale_price, unit_cost_at_sale, note, products(name)',
      )
      .eq('company_id', companyId)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false });
    this.loadingMoves.set(false);
    if (movementRes.error) {
      this.errorMessage.set(movementRes.error.message);
      return;
    }
    this.movements.set((movementRes.data ?? []) as MovementListRow[]);
  }

  productName(row: MovementListRow): string {
    const p = row.products;
    if (!p) {
      return '—';
    }
    if (Array.isArray(p)) {
      return p[0]?.name ?? '—';
    }
    return p.name ?? '—';
  }

  movementLabel(type: string): string {
    switch (type) {
      case 'purchase':
        return 'Compra';
      case 'sale':
        return 'Venta';
      case 'adjustment':
        return 'Ajuste';
      case 'initial':
        return 'Inicial';
      default:
        return type;
    }
  }

  movementKindClass(type: string): string {
    switch (type) {
      case 'purchase':
        return 'tag tag--in';
      case 'sale':
        return 'tag tag--out';
      case 'adjustment':
        return 'tag tag--adj';
      default:
        return 'tag';
    }
  }

  formatQtyPlain(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toLocaleString('es-AR', { maximumFractionDigits: 4 });
  }

  saleQtyExceedsStock(): boolean {
    const qty = parsePositiveNumber(this.saleForm.controls.quantity.value);
    const stock = this.saleStockAvailable();
    if (qty === null || !Number.isFinite(stock)) {
      return false;
    }
    return qty > stock + 1e-9;
  }

  formatMoney(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) {
      return '—';
    }
    return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  formatQtySigned(row: MovementListRow): string {
    const q = typeof row.quantity === 'string' ? Number(row.quantity) : row.quantity;
    if (!Number.isFinite(q)) {
      return '0';
    }
    const abs = Math.abs(q);
    const s = abs.toLocaleString('es-AR', { maximumFractionDigits: 4 });
    if (row.movement_type === 'sale') {
      return `−${s}`;
    }
    if (q < 0) {
      return `−${s}`;
    }
    return `+${s}`;
  }

  /** Precio o costo unitario según el tipo de movimiento. */
  unitAmount(row: MovementListRow): number | null {
    if (row.movement_type === 'purchase') {
      const uc = row.unit_cost != null ? Number(row.unit_cost) : NaN;
      return Number.isFinite(uc) ? uc : null;
    }
    if (row.movement_type === 'sale') {
      const sp = row.unit_sale_price != null ? Number(row.unit_sale_price) : NaN;
      return Number.isFinite(sp) ? sp : null;
    }
    return null;
  }

  /** Total de la transacción: cantidad × precio/costo unitario. */
  movementTotal(row: MovementListRow): number | null {
    const q = typeof row.quantity === 'string' ? Number(row.quantity) : row.quantity;
    const unit = this.unitAmount(row);
    if (!Number.isFinite(q) || unit === null) {
      return null;
    }
    return Math.abs(q) * unit;
  }

  detailLine(row: MovementListRow): string {
    const q = typeof row.quantity === 'string' ? Number(row.quantity) : row.quantity;
    const abs = Number.isFinite(q) ? Math.abs(q) : 0;
    if (row.movement_type === 'sale') {
      const sp = row.unit_sale_price != null ? Number(row.unit_sale_price) : null;
      const c = row.unit_cost_at_sale != null ? Number(row.unit_cost_at_sale) : null;
      if (sp != null && c != null && Number.isFinite(sp) && Number.isFinite(c)) {
        const margin = (sp - c) * abs;
        return `Costo ${this.formatMoney(c)} · Margen ${this.formatMoney(margin)}`;
      }
      return '—';
    }
    return '—';
  }

  private selectedSaleInventoryRow(): InventorySnapshotRow | null {
    const id = this.saleForm.controls.productId.value;
    return this.inventory().find((r) => r.product_id === id) ?? null;
  }

  private resolveUnitSalePriceForSubmit(): number | null {
    const parsed = parseNonNegativeNumber(this.saleForm.controls.unitSalePrice.value);
    if (parsed !== null) {
      return parsed;
    }
    const row = this.selectedSaleInventoryRow();
    if (!row) {
      return null;
    }
    const sp = row.default_sale_price_unit;
    if (sp === null || sp === undefined || sp === '') {
      return null;
    }
    const n = typeof sp === 'string' ? Number(sp) : sp;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private resolveUnitCostAtSaleForSubmit(): number | null {
    const parsed = parseNonNegativeNumber(this.saleForm.controls.unitCostAtSale.value);
    if (parsed !== null) {
      return parsed;
    }
    const row = this.selectedSaleInventoryRow();
    return row ? this.defaultCostForProduct(row) : null;
  }

  saleDefaultsComplete(): boolean {
    return this.resolveUnitSalePriceForSubmit() !== null && this.resolveUnitCostAtSaleForSubmit() !== null;
  }

  saleDefaultsSummary(): string {
    const sp = this.resolveUnitSalePriceForSubmit();
    const c = this.resolveUnitCostAtSaleForSubmit();
    if (sp === null || c === null) {
      return '';
    }
    return `Esta venta usará precio ${this.formatMoney(sp)} y costo ${this.formatMoney(c)} por unidad.`;
  }

  saleDefaultsMissingHint(): string | null {
    if (this.inventory().length === 0) {
      return null;
    }
    const parts: string[] = [];
    if (this.resolveUnitSalePriceForSubmit() === null) {
      parts.push('precio de venta por defecto');
    }
    if (this.resolveUnitCostAtSaleForSubmit() === null) {
      parts.push('costo de referencia');
    }
    if (!parts.length) {
      return null;
    }
    return `Falta ${parts.join(' y ')}: definí el precio en Inventario, registrá una compra con costo, o ajustá precio/costo abajo.`;
  }

  private defaultCostForProduct(row: InventorySnapshotRow): number | null {
    const last = row.last_purchase_unit_cost;
    const def = row.default_cost_unit;
    const n = (v: string | number | null | undefined): number | null => {
      if (v === null || v === undefined || v === '') {
        return null;
      }
      const x = typeof v === 'string' ? Number(v) : v;
      return Number.isFinite(x) ? x : null;
    };
    return n(last) ?? n(def);
  }

  private refreshSaleStockAvailable(): void {
    const id = this.saleForm.controls.productId.value;
    const row = this.inventory().find((r) => r.product_id === id);
    const raw = row?.quantity_on_hand;
    const n =
      raw === undefined || raw === null
        ? NaN
        : typeof raw === 'string'
          ? Number(raw)
          : Number(raw);
    this.saleStockAvailable.set(Number.isFinite(n) ? Math.max(0, n) : 0);
  }

  private applySaleDefaultsFromProduct(): void {
    const id = this.saleForm.controls.productId.value;
    const row = this.inventory().find((r) => r.product_id === id);
    if (!row) {
      this.saleStockAvailable.set(0);
      this.saleForm.patchValue({ unitSalePrice: '', unitCostAtSale: '' }, { emitEvent: false });
      return;
    }
    const cost = this.defaultCostForProduct(row);
    const patch: Record<string, string | number> = {
      unitSalePrice: '',
      unitCostAtSale: '',
    };
    if (cost !== null) {
      patch['unitCostAtSale'] = cost;
    }
    const sp = row.default_sale_price_unit;
    if (sp != null && sp !== '') {
      const n = typeof sp === 'string' ? Number(sp) : sp;
      if (Number.isFinite(n) && n >= 0) {
        patch['unitSalePrice'] = n;
      }
    }
    this.saleForm.patchValue(patch, { emitEvent: false });
    this.refreshSaleStockAvailable();
  }

  async recordSale(): Promise<void> {
    const cid = this.companyId();
    if (!cid) {
      return;
    }
    if (!this.canOperateStock) {
      this.errorMessage.set('No tenés permiso para registrar ventas.');
      return;
    }
    this.errorMessage.set(null);
    if (this.saleForm.invalid) {
      this.saleForm.markAllAsTouched();
      return;
    }
    const qty = parsePositiveNumber(this.saleForm.controls.quantity.value);
    const salePrice = this.resolveUnitSalePriceForSubmit();
    const costAtSale = this.resolveUnitCostAtSaleForSubmit();
    if (qty === null) {
      this.errorMessage.set('La cantidad tiene que ser mayor que 0.');
      return;
    }
    if (salePrice === null) {
      this.errorMessage.set(
        'No hay precio de venta por defecto para este producto. Configuralo en Inventario o indicá el precio abajo.',
      );
      return;
    }
    if (costAtSale === null) {
      this.errorMessage.set(
        'No hay costo de referencia. Registrá una compra con costo o indicá el costo al vender abajo.',
      );
      return;
    }
    const stock = this.saleStockAvailable();
    if (!Number.isFinite(stock) || stock <= 0) {
      this.errorMessage.set('No hay stock disponible para vender este producto.');
      return;
    }
    if (qty > stock + 1e-9) {
      this.errorMessage.set(
        `No podés vender más de lo que hay en stock (disponible: ${this.formatQtyPlain(stock)}).`,
      );
      return;
    }
    const productId = this.saleForm.controls.productId.value;
    const note = this.saleForm.controls.note.value.trim();
    this.savingSale.set(true);
    const { error: movErr } = await this.supabase.client.from('stock_movements').insert({
      company_id: cid,
      product_id: productId,
      quantity: -qty,
      movement_type: 'sale',
      unit_sale_price: salePrice,
      unit_cost_at_sale: costAtSale,
      note: note.length ? note : null,
    });
    if (movErr) {
      this.savingSale.set(false);
      this.errorMessage.set(this.mapMovementError(movErr.message));
      return;
    }
    const { error: updErr } = await this.supabase.client
      .from('products')
      .update({ default_sale_price_unit: salePrice })
      .eq('id', productId)
      .eq('company_id', cid);
    this.savingSale.set(false);
    if (updErr) {
      this.errorMessage.set(updErr.message);
      return;
    }
    this.saleForm.patchValue({ quantity: '1', note: '' });
    this.applySaleDefaultsFromProduct();
    this.closeModal();
    await Promise.all([this.loadMovements(cid), this.loadInventoryOnly(cid)]);
  }

  async recordPurchase(): Promise<void> {
    const cid = this.companyId();
    if (!cid) {
      return;
    }
    if (!this.canOperateStock) {
      this.errorMessage.set('No tenés permiso para registrar compras.');
      return;
    }
    this.errorMessage.set(null);
    const lines = this.purchaseLines();
    if (lines.length === 0) {
      this.errorMessage.set('Agregá al menos un producto a la compra.');
      return;
    }
    const note = this.purchaseNote().trim();
    this.savingPurchase.set(true);
    const payload = lines.map((line) => ({
      company_id: cid,
      product_id: line.productId,
      quantity: line.quantity,
      movement_type: 'purchase' as const,
      unit_cost: line.unitCost,
      note: note.length ? note : null,
    }));
    const { error: movErr } = await this.supabase.client.from('stock_movements').insert(payload);
    if (movErr) {
      this.savingPurchase.set(false);
      this.errorMessage.set(movErr.message);
      return;
    }
    for (const line of lines) {
      const { error: updErr } = await this.supabase.client
        .from('products')
        .update({ default_cost_unit: line.unitCost })
        .eq('id', line.productId)
        .eq('company_id', cid);
      if (updErr) {
        this.savingPurchase.set(false);
        this.errorMessage.set(updErr.message);
        return;
      }
    }
    this.savingPurchase.set(false);
    this.purchaseLines.set([]);
    this.purchaseNote.set('');
    this.closeModal();
    await Promise.all([this.loadMovements(cid), this.loadInventoryOnly(cid)]);
  }

  private mapMovementError(msg: string): string {
    if (msg.includes('STOCK_INSUFFICIENT')) {
      return 'No hay stock suficiente para esta venta.';
    }
    return msg;
  }

  private async loadInventoryOnly(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('product_inventory_snapshot')
      .select('*')
      .eq('company_id', companyId)
      .order('name');
    if (!error && data) {
      this.inventory.set(data as InventorySnapshotRow[]);
      this.refreshSaleStockAvailable();
    }
  }
}
