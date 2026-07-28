import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../core/supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  /**
   * Tras un cierre de sesión explícito (p. ej. "Salir") no forzamos ir a /auth/login:
   * el caller ya navega (p. ej. a inicio). `SessionService` lo consulta en SIGNED_OUT.
   */
  skipLoginRedirectAfterSignOut = false;

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
    this.skipLoginRedirectAfterSignOut = true;
    const p = this.supabase.client.auth.signOut();
    void p.finally(() => {
      setTimeout(() => {
        this.skipLoginRedirectAfterSignOut = false;
      }, 0);
    });
    return p;
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

  /** Nivel de autenticación (AAL1 = solo contraseña, AAL2 = con 2FA verificado). */
  getAuthenticatorAssuranceLevel() {
    return this.supabase.client.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  listMfaFactors() {
    return this.supabase.client.auth.mfa.listFactors();
  }

  mfaChallenge(factorId: string) {
    return this.supabase.client.auth.mfa.challenge({ factorId });
  }

  mfaVerify(factorId: string, challengeId: string, code: string) {
    return this.supabase.client.auth.mfa.verify({ factorId, challengeId, code });
  }

  mfaEnrollTotp(friendlyName: string) {
    return this.supabase.client.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  }

  mfaUnenroll(factorId: string) {
    return this.supabase.client.auth.mfa.unenroll({ factorId });
  }

  /**
   * Tras primer factor (contraseña u OAuth): si falta AAL2 y hay TOTP verificado,
   * devuelve el `factorId`. El `mfa.challenge()` debe llamarse justo antes de `verify`
   * (el desafío vence en segundos).
   */
  async prepareTotpLoginStep(): Promise<{ ok: true; factorId: string } | { ok: false }> {
    const { data: aal, error } = await this.getAuthenticatorAssuranceLevel();
    if (error || !aal) {
      return { ok: false };
    }
    const current = aal.currentLevel;
    const next = aal.nextLevel;
    if (next !== 'aal2' || current === 'aal2') {
      return { ok: false };
    }
    const { data: factors, error: fe } = await this.listMfaFactors();
    if (fe || !factors?.totp?.length) {
      return { ok: false };
    }
    const totp = factors.totp.find((f) => f.status === 'verified');
    if (!totp?.id) {
      return { ok: false };
    }
    return { ok: true, factorId: totp.id };
  }
}
