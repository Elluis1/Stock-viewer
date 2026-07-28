import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { SupabaseService } from '../core/supabase.service';
import { mapAuthError } from './auth-messages';

/**
 * Segundo paso MFA tras OAuth (Google): la sesión existe pero puede faltar AAL2.
 */
@Component({
  selector: 'app-auth-mfa-oauth',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './auth-mfa-oauth.component.html',
  styleUrl: './auth-mfa-oauth.component.scss',
})
export class AuthMfaOauthComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  private factorId: string | null = null;

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  async ngOnInit(): Promise<void> {
    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();
    if (!session) {
      await this.router.navigate(['/auth/login']);
      return;
    }
    const step = await this.auth.prepareTotpLoginStep();
    this.loading.set(false);
    if (!step.ok) {
      await this.router.navigateByUrl('/app/companies');
      return;
    }
    this.factorId = step.factorId;
  }

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    if (this.form.invalid || !this.factorId) {
      this.form.markAllAsTouched();
      return;
    }
    const code = this.form.controls.code.value.replace(/\s/g, '');
    this.submitting.set(true);
    const challengeRes = await this.auth.mfaChallenge(this.factorId);
    if (challengeRes.error || !challengeRes.data?.id) {
      this.submitting.set(false);
      this.errorMessage.set(
        challengeRes.error ? mapAuthError(challengeRes.error.message) : 'No se pudo validar el código.',
      );
      return;
    }
    const { error } = await this.auth.mfaVerify(this.factorId, challengeRes.data.id, code);
    this.submitting.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    await this.router.navigateByUrl('/app/companies');
  }

  async cancel(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/auth/login']);
  }
}
