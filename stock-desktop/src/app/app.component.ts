import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { AuthService } from './auth/auth.service';
import { SessionService } from './core/session.service';

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

  protected readonly session = this.sessionService.session;

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

  private isMarketingUrl(url: string): boolean {
    const path = url.split('?')[0] ?? url;
    return path === '/' || path.startsWith('/auth');
  }

  private isHomeUrl(url: string): boolean {
    const path = url.split('?')[0] ?? url;
    return path === '/';
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
