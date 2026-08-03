import { DatePipe } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { CompanyTeamService } from '../../core/company-team.service';
import { SessionService } from '../../core/session.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyInviteRow, CompanyMemberRole, CompanyMemberRow } from '../../models/stock.types';
import { resolveAvatarUrl } from '../../shared/avatar-url';

@Component({
  selector: 'app-company-team',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  templateUrl: './company-team.component.html',
  styleUrl: './company-team.component.scss',
})
export class CompanyTeamComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService);
  private readonly team = inject(CompanyTeamService);
  private readonly access = inject(CompanyAccessService);
  private readonly sessionService = inject(SessionService);
  private readonly fb = inject(FormBuilder);

  readonly companyId = signal<string | null>(null);
  readonly companyName = signal<string | null>(null);
  readonly members = signal<CompanyMemberRow[]>([]);
  readonly invites = signal<CompanyInviteRow[]>([]);
  readonly myRole = signal<CompanyMemberRole | null>(null);
  readonly myUserId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly sendingEmail = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly lastInviteId = signal<string | null>(null);
  readonly lastInviteLink = signal<string | null>(null);
  readonly lastInviteEmail = signal<string | null>(null);
  readonly lastMailto = signal<string | null>(null);
  readonly inviteModalOpen = signal(false);

  readonly inviteForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['member' as 'admin' | 'member', [Validators.required]],
  });

  get canManageTeam(): boolean {
    return this.access.canManageTeam(this.myRole());
  }

  get isOwner(): boolean {
    return this.myRole() === 'owner';
  }

  roleLabel(role: string | null | undefined): string {
    return this.access.roleLabel((role as CompanyMemberRole) ?? null);
  }

  memberInitial(emailOrId: string): string {
    const raw = (emailOrId || '?').trim();
    return (raw[0] ?? '?').toUpperCase();
  }

  memberAvatarUrl(m: { email?: string | null; avatar_url?: string | null }): string | null {
    return resolveAvatarUrl({
      avatarUrl: m.avatar_url,
      email: m.email,
      size: 80,
    });
  }

  inviteAvatarUrl(email: string): string | null {
    return resolveAvatarUrl({ email, size: 80 });
  }

  avatarTone(value: string): number {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = (h + value.charCodeAt(i) * (i + 1)) % 5;
    }
    return h;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.inviteModalOpen()) {
      this.closeInviteModal();
    }
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  openInviteModal(): void {
    this.errorMessage.set(null);
    this.inviteModalOpen.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeInviteModal(): void {
    this.inviteModalOpen.set(false);
    document.body.style.overflow = '';
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('companyId');
    this.companyId.set(id);
    if (!id) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no encontrada.');
      return;
    }
    await this.load();
  }

  async load(): Promise<void> {
    const id = this.companyId();
    if (!id) {
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);

    const companyRes = await this.supabase.client.from('companies').select('id,name').eq('id', id).maybeSingle();
    if (companyRes.error || !companyRes.data) {
      this.loading.set(false);
      this.errorMessage.set(companyRes.error?.message ?? 'No se pudo cargar la empresa.');
      this.companyName.set(null);
      return;
    }
    this.companyName.set(companyRes.data.name);

    const [membersRes, invitesRes] = await Promise.all([
      this.team.listMembers(id),
      this.team.listPendingInvites(id),
    ]);

    this.loading.set(false);

    if (membersRes.error) {
      this.errorMessage.set(membersRes.error.message);
      return;
    }

    const members = this.team.asMembers(membersRes.data);
    this.members.set(members);

    const uid = this.sessionService.session()?.user?.id ?? null;
    this.myUserId.set(uid);
    const mine = uid ? members.find((m) => m.user_id === uid) : undefined;
    this.myRole.set(mine?.role ?? null);

    if (invitesRes.error) {
      this.invites.set([]);
    } else {
      this.invites.set(this.team.asInvites(invitesRes.data));
    }
  }

  /** ¿Se puede mostrar "Quitar" para este miembro? */
  canRemoveMember(m: CompanyMemberRow): boolean {
    if (!this.canManageTeam) {
      return false;
    }
    // Nadie se quita a sí mismo; el owner nunca sale de la empresa por este botón
    if (m.user_id === this.myUserId()) {
      return false;
    }
    // Admin no puede quitar a un owner
    if (m.role === 'owner' && !this.isOwner) {
      return false;
    }
    return true;
  }

  canChangeRole(m: CompanyMemberRow): boolean {
    // Solo el owner cambia roles; no cambia el suyo desde el select (evita auto-degradarse por error)
    return this.isOwner && m.user_id !== this.myUserId();
  }

  async submitInvite(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.lastInviteId.set(null);
    this.lastInviteLink.set(null);
    this.lastInviteEmail.set(null);
    this.lastMailto.set(null);
    if (!this.canManageTeam) {
      this.errorMessage.set('No tenés permiso para invitar.');
      return;
    }
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const id = this.companyId();
    if (!id) {
      return;
    }

    this.saving.set(true);
    const { data, error } = await this.team.createInvite(
      id,
      this.inviteForm.controls.email.value.trim(),
      this.inviteForm.controls.role.value,
    );
    this.saving.set(false);

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    const created = this.team.asCreateInviteResult(data);
    if (created?.token && created.id) {
      const link = this.team.inviteLink(created.token);
      const mailto = this.team.inviteMailto({
        toEmail: created.email,
        companyName: this.companyName() ?? 'la empresa',
        inviteUrl: link,
      });
      this.lastInviteId.set(created.id);
      this.lastInviteLink.set(link);
      this.lastInviteEmail.set(created.email);
      this.lastMailto.set(mailto);
      this.inviteForm.reset({ email: '', role: 'member' });
      this.closeInviteModal();
      await this.load();
      await this.sendEmailForLastInvite();
    } else {
      this.successMessage.set('Invitación creada.');
      this.inviteForm.reset({ email: '', role: 'member' });
      this.closeInviteModal();
      await this.load();
    }
  }

  async sendEmailForLastInvite(): Promise<void> {
    const inviteId = this.lastInviteId();
    const link = this.lastInviteLink();
    const email = this.lastInviteEmail();
    if (!inviteId || !link || !email) {
      return;
    }
    this.sendingEmail.set(true);
    this.errorMessage.set(null);
    const { data, error } = await this.team.sendInviteEmail(inviteId, link);
    this.sendingEmail.set(false);

    const payload = data as { ok?: boolean; message?: string; error?: string; method?: string } | null;
    if (!error && payload?.ok) {
      if (payload.method === 'supabase_auth_invite') {
        this.successMessage.set(
          `Email enviado a ${email}. Es un mail de invitación de Supabase; al abrirlo llega a aceptar la invitación.`,
        );
      } else if (payload.method === 'supabase_magic_link') {
        this.successMessage.set(
          `Email enviado a ${email}. Es un enlace de acceso; al abrirlo llega a la página de la invitación para aceptar.`,
        );
      } else {
        this.successMessage.set(`Email enviado a ${email}.`);
      }
      return;
    }

    const detail = payload?.message || error?.message || 'sin envío automático';
    this.successMessage.set(
      `Invitación lista para ${email}. No se pudo enviar automático (${detail}). Usá «Abrir en mi correo» o «Copiar link».`,
    );
  }

  async copyLink(): Promise<void> {
    const link = this.lastInviteLink();
    if (!link || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(link);
    this.successMessage.set('Link copiado al portapapeles.');
  }

  async revokeInvite(invite: CompanyInviteRow): Promise<void> {
    if (!globalThis.confirm(`¿Revocar invitación a ${invite.email}?`)) {
      return;
    }
    this.saving.set(true);
    const { error } = await this.team.revokeInvite(invite.id);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    this.successMessage.set('Invitación revocada.');
    await this.load();
  }

  async copyInviteToken(invite: CompanyInviteRow): Promise<void> {
    const link = this.team.inviteLink(invite.token);
    this.lastInviteId.set(invite.id);
    this.lastInviteLink.set(link);
    this.lastInviteEmail.set(invite.email);
    this.lastMailto.set(
      this.team.inviteMailto({
        toEmail: invite.email,
        companyName: this.companyName() ?? 'la empresa',
        inviteUrl: link,
      }),
    );
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(link);
      this.successMessage.set(`Link de ${invite.email} copiado.`);
    }
  }

  async emailInvite(invite: CompanyInviteRow): Promise<void> {
    const link = this.team.inviteLink(invite.token);
    this.lastInviteId.set(invite.id);
    this.lastInviteLink.set(link);
    this.lastInviteEmail.set(invite.email);
    this.lastMailto.set(
      this.team.inviteMailto({
        toEmail: invite.email,
        companyName: this.companyName() ?? 'la empresa',
        inviteUrl: link,
      }),
    );
    await this.sendEmailForLastInvite();
  }

  async onRoleChange(member: CompanyMemberRow, event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as CompanyMemberRole;
    if (value === member.role) {
      return;
    }
    this.saving.set(true);
    const { error } = await this.team.updateMemberRole(member.id, value);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      await this.load();
      return;
    }
    this.successMessage.set('Rol actualizado.');
    await this.load();
  }

  async removeMember(member: CompanyMemberRow): Promise<void> {
    if (!this.canRemoveMember(member)) {
      this.errorMessage.set('No podés quitar a ese miembro.');
      return;
    }
    const label = member.email ?? member.user_id;
    if (!globalThis.confirm(`¿Quitar a ${label} del equipo?`)) {
      return;
    }
    this.saving.set(true);
    const { error } = await this.team.removeMember(member.id);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    this.successMessage.set('Miembro eliminado.');
    await this.load();
  }
}
