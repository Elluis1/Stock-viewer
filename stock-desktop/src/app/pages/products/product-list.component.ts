import { Component, DestroyRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { ProductImagesService } from '../../core/product-images.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, InventorySnapshotRow } from '../../models/stock.types';
import { parseNonNegativeNumber, parsePositiveNumber } from '../../shared/form-numbers';

type CatalogItem = InventorySnapshotRow & {
  stock: number;
  soldQty30d: number;
  purchasedQty30d: number;
  salesRevenue30d: number;
  imageUrl: string | null;
};

type SortKey = 'name' | 'stockAsc' | 'stockDesc' | 'soldDesc';
type ActiveModal = 'product' | 'purchase' | 'price';

@Component({
  selector: 'app-product-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './product-list.component.html',
  styleUrl: './product-list.component.scss',
})
export class ProductListComponent implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly images = inject(ProductImagesService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly companyId = signal<string | null>(null);
  readonly companyName = signal<string | null>(null);
  readonly myRole = signal<CompanyMemberRole | null>(null);
  readonly catalog = signal<CatalogItem[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly sortKey = signal<SortKey>('name');
  readonly loading = signal(true);
  readonly savingProduct = signal(false);
  readonly savingPurchase = signal(false);
  readonly savingPriceDefault = signal(false);
  readonly uploadingImage = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly newProductImage = signal<File | null>(null);
  readonly newProductImageName = signal<string | null>(null);
  readonly activeModal = signal<ActiveModal | null>(null);

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

  readonly priceDefaultForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    defaultSalePrice: ['', [Validators.required]],
  });

  readonly filteredCatalog = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    let rows = this.catalog();
    if (q) {
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q),
      );
    }
    const key = this.sortKey();
    return [...rows].sort((a, b) => {
      switch (key) {
        case 'stockAsc':
          return a.stock - b.stock || a.name.localeCompare(b.name, 'es');
        case 'stockDesc':
          return b.stock - a.stock || a.name.localeCompare(b.name, 'es');
        case 'soldDesc':
          return b.soldQty30d - a.soldQty30d || a.name.localeCompare(b.name, 'es');
        default:
          return a.name.localeCompare(b.name, 'es');
      }
    });
  });

  readonly selected = computed(() => {
    const id = this.selectedId();
    if (!id) {
      return null;
    }
    return this.catalog().find((r) => r.product_id === id) ?? null;
  });

  readonly topSold = computed(() =>
    [...this.catalog()]
      .filter((r) => r.soldQty30d > 0)
      .sort((a, b) => b.soldQty30d - a.soldQty30d)
      .slice(0, 5),
  );

  readonly mostStock = computed(() =>
    [...this.catalog()].sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name, 'es')).slice(0, 5),
  );

  readonly leastStock = computed(() =>
    [...this.catalog()].sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'es')).slice(0, 5),
  );

  get canManageCatalog(): boolean {
    return this.access.canManageCatalog(this.myRole());
  }

  get canOperateStock(): boolean {
    return this.access.canOperateStock(this.myRole());
  }

  roleLabel(): string {
    return this.access.roleLabel(this.myRole());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.activeModal()) {
      this.closeModal();
    }
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  openModal(kind: ActiveModal): void {
    this.errorMessage.set(null);
    const preferredId = this.selectedId() ?? this.catalog()[0]?.product_id ?? '';
    if (kind === 'purchase') {
      this.purchaseForm.patchValue({ productId: preferredId }, { emitEvent: false });
    }
    if (kind === 'price') {
      this.priceDefaultForm.patchValue({ productId: preferredId }, { emitEvent: false });
      this.syncPriceDefaultFormFromInventory();
    }
    this.activeModal.set(kind);
    document.body.style.overflow = 'hidden';
  }

  closeModal(): void {
    this.activeModal.set(null);
    document.body.style.overflow = '';
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

  selectProduct(id: string): void {
    this.selectedId.set(this.selectedId() === id ? null : id);
    if (this.selectedId()) {
      this.purchaseForm.patchValue({ productId: id }, { emitEvent: false });
      this.priceDefaultForm.patchValue({ productId: id }, { emitEvent: false });
      this.syncPriceDefaultFormFromInventory();
      queueMicrotask(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
          document.querySelector('.inv-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }

  clearSelection(): void {
    this.selectedId.set(null);
  }

  onSearch(value: string): void {
    this.searchQuery.set(value);
  }

  onSort(value: string): void {
    if (value === 'name' || value === 'stockAsc' || value === 'stockDesc' || value === 'soldDesc') {
      this.sortKey.set(value);
    }
  }

  productInitial(name: string): string {
    const t = name.trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }

  avatarTone(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = (h + name.charCodeAt(i) * (i + 1)) % 5;
    }
    return h;
  }

  async load(companyId: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);

    const [companyRes, invRes, movesRes, role] = await Promise.all([
      this.supabase.client.from('companies').select('name').eq('id', companyId).maybeSingle(),
      this.supabase.client
        .from('product_inventory_snapshot')
        .select('*')
        .eq('company_id', companyId)
        .order('name'),
      this.supabase.client
        .from('stock_movements')
        .select('product_id, quantity, movement_type, unit_sale_price')
        .eq('company_id', companyId)
        .gte('created_at', since.toISOString())
        .in('movement_type', ['sale', 'purchase']),
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
    if (movesRes.error) {
      this.errorMessage.set(movesRes.error.message);
      return;
    }

    const sold = new Map<string, number>();
    const purchased = new Map<string, number>();
    const revenue = new Map<string, number>();

    for (const row of movesRes.data ?? []) {
      const r = row as {
        product_id: string;
        quantity: string | number;
        movement_type: string;
        unit_sale_price: string | number | null;
      };
      const qty = Math.abs(typeof r.quantity === 'string' ? Number(r.quantity) : r.quantity);
      if (!Number.isFinite(qty)) {
        continue;
      }
      if (r.movement_type === 'sale') {
        sold.set(r.product_id, (sold.get(r.product_id) ?? 0) + qty);
        const price =
          r.unit_sale_price === null || r.unit_sale_price === undefined || r.unit_sale_price === ''
            ? null
            : typeof r.unit_sale_price === 'string'
              ? Number(r.unit_sale_price)
              : r.unit_sale_price;
        if (price !== null && Number.isFinite(price)) {
          revenue.set(r.product_id, (revenue.get(r.product_id) ?? 0) + price * qty);
        }
      } else if (r.movement_type === 'purchase') {
        purchased.set(r.product_id, (purchased.get(r.product_id) ?? 0) + qty);
      }
    }

    const rows = ((invRes.data ?? []) as InventorySnapshotRow[]).map((row) => {
      const stockRaw =
        typeof row.quantity_on_hand === 'string' ? Number(row.quantity_on_hand) : row.quantity_on_hand;
      return {
        ...row,
        image_path: row.image_path ?? null,
        stock: Number.isFinite(stockRaw) ? stockRaw : 0,
        soldQty30d: sold.get(row.product_id) ?? 0,
        purchasedQty30d: purchased.get(row.product_id) ?? 0,
        salesRevenue30d: revenue.get(row.product_id) ?? 0,
        imageUrl: this.images.publicUrl(row.image_path),
      } satisfies CatalogItem;
    });

    this.catalog.set(rows);

    const sel = this.selectedId();
    if (sel && !rows.some((r) => r.product_id === sel)) {
      this.selectedId.set(null);
    }

    const focusId = this.selectedId() ?? rows[0]?.product_id ?? '';
    this.purchaseForm.patchValue({ productId: focusId }, { emitEvent: false });
    this.priceDefaultForm.patchValue({ productId: focusId }, { emitEvent: false });
    this.syncPriceDefaultFormFromInventory();
  }

  private syncPriceDefaultFormFromInventory(): void {
    const id = this.priceDefaultForm.controls.productId.value;
    const row = this.catalog().find((r) => r.product_id === id);
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

  stockValue(row: CatalogItem): number | null {
    const cost = this.displayUnitCost(row);
    if (cost === null) {
      return null;
    }
    return cost * row.stock;
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
    return value.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const product = this.selected();
    const companyId = this.companyId();
    if (!file || !product || !companyId) {
      return;
    }
    if (!this.canManageCatalog) {
      this.errorMessage.set('Solo owner o admin pueden cambiar la imagen.');
      return;
    }
    this.uploadingImage.set(true);
    this.errorMessage.set(null);
    const { error } = await this.images.uploadProductImage({
      companyId,
      productId: product.product_id,
      file,
      previousPath: product.image_path,
    });
    this.uploadingImage.set(false);
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    await this.load(companyId);
  }

  async removeImage(): Promise<void> {
    const product = this.selected();
    const companyId = this.companyId();
    if (!product?.image_path || !companyId) {
      return;
    }
    if (!this.canManageCatalog) {
      this.errorMessage.set('Solo owner o admin pueden quitar la imagen.');
      return;
    }
    this.uploadingImage.set(true);
    this.errorMessage.set(null);
    const { error } = await this.images.removeProductImage({
      companyId,
      productId: product.product_id,
      path: product.image_path,
    });
    this.uploadingImage.set(false);
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    await this.load(companyId);
  }

  async onNewProductImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.newProductImage.set(null);
      this.newProductImageName.set(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      this.errorMessage.set('Usá JPG, PNG, WEBP o GIF.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage.set('La imagen no puede superar 5 MB.');
      input.value = '';
      return;
    }
    this.errorMessage.set(null);
    this.newProductImage.set(file);
    this.newProductImageName.set(file.name);
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
    const pendingImage = this.newProductImage();
    this.savingProduct.set(true);
    const { data: inserted, error: insErr } = await this.supabase.client
      .from('products')
      .insert({
        company_id: cid,
        name: this.productForm.controls.name.value.trim(),
        sku: sku.length ? sku : null,
        unit: this.productForm.controls.unit.value.trim() || 'ud',
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
    if (productId && pendingImage) {
      const { error: imgErr } = await this.images.uploadProductImage({
        companyId: cid,
        productId,
        file: pendingImage,
      });
      if (imgErr) {
        this.savingProduct.set(false);
        this.errorMessage.set(`Producto creado, pero la foto falló: ${imgErr}`);
        this.selectedId.set(productId);
        this.newProductImage.set(null);
        this.newProductImageName.set(null);
        this.productForm.reset({
          name: '',
          sku: '',
          unit: 'ud',
          initialQuantity: '',
          unitCost: '',
          defaultSalePrice: '',
        });
        this.closeModal();
        await this.load(cid);
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
    this.newProductImage.set(null);
    this.newProductImageName.set(null);
    if (productId) {
      this.selectedId.set(productId);
    }
    this.closeModal();
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
    this.closeModal();
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
    this.closeModal();
    await this.load(cid);
  }
}
