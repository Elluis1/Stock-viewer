import { Injectable, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SupabaseService);

  /** Sesión actual; se actualiza con `onAuthStateChange`. */
  readonly session = signal<Session | null>(null);

  constructor() {
    void this.hydrate();
    this.supabase.client.auth.onAuthStateChange((_event, next) => {
      this.session.set(next);
    });
  }

  private async hydrate(): Promise<void> {
    const { data } = await this.supabase.client.auth.getSession();
    this.session.set(data.session);
  }
}
