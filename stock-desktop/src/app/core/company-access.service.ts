import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';
import { SupabaseService } from './supabase.service';
import type { CompanyMemberRole } from '../models/stock.types';

/**
 * Permisos de UI por rol en una empresa.
 *
 * - owner: todo (equipo, catálogo, stock, settings)
 * - admin: equipo, catálogo, stock, settings (no se auto-elimina; no degrada owners desde UI)
 * - member: operar stock (compras/ventas) y ver; sin catálogo, sin settings, sin gestionar equipo
 */
@Injectable({ providedIn: 'root' })
export class CompanyAccessService {
  private readonly supabase = inject(SupabaseService);
  private readonly sessionService = inject(SessionService);

  async getMyRole(companyId: string): Promise<CompanyMemberRole | null> {
    const uid = this.sessionService.session()?.user?.id;
    if (!uid) {
      const {
        data: { session },
      } = await this.supabase.client.auth.getSession();
      if (!session?.user?.id) {
        return null;
      }
      this.sessionService.session.set(session);
      return this.fetchRole(companyId, session.user.id);
    }
    return this.fetchRole(companyId, uid);
  }

  /** Mapa companyId → rol del usuario actual (para listados). */
  async getMyRolesByCompany(): Promise<Map<string, CompanyMemberRole>> {
    const map = new Map<string, CompanyMemberRole>();
    let uid = this.sessionService.session()?.user?.id;
    if (!uid) {
      const {
        data: { session },
      } = await this.supabase.client.auth.getSession();
      uid = session?.user?.id;
      if (session) {
        this.sessionService.session.set(session);
      }
    }
    if (!uid) {
      return map;
    }
    const { data, error } = await this.supabase.client
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', uid);
    if (error || !data) {
      return map;
    }
    for (const row of data) {
      const role = row.role as CompanyMemberRole;
      if (role === 'owner' || role === 'admin' || role === 'member') {
        map.set(row.company_id as string, role);
      }
    }
    return map;
  }

  canManageTeam(role: CompanyMemberRole | null): boolean {
    return role === 'owner' || role === 'admin';
  }

  /** Alta de productos y precios por defecto. */
  canManageCatalog(role: CompanyMemberRole | null): boolean {
    return role === 'owner' || role === 'admin';
  }

  /** Compras y ventas del día a día. */
  canOperateStock(role: CompanyMemberRole | null): boolean {
    return role === 'owner' || role === 'admin' || role === 'member';
  }

  /** Zona horaria / settings de empresa (alineado a RLS owner|admin). */
  canEditCompanySettings(role: CompanyMemberRole | null): boolean {
    return role === 'owner' || role === 'admin';
  }

  roleLabel(role: CompanyMemberRole | null | undefined): string {
    switch (role) {
      case 'owner':
        return 'Owner';
      case 'admin':
        return 'Admin';
      case 'member':
        return 'Miembro';
      default:
        return '—';
    }
  }

  private async fetchRole(companyId: string, userId: string): Promise<CompanyMemberRole | null> {
    const { data, error } = await this.supabase.client
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    const role = data.role as CompanyMemberRole;
    return role === 'owner' || role === 'admin' || role === 'member' ? role : null;
  }
}
