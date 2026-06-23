// api/src/types/index.ts
/**
 * Shared TypeScript types
 * Mirrors the PostgreSQL enums and table shapes exactly.
 * Keep in sync with migrations.
 */

export type { RLSContext } from '../db';

// ─── ENUMS (mirror schema exactly) ───────────────────────────────────────────

export type CompanyPaymentMethod = 'bank_paybill' | 'daraja_stk' | 'cash' | 'manual';
export type ProrationType = 'always' | 'after_cutoff' | 'never';
export type ProrationMethod = 'actual_days' | 'standard_30';
export type MoveOutProrationType = 'full_month' | 'to_notice_date' | 'to_actual_date';
export type LeaseStatus = 'draft' | 'active' | 'notice' | 'terminated' | 'expired';
export type BillStatus =
  | 'draft'
  | 'open'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'payment_received_pending_verification'
  | 'waived'
  | 'void';
export type PaymentChannel =
  | 'mpesa_stk'
  | 'mpesa_paybill'
  | 'cash'
  | 'bank_transfer'
  | 'adjustment'
  | 'reversal';
export type StkStatus = 'pending' | 'confirmed' | 'failed' | 'expired' | 'cancelled';
export type NotificationChannel = 'sms' | 'email' | 'whatsapp';
export type NotificationStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'cancelled'
  | 'permanent_failure';
export type UserRole = 'super_admin' | 'owner' | 'manager' | 'finance' | 'caretaker' | 'tenant' | 'landlord_client';
export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';
export type UnmatchedPaymentResolution = 'assigned' | 'wrong_property' | 'written_off' | 'pending';

// ─── ENTITY TYPES ────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  tradingName: string | null;
  registrationNumber: string | null;
  kraPin: string | null;
  phone: string;
  email: string;
  address: string | null;
  county: string | null;
  logoUrl: string | null;
  paymentMethod: CompanyPaymentMethod;
  paybillNumber: string | null;
  paybillAccountFormat: string | null;
  tillNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranch: string | null;
  moveInProrationType: ProrationType | null;
  moveInProrationCutoff: number | null;
  moveInProrationMethod: ProrationMethod | null;
  moveOutProrationType: MoveOutProrationType | null;
  billFirstPartialMonth: boolean;
  minProrationThreshold: number;
  dueDay: number;
  gracePeriodDays: number;
  penaltyType: 'none' | 'flat' | 'percentage';
  penaltyValue: number;
  penaltyAppliesAfterDays: number;
  smsSenderId: string | null;
  reminderDaysBefore: number[];
  reminderDaysAfter: number[];
  setupCompleted: boolean;
  setupCurrentStep: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface User {
  id: string;
  companyId: string | null;
  role: UserRole;
  email: string;
  phone: string | null;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  notifySms: boolean;
  notifyEmail: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Property {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  totalUnits: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Unit {
  id: string;
  propertyId: string;
  companyId: string;
  unitNumber: string;
  unitType: string | null;
  floorNumber: number | null;
  sizeSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  isOccupied: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tenant {
  id: string;
  companyId: string;
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string;
  phoneMpesa: string | null;
  nationalId: string | null;
  kraPin: string | null;
  companyName: string | null;
  isCorporate: boolean;
  notifySms: boolean;
  notifyEmail: boolean;
  notificationMode: 'per_unit' | 'consolidated';
  createdAt: Date;
  updatedAt: Date;
}

export interface Lease {
  id: string;
  companyId: string;
  unitId: string;
  primaryTenantId: string;
  status: LeaseStatus;
  startDate: string;       // ISO date
  endDate: string | null;
  monthlyRent: number;
  depositAmount: number;
  depositPaidAt: string | null;
  depositPaidAmount: number;
  noticePeriodDays: number;
  firstBillGenerated: boolean;
  firstBillId: string | null;
  // Proration snapshots
  snapMoveInProrationType: ProrationType | null;
  snapMoveInProrationCutoff: number | null;
  snapMoveInProrationMethod: ProrationMethod | null;
  snapMoveOutProrationType: MoveOutProrationType | null;
  snapBillFirstPartialMonth: boolean | null;
  snapMinProrationThreshold: number | null;
  // Payment snapshots
  snapPaymentMethod: CompanyPaymentMethod | null;
  snapPaybillNumber: string | null;
  snapAccountReference: string | null;
  // Employee benefit
  isEmployeeBenefit: boolean;
  employeeId: string | null;
  // Vacate
  vacateNoticeDate: string | null;
  statedMoveOutDate: string | null;
  actualMoveOutDate: string | null;
  // Audit
  createdBy: string | null;
  activatedAt: Date | null;
  terminatedAt: Date | null;
  terminationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonthlyBill {
  id: string;
  companyId: string;
  leaseId: string;
  unitId: string;
  forMonth: string;        // ISO date, always 1st of month
  dueDate: string;
  billType: 'rent' | 'signing' | 'utility' | 'penalty' | 'adjustment';
  rentAmount: number;
  utilityAmount: number;
  penaltyAmount: number;
  adjustmentAmount: number;
  totalAmount: number;     // computed
  totalPaid: number;
  totalDue: number;        // computed
  isProrated: boolean;
  proratedDays: number | null;
  prorationDaysInMonth: number | null;
  prorationMethod: ProrationMethod | null;
  prorationDescription: string | null;
  status: BillStatus;
  snapPaymentMethod: CompanyPaymentMethod;
  snapPaybillNumber: string | null;
  snapAccountReference: string | null;
  stkLockUntil: Date | null;
  generatedBy: 'cron' | 'manual' | 'system';
  createdBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  companyId: string;
  billId: string;
  leaseId: string;
  amount: number;
  channel: PaymentChannel;
  mpesaReceiptNumber: string | null;
  mpesaPhone: string | null;
  mpesaTransactionDate: Date | null;
  bankTransactionRef: string | null;
  bankName: string | null;
  bankTransactionDate: string | null;
  csvImportBatchId: string | null;
  recordedBy: string | null;
  recordedAt: Date | null;
  receiptNumber: string | null;
  undoExpiresAt: Date | null;
  undoneAt: Date | null;
  undoneBy: string | null;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── API RESPONSE SHAPES ──────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
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
    field?: string;       // for validation errors
    details?: unknown;
  };
}

// ─── PRORATION ENGINE OUTPUT ──────────────────────────────────────────────────

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

// ─── RLS CONTEXT (attached to every request) ─────────────────────────────────

export interface RequestContext {
  companyId: string;
  userId: string;
  userRole: UserRole;
  user: User;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}