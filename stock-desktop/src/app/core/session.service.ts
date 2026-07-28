import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from '../auth/auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /** Sesión actual; se actualiza con `onAuthStateChange`. */
  readonly session = signal<Session | null>(null);


  constructor() {
    void this.hydrate();
    this.supabase.client.auth.onAuthStateChange((event, next) => {
      this.session.set(next);
      if (event === 'SIGNED_OUT' && !next && !this.auth.skipLoginRedirectAfterSignOut) {
        this.redirectToLoginIfProtected();
      }
    });
  }

  /**
   * Si el token vence o el refresh falla, el usuario puede seguir viendo una pantalla de /app
   * sin que el guard vuelva a ejecutarse. Lo llevamos a iniciar sesión.
   */
  private redirectToLoginIfProtected(): void {
    const path = this.router.url.split('?')[0] ?? this.router.url;
    if (path === '/app' || path.startsWith('/app/')) {
      void this.router.navigate(['/auth/login'], { queryParams: { returnUrl: this.router.url } });
    }
  }

  private async hydrate(): Promise<void> {
    const { data } = await this.supabase.client.auth.getSession();
    this.session.set(data.session);
  }
}
