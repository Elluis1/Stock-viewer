import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole, CompanyRow } from '../../models/stock.types';

type CompanyListItem = CompanyRow & { role: CompanyMemberRole | null };

@Component({
  selector: 'app-company-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './company-list.component.html',
  styleUrl: './company-list.component.scss',
})
export class CompanyListComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);

  readonly companies = signal<CompanyListItem[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  roleLabel(role: CompanyMemberRole | null): string {
    return this.access.roleLabel(role);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const [companiesRes, roles] = await Promise.all([
      this.supabase.client.from('companies').select('id,name,created_at').order('created_at', { ascending: false }),
      this.access.getMyRolesByCompany(),
    ]);
    this.loading.set(false);
    if (companiesRes.error) {
      this.errorMessage.set(companiesRes.error.message);
      return;
    }
    const rows = (companiesRes.data ?? []) as CompanyRow[];
    this.companies.set(
      rows.map((c) => ({
        ...c,
        role: roles.get(c.id) ?? null,
      })),
    );
  }
}
