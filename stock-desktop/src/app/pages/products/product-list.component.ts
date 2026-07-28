import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, InventorySnapshotRow } from '../../models/stock.types';
import { parseNonNegativeNumber, parsePositiveNumber } from '../../shared/form-numbers';

@Component({
  selector: 'app-product-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './product-list.component.html',
  styleUrl: './product-list.component.scss',
})
export class ProductListComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly companyId = signal<string | null>(null);
  readonly companyName = signal<string | null>(null);
  readonly myRole = signal<CompanyMemberRole | null>(null);
  readonly inventory = signal<InventorySnapshotRow[]>([]);
  readonly loading = signal(true);
  readonly savingProduct = signal(false);
  readonly savingPurchase = signal(false);
  readonly savingPriceDefault = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly productForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(200)]],
    sku: [''],
    unit: ['ud', [Validators.required, Validators.maxLength(40)]],
    initialQuantity: [''],
    unitCost: [''],
    defaultSalePrice: [''],
  });

  readonly purchaseForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    quantity: ['1', [Validators.required]],
    unitCost: ['', [Validators.required]],
    note: [''],
  });

  /** Precio de venta por defecto del producto (editable). */
  readonly priceDefaultForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    defaultSalePrice: ['', [Validators.required]],
  });

  get canManageCatalog(): boolean {
    return this.access.canManageCatalog(this.myRole());
  }

  get canOperateStock(): boolean {
    return this.access.canOperateStock(this.myRole());
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
    this.priceDefaultForm.controls.productId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncPriceDefaultFormFromInventory());
    await this.load(id);
  }

  async load(companyId: string): Promise<void> {
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
    const firstId = rows[0]?.product_id ?? '';
    this.purchaseForm.patchValue({ productId: firstId }, { emitEvent: false });
    this.priceDefaultForm.patchValue({ productId: firstId }, { emitEvent: false });
    this.syncPriceDefaultFormFromInventory();
  }

  private syncPriceDefaultFormFromInventory(): void {
    const id = this.priceDefaultForm.controls.productId.value;
    const row = this.inventory().find((r) => r.product_id === id);
    const sp = row?.default_sale_price_unit;
    let str = '';
    if (sp !== null && sp !== undefined && sp !== '') {
      const n = typeof sp === 'string' ? Number(sp) : sp;
      if (Number.isFinite(n)) {
        str = String(n);
      }
    }
    this.priceDefaultForm.patchValue({ defaultSalePrice: str }, { emitEvent: false });
  }

  displayUnitCost(row: InventorySnapshotRow): number | null {
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

  displayDefaultSalePrice(row: InventorySnapshotRow): number | null {
    const v = row.default_sale_price_unit;
    if (v === null || v === undefined || v === '') {
      return null;
    }
    const x = typeof v === 'string' ? Number(v) : v;
    return Number.isFinite(x) ? x : null;
  }

  formatQty(value: string | number): string {
    const x = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(x)) {
      return '0';
    }
    return x.toLocaleString('es-AR', { maximumFractionDigits: 4 });
  }

  formatMoney(value: number | null): string {
    if (value === null || Number.isNaN(value)) {
      return '—';
    }
    return value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  async addProduct(): Promise<void> {
    const cid = this.companyId();
    if (!cid) {
      return;
    }
    if (!this.canManageCatalog) {
      this.errorMessage.set('Solo owner o admin pueden dar de alta productos.');
      return;
    }
    this.errorMessage.set(null);
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }
    const initialQty = parsePositiveNumber(this.productForm.controls.initialQuantity.value);
    const unitCost = parseNonNegativeNumber(this.productForm.controls.unitCost.value);
    if (initialQty !== null && initialQty > 0) {
      if (unitCost === null || unitCost < 0) {
        this.errorMessage.set('Si cargás cantidad inicial, el costo unitario de compra es obligatorio (≥ 0).');
        return;
      }
    }
    const sku = this.productForm.controls.sku.value.trim();
    const defaultSale = parseNonNegativeNumber(this.productForm.controls.defaultSalePrice.value);
    this.savingProduct.set(true);
    const { data: inserted, error: insErr } = await this.supabase.client
      .from('products')
      .insert({
        company_id: cid,
        name: this.productForm.controls.name.value.trim(),
        sku: sku.length ? sku : null,
        unit: this.productForm.controls.unit.value.trim() || 'unit',
        default_cost_unit: unitCost !== null && initialQty !== null && initialQty > 0 ? unitCost : null,
        default_sale_price_unit: defaultSale !== null ? defaultSale : null,
      })
      .select('id')
      .single();
    if (insErr) {
      this.savingProduct.set(false);
      this.errorMessage.set(insErr.message);
      return;
    }
    const productId = inserted?.id as string | undefined;
    if (productId && initialQty !== null && initialQty > 0 && unitCost !== null) {
      const { error: movErr } = await this.supabase.client.from('stock_movements').insert({
        company_id: cid,
        product_id: productId,
        quantity: initialQty,
        movement_type: 'purchase',
        unit_cost: unitCost,
        note: 'Carga inicial / alta de producto',
      });
      if (movErr) {
        this.savingProduct.set(false);
        this.errorMessage.set(movErr.message);
        return;
      }
    }
    this.savingProduct.set(false);
    this.productForm.reset({
      name: '',
      sku: '',
      unit: 'ud',
      initialQuantity: '',
      unitCost: '',
      defaultSalePrice: '',
    });
    await this.load(cid);
  }

  async saveDefaultSalePrice(): Promise<void> {
    const cid = this.companyId();
    if (!cid) {
      return;
    }
    if (!this.canManageCatalog) {
      this.errorMessage.set('Solo owner o admin pueden cambiar precios por defecto.');
      return;
    }
    this.errorMessage.set(null);
    if (this.priceDefaultForm.invalid) {
      this.priceDefaultForm.markAllAsTouched();
      return;
    }
    const price = parseNonNegativeNumber(this.priceDefaultForm.controls.defaultSalePrice.value);
    if (price === null) {
      this.errorMessage.set('Indicá un precio de venta por unidad (≥ 0).');
      return;
    }
    const productId = this.priceDefaultForm.controls.productId.value;
    this.savingPriceDefault.set(true);
    const { error } = await this.supabase.client
      .from('products')
      .update({ default_sale_price_unit: price })
      .eq('id', productId)
      .eq('company_id', cid);
    this.savingPriceDefault.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    await this.load(cid);
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
    if (this.purchaseForm.invalid) {
      this.purchaseForm.markAllAsTouched();
      return;
    }
    const qty = parsePositiveNumber(this.purchaseForm.controls.quantity.value);
    const cost = parseNonNegativeNumber(this.purchaseForm.controls.unitCost.value);
    if (qty === null || qty <= 0) {
      this.errorMessage.set('La cantidad tiene que ser mayor que 0.');
      return;
    }
    if (cost === null || cost < 0) {
      this.errorMessage.set('El costo unitario es obligatorio (≥ 0).');
      return;
    }
    const productId = this.purchaseForm.controls.productId.value;
    const note = this.purchaseForm.controls.note.value.trim();
    this.savingPurchase.set(true);
    const { error: movErr } = await this.supabase.client.from('stock_movements').insert({
      company_id: cid,
      product_id: productId,
      quantity: qty,
      movement_type: 'purchase',
      unit_cost: cost,
      note: note.length ? note : null,
    });
    if (movErr) {
      this.savingPurchase.set(false);
      this.errorMessage.set(movErr.message);
      return;
    }
    const { error: updErr } = await this.supabase.client
      .from('products')
      .update({ default_cost_unit: cost })
      .eq('id', productId)
      .eq('company_id', cid);
    this.savingPurchase.set(false);
    if (updErr) {
      this.errorMessage.set(updErr.message);
      return;
    }
    this.purchaseForm.patchValue({ quantity: '1', unitCost: '', note: '' });
    await this.load(cid);
  }
}
