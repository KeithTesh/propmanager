// web/src/types/index.ts
/**
 * Web client types
 * Mirror the API response shapes — keep in sync with api/src/types/index.ts
 */

// ─── ENUMS ────────────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'owner' | 'manager' | 'finance' | 'caretaker' | 'tenant' | 'landlord_client';
export type LeaseStatus = 'draft' | 'active' | 'notice' | 'terminated' | 'expired';
export type BillStatus =
  | 'draft' | 'open' | 'partial' | 'paid' | 'overdue'
  | 'payment_received_pending_verification' | 'waived' | 'void';
export type PaymentChannel = 'mpesa_stk' | 'mpesa_paybill' | 'cash' | 'bank_transfer' | 'adjustment' | 'reversal';
export type CompanyPaymentMethod = 'bank_paybill' | 'daraja_stk' | 'cash' | 'manual';
export type ProrationMode = 'always' | 'after_cutoff' | 'never';
export type ProrationMethod = 'actual_days' | 'standard_30';
export type NotificationChannel = 'sms' | 'email' | 'whatsapp';

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  companyId: string | null;
  role: UserRole;
  email: string;
  phone: string | null;
  fullName: string;
  avatarUrl: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;  // only in cookie, not in response body
  expiresIn: number;
}

// ─── COMPANY ─────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  tradingName: string | null;
  phone: string;
  email: string;
  logoUrl: string | null;
  paymentMethod: CompanyPaymentMethod;
  paybillNumber: string | null;
  dueDay: number;
  gracePeriodDays: number;
  penaltyType: 'none' | 'flat' | 'percentage';
  penaltyValue: number;
  moveInProrationMode: ProrationMode | null;
  moveInProrationMethod: ProrationMethod | null;
  moveInProrationCutoff: number | null;
  setupCompleted: boolean;
  setupCurrentStep: number;
}

// ─── PROPERTY ─────────────────────────────────────────────────────────────────

export interface Property {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  county: string | null;
  totalUnits: number | null;
  isActive: boolean;
}

// ─── UNIT ────────────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  propertyId: string;
  unitNumber: string;
  unitType: string | null;
  floorNumber: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  isOccupied: boolean;
  isActive: boolean;
}

// ─── TENANT ──────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  phoneMpesa: string | null;
  nationalId: string | null;
  isCorporate: boolean;
  notifySms: boolean;
  notifyEmail: boolean;
  notificationMode: 'per_unit' | 'consolidated';
}

// ─── LEASE ───────────────────────────────────────────────────────────────────

export interface Lease {
  id: string;
  unitId: string;
  primaryTenantId: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  depositAmount: number;
  depositPaidAmount: number;
  noticePeriodDays: number;
  snapAccountReference: string | null;
  snapPaymentMethod: CompanyPaymentMethod | null;
  snapPaybillNumber: string | null;
  isEmployeeBenefit: boolean;
  // Joined fields
  unitNumber?: string;
  unitType?: string | null;
  propertyId?: string;
  propertyName?: string;
  primaryTenantName?: string;
  primaryTenantPhone?: string;
  primaryTenantMpesa?: string | null;
}

// ─── BILL ────────────────────────────────────────────────────────────────────

export interface Bill {
  id: string;
  leaseId: string;
  unitId: string;
  forMonth: string;
  dueDate: string;
  billType: 'rent' | 'signing' | 'utility' | 'penalty' | 'adjustment';
  rentAmount: number;
  utilityAmount: number;
  penaltyAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
  totalPaid: number;
  totalDue: number;
  status: BillStatus;
  isProrated: boolean;
  proratedDays: number | null;
  prorationDescription: string | null;
  snapAccountReference: string | null;
  snapPaymentMethod: CompanyPaymentMethod;
  snapPaybillNumber: string | null;
  stkLockUntil: string | null;
  // Joined
  unitNumber?: string;
  propertyName?: string;
  tenantName?: string;
  tenantPhone?: string;
  daysOverdue?: number;
}

// ─── PAYMENT ─────────────────────────────────────────────────────────────────

export interface Payment {
  id: string;
  billId: string;
  leaseId: string;
  amount: number;
  channel: PaymentChannel;
  mpesaReceiptNumber: string | null;
  bankTransactionRef: string | null;
  recordedAt: string | null;
  undoExpiresAt: string | null;
  requiresApproval: boolean;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
}

// ─── PRORATION PREVIEW ───────────────────────────────────────────────────────

export interface ProrationResult {
  isProrated: boolean;
  proratedDays: number | null;
  daysInMonth: number | null;
  dailyRate: number | null;
  proratedAmount: number | null;
  fullMonthAmount: number;
  billAmount: number;
  description: string;
}

export interface FirstBillPreview {
  signingBill: ProrationResult & { dueDate: string };
  firstRecurringBill: {
    amount: number;
    forMonth: string;
    dueDate: string;
  };
}

// ─── API RESPONSE ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    perPage?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    field?: string;
    details?: { field: string; message: string }[];
  };
}