import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

const BUCKET = 'product-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@Injectable({ providedIn: 'root' })
export class ProductImagesService {
  private readonly supabase = inject(SupabaseService);

  publicUrl(path: string | null | undefined): string | null {
    if (!path) {
      return null;
    }
    const { data } = this.supabase.client.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  }

  async uploadProductImage(params: {
    companyId: string;
    productId: string;
    file: File;
    previousPath?: string | null;
  }): Promise<{ path: string | null; error: string | null }> {
    const file = params.file;
    if (!ALLOWED.has(file.type)) {
      return { path: null, error: 'Usá JPG, PNG, WEBP o GIF.' };
    }
    if (file.size > MAX_BYTES) {
      return { path: null, error: 'La imagen no puede superar 5 MB.' };
    }

    const ext = this.extensionFor(file);
    const path = `${params.companyId}/${params.productId}/${Date.now()}.${ext}`;

    const { error: upErr } = await this.supabase.client.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    if (upErr) {
      return { path: null, error: upErr.message };
    }

    const { error: updErr } = await this.supabase.client
      .from('products')
      .update({ image_path: path })
      .eq('id', params.productId)
      .eq('company_id', params.companyId);

    if (updErr) {
      await this.supabase.client.storage.from(BUCKET).remove([path]);
      return { path: null, error: updErr.message };
    }

    if (params.previousPath && params.previousPath !== path) {
      await this.supabase.client.storage.from(BUCKET).remove([params.previousPath]);
    }

    return { path, error: null };
  }

  async removeProductImage(params: {
    companyId: string;
    productId: string;
    path: string;
  }): Promise<{ error: string | null }> {
    const { error: updErr } = await this.supabase.client
      .from('products')
      .update({ image_path: null })
      .eq('id', params.productId)
      .eq('company_id', params.companyId);
    if (updErr) {
      return { error: updErr.message };
    }
    await this.supabase.client.storage.from(BUCKET).remove([params.path]);
    return { error: null };
  }

  private extensionFor(file: File): string {
    switch (file.type) {
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'image/gif':
        return 'gif';
      default:
        return 'jpg';
    }
  }
}
