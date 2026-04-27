import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AuthLayoutComponent } from './auth/auth-layout.component';
import { LoginComponent } from './auth/login.component';
import { RegisterComponent } from './auth/register.component';
import { AuthCallbackComponent } from './auth/auth-callback.component';
import { authGuard } from './core/auth.guard';
import { CompanyListComponent } from './pages/companies/company-list.component';
import { CompanyNewComponent } from './pages/companies/company-new.component';
import { ProductListComponent } from './pages/products/product-list.component';
import { CompanyMovesComponent } from './pages/moves/company-moves.component';
import { CompanySummaryComponent } from './pages/summary/company-summary.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'app',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'companies' },
      { path: 'companies', component: CompanyListComponent },
      { path: 'companies/new', component: CompanyNewComponent },
      { path: 'companies/:companyId/products', component: ProductListComponent },
      { path: 'companies/:companyId/movimientos', component: CompanyMovesComponent },
      { path: 'companies/:companyId/resumen', component: CompanySummaryComponent },
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
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
