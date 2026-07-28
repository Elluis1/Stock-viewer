import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { mapAuthError } from '../../auth/auth-messages';

type TotpFactor = {
  id: string;
  friendly_name?: string;
  status: string;
};

@Component({
  selector: 'app-mfa-setup',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './mfa-setup.component.html',
  styleUrl: './mfa-setup.component.scss',
})
export class MfaSetupComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly verifiedFactor = signal<TotpFactor | null>(null);
  /** Factor TOTP creado pero sin confirmar (quedó a mitad del flujo). */
  readonly stuckUnverifiedFactorId = signal<string | null>(null);
  readonly pendingFactorId = signal<string | null>(null);
  readonly totpSecret = signal<string | null>(null);
  readonly qrSafeUrl = signal<SafeUrl | null>(null);
  readonly enrollOpen = signal(false);

  readonly confirmForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  async ngOnInit(): Promise<void> {
    await this.refreshFactors();
  }

  async refreshFactors(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const { data, error } = await this.auth.listMfaFactors();
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    const totp = (data?.totp ?? []) as TotpFactor[];
    const verified = totp.find((f) => f.status === 'verified') ?? null;
    this.verifiedFactor.set(verified);
    const stuck = !verified ? (totp.find((f) => f.status === 'unverified') ?? null) : null;
    this.stuckUnverifiedFactorId.set(stuck?.id ?? null);
    if (!stuck) {
      this.pendingFactorId.set(null);
      this.totpSecret.set(null);
      this.qrSafeUrl.set(null);
      this.enrollOpen.set(false);
    }
  }

  async startEnroll(): Promise<void> {
    if (this.stuckUnverifiedFactorId()) {
      this.errorMessage.set('Hay un registro de 2FA sin terminar. Cancelalo antes de empezar uno nuevo.');
      return;
    }
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.saving.set(true);
    const { data, error } = await this.auth.mfaEnrollTotp(`Stock Desktop ${Date.now().toString(36)}`);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    const id = data?.id as string | undefined;
    const totp = (data as { totp?: { qr_code?: string; secret?: string } })?.totp;
    const qr = totp?.qr_code;
    const secret = totp?.secret ?? null;
    if (!id || !qr) {
      this.errorMessage.set('No se pudo iniciar el registro de 2FA. Revisá que MFA TOTP esté habilitado en Supabase.');
      return;
    }
    this.pendingFactorId.set(id);
    this.totpSecret.set(secret);
    this.qrSafeUrl.set(this.sanitizer.bypassSecurityTrustUrl(qr));
    this.enrollOpen.set(true);
    this.confirmForm.reset({ code: '' });
  }

  async confirmEnroll(): Promise<void> {
    const factorId = this.pendingFactorId();
    if (!factorId) {
      this.errorMessage.set('Reiniciá el proceso de activación.');
      return;
    }
    this.errorMessage.set(null);
    if (this.confirmForm.invalid) {
      this.confirmForm.markAllAsTouched();
      return;
    }
    const code = this.confirmForm.controls.code.value.replace(/\s/g, '');
    this.saving.set(true);
    const ch = await this.auth.mfaChallenge(factorId);
    if (ch.error || !ch.data?.id) {
      this.saving.set(false);
      this.errorMessage.set(ch.error ? mapAuthError(ch.error.message) : 'No se pudo generar el desafío. Probá de nuevo.');
      return;
    }
    const { error } = await this.auth.mfaVerify(factorId, ch.data.id, code);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    this.successMessage.set('Autenticación en dos pasos activada.');
    this.enrollOpen.set(false);
    this.qrSafeUrl.set(null);
    this.totpSecret.set(null);
    this.pendingFactorId.set(null);
    this.confirmForm.reset({ code: '' });
    await this.refreshFactors();
  }

  async cancelStuckEnrollment(): Promise<void> {
    const id = this.stuckUnverifiedFactorId();
    if (!id) {
      return;
    }
    this.saving.set(true);
    await this.auth.mfaUnenroll(id);
    this.saving.set(false);
    await this.refreshFactors();
  }

  async cancelPending(): Promise<void> {
    const id = this.pendingFactorId();
    if (!id) {
      return;
    }
    this.saving.set(true);
    await this.auth.mfaUnenroll(id);
    this.saving.set(false);
    this.enrollOpen.set(false);
    this.qrSafeUrl.set(null);
    this.totpSecret.set(null);
    this.pendingFactorId.set(null);
    await this.refreshFactors();
  }

  async disableMfa(): Promise<void> {
    const f = this.verifiedFactor();
    if (!f) {
      return;
    }
    if (!globalThis.confirm('¿Desactivar el segundo factor? Tu cuenta quedará solo con contraseña.')) {
      return;
    }
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.saving.set(true);
    const { error } = await this.auth.mfaUnenroll(f.id);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    this.successMessage.set('2FA desactivado.');
    await this.refreshFactors();
  }
}
