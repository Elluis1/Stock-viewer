import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyRow } from '../../models/stock.types';

@Component({
  selector: 'app-company-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './company-list.component.html',
  styleUrl: './company-list.component.scss',
})
export class CompanyListComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);

  readonly companies = signal<CompanyRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('id,name,created_at')
      .order('created_at', { ascending: false });
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    this.companies.set((data ?? []) as CompanyRow[]);
  }
}
