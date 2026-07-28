import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, InventorySnapshotRow, MovementListRow } from '../../models/stock.types';
import { parseNonNegativeNumber, parsePositiveNumber } from '../../shared/form-numbers';

@Component({
  selector: 'app-company-moves',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  templateUrl: './company-moves.component.html',
  styleUrl: './company-moves.component.scss',
})
export class CompanyMovesComponent implements OnInit {
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
  readonly loading = signal(true);
  readonly loadingMoves = signal(false);
  readonly savingSale = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** Stock disponible del producto elegido en el formulario de venta. */
  readonly saleStockAvailable = signal(0);

  /** Total gastado en compras del día (costo × cantidad). */
  readonly dayPurchasesSpend = computed(() =>
    this.movements().reduce((sum, m) => {
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

  /** Total ingresado por ventas del día (precio venta × cantidad). */
  readonly daySalesRevenue = computed(() =>
    this.movements().reduce((sum, m) => {
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

  /** Ingresos por ventas menos gasto en compras (mismo día). */
  readonly dayBalanceNet = computed(() => this.daySalesRevenue() - this.dayPurchasesSpend());

  get canOperateStock(): boolean {
    return this.access.canOperateStock(this.myRole());
  }

  roleLabel(): string {
    return this.access.roleLabel(this.myRole());
  }

  readonly saleForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    quantity: ['1', [Validators.required]],
    /** Si quedan vacíos, se usan el precio de venta por defecto del producto y el costo de referencia. */
    unitSalePrice: [''],
    unitCostAtSale: [''],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('companyId');
    this.companyId.set(id);
    if (!id) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no válida.');
      return;
    }
    void this.bootstrap(id);

    this.saleForm.controls.productId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.applySaleDefaultsFromProduct();
    });
  }

  private isoToday(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async bootstrap(companyId: string): Promise<void> {
    await this.loadCompanyAndInventory(companyId);
    if (this.errorMessage()) {
      return;
    }
    await this.loadMovements(companyId);
    this.applySaleDefaultsFromProduct();
  }

  async onDayChange(ev: Event): Promise<void> {
    const v = (ev.target as HTMLInputElement).value;
    if (!v) {
      return;
    }
    this.dayStr.set(v);
    const cid = this.companyId();
    if (cid) {
      await this.loadMovements(cid);
    }
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
    const first = rows[0]?.product_id ?? '';
    this.saleForm.patchValue({ productId: first }, { emitEvent: false });
    this.refreshSaleStockAvailable();
  }

  async loadMovements(companyId: string): Promise<void> {
    this.loadingMoves.set(true);
    this.movements.set([]);
    this.errorMessage.set(null);
    const [y, m, d] = this.dayStr().split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const movementRes = await this.supabase.client
      .from('stock_movements')
      .select('id, created_at, movement_type, quantity, unit_cost, unit_sale_price, unit_cost_at_sale, note, products(name)')
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

  detailLine(row: MovementListRow): string {
    const q = typeof row.quantity === 'string' ? Number(row.quantity) : row.quantity;
    const abs = Number.isFinite(q) ? Math.abs(q) : 0;
    if (row.movement_type === 'purchase') {
      const uc = row.unit_cost != null ? Number(row.unit_cost) : null;
      if (uc != null && Number.isFinite(uc)) {
        return `Costo ${this.formatMoney(uc)} × ${abs.toLocaleString('es-AR')} = ${this.formatMoney(uc * abs)}`;
      }
      return 'Compra';
    }
    if (row.movement_type === 'sale') {
      const sp = row.unit_sale_price != null ? Number(row.unit_sale_price) : null;
      const c = row.unit_cost_at_sale != null ? Number(row.unit_cost_at_sale) : null;
      if (sp != null && c != null && Number.isFinite(sp) && Number.isFinite(c)) {
        const margin = (sp - c) * abs;
        return `Venta ${this.formatMoney(sp)} · Costo ${this.formatMoney(c)} · Margen ${this.formatMoney(margin)}`;
      }
      return 'Venta';
    }
    return '—';
  }

  private selectedInventoryRow(): InventorySnapshotRow | null {
    const id = this.saleForm.controls.productId.value;
    return this.inventory().find((r) => r.product_id === id) ?? null;
  }

  /** Precio unitario de venta: valor del formulario o `default_sale_price_unit` del producto. */
  private resolveUnitSalePriceForSubmit(): number | null {
    const parsed = parseNonNegativeNumber(this.saleForm.controls.unitSalePrice.value);
    if (parsed !== null) {
      return parsed;
    }
    const row = this.selectedInventoryRow();
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

  /** Costo unitario al vender: valor del formulario o último costo / referencia del producto. */
  private resolveUnitCostAtSaleForSubmit(): number | null {
    const parsed = parseNonNegativeNumber(this.saleForm.controls.unitCostAtSale.value);
    if (parsed !== null) {
      return parsed;
    }
    const row = this.selectedInventoryRow();
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
    return `Esta venta usará precio ${this.formatMoney(sp)} y costo ${this.formatMoney(c)} por unidad (podés cambiarlos en «Ajustar precio o costo»).`;
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
    return `Falta ${parts.join(' y ')}: definí el precio en Inventario, registrá una compra con costo, o completá «Ajustar precio o costo».`;
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
        'No hay precio de venta por defecto para este producto. Configuralo en Inventario o indicá el precio en «Ajustar precio o costo».',
      );
      return;
    }
    if (costAtSale === null) {
      this.errorMessage.set(
        'No hay costo de referencia (comprá stock o cargá costo). Indicá el costo al vender en «Ajustar precio o costo».',
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
    this.savingSale.set(true);
    const { error: movErr } = await this.supabase.client.from('stock_movements').insert({
      company_id: cid,
      product_id: productId,
      quantity: -qty,
      movement_type: 'sale',
      unit_sale_price: salePrice,
      unit_cost_at_sale: costAtSale,
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
    this.saleForm.patchValue({ quantity: '1' });
    this.applySaleDefaultsFromProduct();
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
