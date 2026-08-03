import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { AuthService } from './auth/auth.service';
import { SessionService } from './core/session.service';
import { ThemeService } from './core/theme.service';
import { avatarFromUserMetadata, resolveAvatarUrl } from './shared/avatar-url';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);
  private readonly theme = inject(ThemeService);

  protected readonly session = this.sessionService.session;
  protected readonly userMenuOpen = signal(false);
  protected readonly themeResolved = this.theme.resolved;

  protected readonly userLabel = computed(() => {
    const user = this.session()?.user;
    if (!user) {
      return 'Cuenta';
    }
    const meta = user.user_metadata ?? {};
    const fromMeta =
      (typeof meta['full_name'] === 'string' && meta['full_name'].trim()) ||
      (typeof meta['name'] === 'string' && meta['name'].trim()) ||
      '';
    if (fromMeta) {
      return fromMeta.split(/\s+/)[0] ?? fromMeta;
    }
    return user.email?.split('@')[0]?.trim() || 'Cuenta';
  });

  protected readonly userAvatarUrl = computed(() => {
    const user = this.session()?.user;
    if (!user) {
      return null;
    }
    return resolveAvatarUrl({
      avatarUrl: avatarFromUserMetadata(user.user_metadata as Record<string, unknown>),
      email: user.email,
      size: 64,
    });
  });

  protected readonly userInitial = computed(() => {
    const label = this.userLabel();
    return (label[0] ?? 'C').toUpperCase();
  });

  protected readonly themeMenuLabel = computed(() =>
    this.themeResolved() === 'dark' ? 'Modo claro' : 'Modo oscuro',
  );

  protected readonly isMarketing = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => this.isMarketingUrl(e.urlAfterRedirects)),
      startWith(this.isMarketingUrl(this.router.url)),
    ),
    { initialValue: this.isMarketingUrl(this.router.url) },
  );

  protected readonly isHome = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => this.isHomeUrl(e.urlAfterRedirects)),
      startWith(this.isHomeUrl(this.router.url)),
    ),
    { initialValue: this.isHomeUrl(this.router.url) },
  );

  constructor() {
    // Hydrate theme preference after bootstrap (pairs with index.html anti-flash script).
    void this.theme;
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.userMenuOpen.set(false));
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.userMenuOpen()) {
      this.userMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
  }

  private isMarketingUrl(url: string): boolean {
    const path = url.split('?')[0] ?? url;
    return path === '/' || path.startsWith('/auth');
  }

  private isHomeUrl(url: string): boolean {
    const path = url.split('?')[0] ?? url;
    return path === '/';
  }

  toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.userMenuOpen.update((v) => !v);
  }

  keepMenuOpen(event: Event): void {
    event.stopPropagation();
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  toggleTheme(event: Event): void {
    event.stopPropagation();
    this.theme.toggleLightDark();
  }

  async signOut(): Promise<void> {
    this.userMenuOpen.set(false);
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
