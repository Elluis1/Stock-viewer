import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../core/supabase.service';
import type {
  CompanyInviteRow,
  CompanyMemberRow,
  CreateInviteResult,
  InvitePreview,
} from '../models/stock.types';

@Injectable({ providedIn: 'root' })
export class CompanyTeamService {
  private readonly supabase = inject(SupabaseService);

  listMembers(companyId: string) {
    return this.supabase.client
      .from('company_members')
      .select('id,company_id,user_id,role,email,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
  }

  listPendingInvites(companyId: string) {
    return this.supabase.client
      .from('company_invites')
      .select('id,company_id,email,role,token,status,expires_at,created_at')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
  }

  createInvite(companyId: string, email: string, role: 'admin' | 'member') {
    return this.supabase.client.rpc('create_company_invite', {
      p_company_id: companyId,
      p_email: email,
      p_role: role,
      p_expires_days: 7,
    });
  }

  /** Envía el mail vía Edge Function (Resend). */
  sendInviteEmail(inviteId: string, inviteUrl: string) {
    return this.supabase.client.functions.invoke('send-company-invite', {
      body: { invite_id: inviteId, invite_url: inviteUrl },
    });
  }

  revokeInvite(inviteId: string) {
    return this.supabase.client.rpc('revoke_company_invite', {
      p_invite_id: inviteId,
    });
  }

  updateMemberRole(memberId: string, role: 'owner' | 'admin' | 'member') {
    return this.supabase.client.rpc('update_company_member_role', {
      p_member_id: memberId,
      p_role: role,
    });
  }

  removeMember(memberId: string) {
    return this.supabase.client.rpc('remove_company_member', {
      p_member_id: memberId,
    });
  }

  acceptInvite(token: string) {
    return this.supabase.client.rpc('accept_company_invite', {
      p_token: token,
    });
  }

  getInvitePreview(token: string) {
    return this.supabase.client.rpc('get_company_invite_preview', {
      p_token: token,
    });
  }

  inviteLink(token: string): string {
    const origin =
      typeof globalThis !== 'undefined' && 'location' in globalThis
        ? (globalThis as unknown as { location: { origin: string } }).location.origin
        : '';
    return `${origin}/auth/invitar?token=${encodeURIComponent(token)}`;
  }

  /** mailto corto (Windows falla con bodies largos). */
  inviteMailto(params: {
    toEmail: string;
    companyName: string;
    inviteUrl: string;
  }): string {
    const subject = encodeURIComponent(`Invitación: ${params.companyName}`);
    const body = encodeURIComponent(
      `Te invitaron a "${params.companyName}" en Stock Desktop.\n\n` +
        `Abrí el link (registrate con ${params.toEmail} si no tenés cuenta):\n` +
        `${params.inviteUrl}\n`,
    );
    // No encodear el email del "to": algunos clientes rompen user%40dominio
    return `mailto:${params.toEmail}?subject=${subject}&body=${body}`;
  }

  /** Abre mailto de forma fiable en Windows / Netlify. */
  openMailto(mailto: string): void {
    if (!mailto) {
      return;
    }
    // location.href es más fiable que click() en un <a> oculto
    try {
      globalThis.location.href = mailto;
    } catch {
      const a = document.createElement('a');
      a.href = mailto;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  asMembers(data: unknown): CompanyMemberRow[] {
    return (data ?? []) as CompanyMemberRow[];
  }

  asInvites(data: unknown): CompanyInviteRow[] {
    return (data ?? []) as CompanyInviteRow[];
  }

  asCreateInviteResult(data: unknown): CreateInviteResult | null {
    return (data as CreateInviteResult) ?? null;
  }

  asInvitePreview(data: unknown): InvitePreview | null {
    return (data as InvitePreview) ?? null;
  }
}
