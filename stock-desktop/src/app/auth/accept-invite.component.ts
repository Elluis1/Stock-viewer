import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyTeamService } from '../core/company-team.service';
import { SessionService } from '../core/session.service';
import { SupabaseService } from '../core/supabase.service';
import type { InvitePreview } from '../models/stock.types';

@Component({
  selector: 'app-accept-invite',
  imports: [RouterLink],
  templateUrl: './accept-invite.component.html',
  styleUrl: './accept-invite.component.scss',
})
export class AcceptInviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly team = inject(CompanyTeamService);
  private readonly sessionService = inject(SessionService);
  private readonly supabase = inject(SupabaseService);

  readonly token = signal<string | null>(null);
  readonly preview = signal<InvitePreview | null>(null);
  readonly loading = signal(true);
  readonly accepting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly hasSession = signal(false);

  get loginReturnUrl(): string {
    const t = this.token();
    return t ? `/auth/invitar?token=${encodeURIComponent(t)}` : '/auth/invitar';
  }

  get registerQueryParams(): Record<string, string> {
    const params: Record<string, string> = { returnUrl: this.loginReturnUrl };
    const email = this.preview()?.email;
    if (email) {
      params['email'] = email;
    }
    return params;
  }

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token')?.trim() || null;
    this.token.set(token);
    if (!token) {
      this.loading.set(false);
      this.errorMessage.set('Falta el token de invitación en el link.');
      return;
    }

    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();
    this.hasSession.set(!!session);
    if (session) {
      this.sessionService.session.set(session);
    }

    const { data, error } = await this.team.getInvitePreview(token);
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    const preview = this.team.asInvitePreview(data);
    if (!preview) {
      this.errorMessage.set('Invitación no encontrada.');
      return;
    }
    this.preview.set(preview);
  }

  async accept(): Promise<void> {
    const token = this.token();
    if (!token) {
      return;
    }
    this.errorMessage.set(null);
    this.accepting.set(true);
    const { data, error } = await this.team.acceptInvite(token);
    this.accepting.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    const companyId = data as string;
    this.successMessage.set('Te uniste a la empresa.');
    await this.router.navigate(['/app/companies', companyId, 'products']);
  }
}
