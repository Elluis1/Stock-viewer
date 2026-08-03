import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from '../auth/auth.service';
import { avatarFromUserMetadata } from '../shared/avatar-url';
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
      if (next?.user) {
        void this.syncOwnProfile(next);
      }
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
    if (data.session?.user) {
      void this.syncOwnProfile(data.session);
    }
  }

  /** Asegura que profiles tenga la foto/nombre de Auth (Google, etc.). */
  private async syncOwnProfile(session: Session): Promise<void> {
    const user = session.user;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const avatarUrl = avatarFromUserMetadata(meta);
    const displayName =
      (typeof meta['full_name'] === 'string' && meta['full_name'].trim()) ||
      (typeof meta['name'] === 'string' && meta['name'].trim()) ||
      user.email?.split('@')[0] ||
      null;
    const payload: Record<string, string | null> = {
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    };
    if (avatarUrl) {
      payload['avatar_url'] = avatarUrl;
    }
    await this.supabase.client.from('profiles').upsert(payload, { onConflict: 'id' });
  }
}
