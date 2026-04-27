import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../core/supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  signIn(email: string, password: string) {
    return this.supabase.client.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string) {
    const redirect =
      typeof globalThis !== 'undefined' && 'location' in globalThis
        ? (globalThis as unknown as { location: { origin: string } }).location.origin
        : undefined;
    return this.supabase.client.auth.signUp({
      email,
      password,
      options: redirect ? { emailRedirectTo: `${redirect}/auth/login` } : undefined,
    });
  }

  signOut() {
    return this.supabase.client.auth.signOut();
  }

  /**
   * Abre el flujo OAuth de Google (misma acción para “registro” o login: Supabase crea/enlaza el usuario).
   * Configuración requerida en Supabase: Authentication → Providers → Google, y URL de redirección permitida.
   */
  signInWithGoogle() {
    const origin =
      typeof globalThis !== 'undefined' && 'location' in globalThis
        ? (globalThis as unknown as { location: { origin: string } }).location.origin
        : '';
    return this.supabase.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: origin ? `${origin}/auth/callback` : undefined,
        queryParams: { prompt: 'select_account' },
      },
    });
  }
}
