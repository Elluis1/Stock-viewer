import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AuthLayoutComponent } from './auth/auth-layout.component';
import { LoginComponent } from './auth/login.component';
import { RegisterComponent } from './auth/register.component';
import { AuthCallbackComponent } from './auth/auth-callback.component';
import { AuthMfaOauthComponent } from './auth/auth-mfa-oauth.component';
import { authGuard } from './core/auth.guard';
import { redirectIfAuthenticatedGuard } from './core/redirect-if-authenticated.guard';
import { CompanyListComponent } from './pages/companies/company-list.component';
import { CompanyNewComponent } from './pages/companies/company-new.component';
import { CompanyEditComponent } from './pages/companies/company-edit.component';
import { ProductListComponent } from './pages/products/product-list.component';
import { CompanyMovesComponent } from './pages/moves/company-moves.component';
import { CompanySummaryComponent } from './pages/summary/company-summary.component';
import { MfaSetupComponent } from './pages/security/mfa-setup.component';
import { CompanyTeamComponent } from './pages/companies/company-team.component';
import { AcceptInviteComponent } from './auth/accept-invite.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, canActivate: [redirectIfAuthenticatedGuard] },
  {
    path: 'app',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'companies' },
      { path: 'companies', component: CompanyListComponent },
      { path: 'companies/new', component: CompanyNewComponent },
      { path: 'companies/:companyId/editar', component: CompanyEditComponent },
      { path: 'companies/:companyId/products', component: ProductListComponent },
      { path: 'companies/:companyId/movimientos', component: CompanyMovesComponent },
      { path: 'companies/:companyId/resumen', component: CompanySummaryComponent },
      { path: 'companies/:companyId/equipo', component: CompanyTeamComponent },
      { path: 'seguridad', component: MfaSetupComponent },
    ],
  },
  {
    path: 'auth',
    children: [
      { path: 'callback', component: AuthCallbackComponent },
      {
        path: '',
        component: AuthLayoutComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'login' },
          { path: 'login', component: LoginComponent },
          { path: 'register', component: RegisterComponent },
          { path: 'verificar-2fa', component: AuthMfaOauthComponent },
          { path: 'invitar', component: AcceptInviteComponent },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
