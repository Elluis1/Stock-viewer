export type CompanyRow = {
  id: string;
  name: string;
  created_at: string;
  reporting_timezone?: string;
};

export type CompanyMemberRole = 'owner' | 'admin' | 'member';

export type CompanyMemberRow = {
  id: string;
  company_id: string;
  user_id: string;
  role: CompanyMemberRole;
  email: string | null;
  created_at: string;
};

export type CompanyInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type CompanyInviteRow = {
  id: string;
  company_id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  status: CompanyInviteStatus;
  expires_at: string;
  created_at: string;
};

export type CreateInviteResult = {
  id: string;
  token: string;
  email: string;
  role: 'admin' | 'member';
  expires_at: string;
};

export type InvitePreview = {
  email: string;
  role: 'admin' | 'member';
  status: CompanyInviteStatus;
  expires_at: string;
  company_name: string | null;
  expired: boolean;
};

export type ProductRow = {
  id: string;
  company_id: string;
  name: string;
  sku: string | null;
  unit: string;
  created_at: string;
  default_cost_unit: number | string | null;
  default_sale_price_unit: number | string | null;
};

/** Fila de la vista `product_inventory_snapshot` (Supabase). */
export type InventorySnapshotRow = {
  product_id: string;
  company_id: string;
  name: string;
  sku: string | null;
  unit: string;
  default_cost_unit: number | string | null;
  default_sale_price_unit: number | string | null;
  quantity_on_hand: string | number;
  last_purchase_unit_cost: string | number | null;
};

/** Fila de listado de movimientos (join opcional a producto). */
export type MovementListRow = {
  id: string;
  created_at: string;
  movement_type: string;
  quantity: string | number;
  unit_cost: number | string | null;
  unit_sale_price: number | string | null;
  unit_cost_at_sale: number | string | null;
  note: string | null;
  /** PostgREST puede devolver objeto o array según relación. */
  products: { name: string } | { name: string }[] | null;
};

export type CompanyPeriodFinancialRow = {
  company_id: string;
  sales_revenue: number | string | null;
  purchase_spend: number | string | null;
  gross_profit: number | string | null;
};

export type CompanyMonthlyFinancialRow = CompanyPeriodFinancialRow & {
  report_year: number;
  report_month: number;
};

export type CompanyYearlyFinancialRow = CompanyPeriodFinancialRow & {
  report_year: number;
};

export type CompanyProductMonthlySalesRow = {
  company_id: string;
  report_year: number;
  report_month: number;
  product_id: string;
  product_name: string;
  units_sold: number | string;
  sales_revenue: number | string;
  gross_profit: number | string;
};
