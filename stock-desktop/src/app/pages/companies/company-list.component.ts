import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SessionService } from '../../core/session.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, CompanyRow } from '../../models/stock.types';

type CompanyFilter = 'all' | 'owned' | 'shared';

type CompanyListItem = CompanyRow & {
  role: CompanyMemberRole | null;
  productCount: number;
  memberCount: number;
  movesInToday: number;
  movesOutToday: number;
  movesLast7Days: number;
};

@Component({
  selector: 'app-company-list',
  imports: [RouterLink, FormsModule],
  templateUrl: './company-list.component.html',
  styleUrl: './company-list.component.scss',
})
export class CompanyListComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly sessionService = inject(SessionService);
  private readonly filtersEl = viewChild<ElementRef<HTMLElement>>('filtersEl');

  readonly companies = signal<CompanyListItem[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly filter = signal<CompanyFilter>('all');
  readonly filterThumb = signal({ transform: 'translateX(0px)', width: '0px' });

  readonly displayName = computed(() => this.resolveDisplayName());

  readonly soleCompany = computed(() => {
    const list = this.companies();
    return list.length === 1 ? list[0]! : null;
  });

  readonly totals = computed(() => {
    const list = this.companies();
    return {
      companies: list.length,
      products: list.reduce((n, c) => n + c.productCount, 0),
      movesToday: list.reduce((n, c) => n + c.movesInToday + c.movesOutToday, 0),
      movesInToday: list.reduce((n, c) => n + c.movesInToday, 0),
      movesOutToday: list.reduce((n, c) => n + c.movesOutToday, 0),
    };
  });

  readonly filteredCompanies = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const f = this.filter();
    return this.companies().filter((c) => {
      if (f === 'owned' && c.role !== 'owner') {
        return false;
      }
      if (f === 'shared' && c.role === 'owner') {
        return false;
      }
      if (!q) {
        return true;
      }
      return c.name.toLowerCase().includes(q);
    });
  });

  readonly showSearch = computed(() => this.companies().length >= 3);

  constructor() {
    afterNextRender(() => this.syncFilterThumb());
    effect(() => {
      this.filter();
      this.loading();
      this.companies();
      untracked(() => {
        requestAnimationFrame(() => this.syncFilterThumb());
      });
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncFilterThumb();
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  roleLabel(role: CompanyMemberRole | null): string {
    return this.access.roleLabel(role);
  }

  companyInitial(name: string): string {
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

  setFilter(next: CompanyFilter): void {
    if (this.filter() === next) {
      return;
    }
    this.filter.set(next);
    requestAnimationFrame(() => this.syncFilterThumb());
  }

  companyTrack(company: CompanyListItem): string {
    return `${this.filter()}:${company.id}`;
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  private syncFilterThumb(): void {
    const root = this.filtersEl()?.nativeElement;
    if (!root) {
      return;
    }
    const active = root.querySelector<HTMLElement>('.hub-filter.is-active');
    if (!active) {
      return;
    }
    this.filterThumb.set({
      transform: `translateX(${active.offsetLeft}px)`,
      width: `${active.offsetWidth}px`,
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const [companiesRes, roles] = await Promise.all([
      this.supabase.client.from('companies').select('id,name,created_at').order('created_at', { ascending: false }),
      this.access.getMyRolesByCompany(),
    ]);

    if (companiesRes.error) {
      this.loading.set(false);
      this.errorMessage.set(companiesRes.error.message);
      return;
    }

    const rows = (companiesRes.data ?? []) as CompanyRow[];
    const ids = rows.map((c) => c.id);

    const productCount = new Map<string, number>();
    const memberCount = new Map<string, number>();
    const movesInToday = new Map<string, number>();
    const movesOutToday = new Map<string, number>();
    const movesLast7Days = new Map<string, number>();

    if (ids.length > 0) {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const since7 = new Date(startToday);
      since7.setDate(since7.getDate() - 7);

      const [productsRes, membersRes, movesTodayRes, movesWeekRes] = await Promise.all([
        this.supabase.client.from('products').select('company_id').in('company_id', ids),
        this.supabase.client.from('company_members').select('company_id').in('company_id', ids),
        this.supabase.client
          .from('stock_movements')
          .select('company_id, movement_type')
          .in('company_id', ids)
          .gte('created_at', startToday.toISOString()),
        this.supabase.client
          .from('stock_movements')
          .select('company_id')
          .in('company_id', ids)
          .gte('created_at', since7.toISOString()),
      ]);

      for (const res of [productsRes, membersRes, movesTodayRes, movesWeekRes]) {
        if (res.error) {
          this.loading.set(false);
          this.errorMessage.set(res.error.message);
          return;
        }
      }

      for (const row of productsRes.data ?? []) {
        const cid = (row as { company_id: string }).company_id;
        productCount.set(cid, (productCount.get(cid) ?? 0) + 1);
      }
      for (const row of membersRes.data ?? []) {
        const cid = (row as { company_id: string }).company_id;
        memberCount.set(cid, (memberCount.get(cid) ?? 0) + 1);
      }
      for (const row of movesTodayRes.data ?? []) {
        const r = row as { company_id: string; movement_type: string };
        if (r.movement_type === 'purchase' || r.movement_type === 'initial') {
          movesInToday.set(r.company_id, (movesInToday.get(r.company_id) ?? 0) + 1);
        } else if (r.movement_type === 'sale') {
          movesOutToday.set(r.company_id, (movesOutToday.get(r.company_id) ?? 0) + 1);
        } else {
          // adjustments count toward week total only via movesWeekRes
        }
      }
      for (const row of movesWeekRes.data ?? []) {
        const cid = (row as { company_id: string }).company_id;
        movesLast7Days.set(cid, (movesLast7Days.get(cid) ?? 0) + 1);
      }
    }

    this.companies.set(
      rows.map((c) => ({
        ...c,
        role: roles.get(c.id) ?? null,
        productCount: productCount.get(c.id) ?? 0,
        memberCount: memberCount.get(c.id) ?? 0,
        movesInToday: movesInToday.get(c.id) ?? 0,
        movesOutToday: movesOutToday.get(c.id) ?? 0,
        movesLast7Days: movesLast7Days.get(c.id) ?? 0,
      })),
    );
    this.loading.set(false);
  }

  private resolveDisplayName(): string | null {
    const user = this.sessionService.session()?.user;
    if (!user) {
      return null;
    }
    const meta = user.user_metadata ?? {};
    const fromMeta =
      (typeof meta['full_name'] === 'string' && meta['full_name'].trim()) ||
      (typeof meta['name'] === 'string' && meta['name'].trim()) ||
      (typeof meta['display_name'] === 'string' && meta['display_name'].trim()) ||
      '';
    if (fromMeta) {
      return fromMeta.split(/\s+/)[0] ?? fromMeta;
    }
    const email = user.email ?? '';
    return email.split('@')[0]?.trim() || null;
  }
}
