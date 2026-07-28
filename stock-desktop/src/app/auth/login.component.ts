import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { mapAuthError } from './auth-messages';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly googleLoading = signal(false);
  readonly mfaLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly mfaStep = signal(false);
  private mfaFactorId: string | null = null;

  constructor() {
    const oauthError = this.route.snapshot.queryParamMap.get('oauth_error');
    if (oauthError) {
      this.errorMessage.set(decodeURIComponent(oauthError.replace(/\+/g, ' ')));
      if (typeof history !== 'undefined') {
        history.replaceState(null, '', '/auth/login');
      }
    }
  }

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  readonly mfaForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { error } = await this.auth.signIn(this.form.controls.email.value, this.form.controls.password.value);
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    const mfa = await this.auth.prepareTotpLoginStep();
    if (mfa.ok) {
      this.mfaFactorId = mfa.factorId;
      this.mfaForm.reset({ code: '' });
      this.mfaStep.set(true);
      return;
    }
    await this.postLoginNavigate();
  }

  async submitMfa(): Promise<void> {
    this.errorMessage.set(null);
    if (this.mfaForm.invalid || !this.mfaFactorId) {
      this.mfaForm.markAllAsTouched();
      return;
    }
    const factorId = this.mfaFactorId;
    const code = this.mfaForm.controls.code.value.replace(/\s/g, '');
    this.mfaLoading.set(true);
    const challengeRes = await this.auth.mfaChallenge(factorId);
    if (challengeRes.error || !challengeRes.data?.id) {
      this.mfaLoading.set(false);
      this.errorMessage.set(
        challengeRes.error ? mapAuthError(challengeRes.error.message) : 'No se pudo validar el código. Probá de nuevo.',
      );
      return;
    }
    const { error } = await this.auth.mfaVerify(factorId, challengeRes.data.id, code);
    this.mfaLoading.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    this.resetMfaUi();
    await this.postLoginNavigate();
  }

  async cancelMfaAndSignOut(): Promise<void> {
    await this.auth.signOut();
    this.resetMfaUi();
    this.errorMessage.set(null);
  }

  private resetMfaUi(): void {
    this.mfaStep.set(false);
    this.mfaFactorId = null;
    this.mfaForm.reset({ code: '' });
  }

  private async postLoginNavigate(): Promise<void> {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/app/companies';
    const url = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app/companies';
    await this.router.navigateByUrl(url);
  }

  async signInWithGoogle(): Promise<void> {
    this.errorMessage.set(null);
    this.googleLoading.set(true);
    const { error } = await this.auth.signInWithGoogle();
    if (error) {
      this.googleLoading.set(false);
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
  }
}
