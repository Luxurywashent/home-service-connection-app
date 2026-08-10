# Loan Contract Management System - Technical Plan

## Overview
Build a comprehensive loan management system that allows admins to create, manage, and track loans with automatic payment scheduling, contract generation, digital signatures, and payment reminders.

---

## 1. DATABASE SCHEMA

### Table: `loan_contracts`
```sql
CREATE TABLE loan_contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  loanId VARCHAR(64) NOT NULL UNIQUE,
  borrowerName VARCHAR(255) NOT NULL,
  borrowerEmail VARCHAR(255) NOT NULL,
  borrowerPhone VARCHAR(20),
  principalAmount DECIMAL(12, 2) NOT NULL,
  totalRepaymentAmount DECIMAL(12, 2) NOT NULL,
  interestAmount DECIMAL(12, 2) GENERATED ALWAYS AS (totalRepaymentAmount - principalAmount) STORED,
  numberOfPayments INT NOT NULL,
  paymentFrequency ENUM('weekly', 'biweekly', 'monthly') NOT NULL,
  paymentDayOfWeek INT, -- 0=Sunday, 1=Monday, etc. (for weekly/biweekly)
  paymentDayOfMonth VARCHAR(50), -- "1", "15", "first_thursday", "last_thursday"
  paymentAmount DECIMAL(12, 2) GENERATED ALWAYS AS (totalRepaymentAmount / numberOfPayments) STORED,
  startDate DATE NOT NULL,
  status ENUM('draft', 'pending_signature', 'active', 'completed', 'cancelled') DEFAULT 'draft',
  contractUrl TEXT, -- S3 URL to PDF
  signedContractUrl TEXT, -- S3 URL to signed PDF
  signatureDate DATETIME,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (borrowerEmail),
  INDEX (status),
  INDEX (startDate)
);
```

### Table: `loan_payment_schedules`
```sql
CREATE TABLE loan_payment_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scheduleId VARCHAR(64) NOT NULL UNIQUE,
  loanId VARCHAR(64) NOT NULL,
  paymentNumber INT NOT NULL,
  dueDate DATE NOT NULL,
  amountDue DECIMAL(12, 2) NOT NULL,
  status ENUM('scheduled', 'pending', 'completed', 'missed', 'delayed') DEFAULT 'scheduled',
  reminderSentAt DATETIME,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (loanId) REFERENCES loan_contracts(loanId),
  INDEX (loanId),
  INDEX (dueDate),
  INDEX (status),
  UNIQUE (loanId, paymentNumber)
);
```

### Table: `loan_payments`
```sql
CREATE TABLE loan_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paymentId VARCHAR(64) NOT NULL UNIQUE,
  loanId VARCHAR(64) NOT NULL,
  scheduleId VARCHAR(64),
  paymentNumber INT NOT NULL,
  amountPaid DECIMAL(12, 2) NOT NULL,
  paidDate DATE NOT NULL,
  paymentMethod VARCHAR(50), -- 'bank_transfer', 'check', 'cash', 'credit_card'
  notes TEXT,
  recordedBy VARCHAR(255), -- admin name
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (loanId) REFERENCES loan_contracts(loanId),
  FOREIGN KEY (scheduleId) REFERENCES loan_payment_schedules(scheduleId),
  INDEX (loanId),
  INDEX (paidDate)
);
```

---

## 2. DATA STRUCTURES (TypeScript)

### Loan Contract Type
```typescript
interface LoanContract {
  loanId: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone?: string;
  principalAmount: number;
  totalRepaymentAmount: number;
  interestAmount: number; // calculated
  numberOfPayments: number;
  paymentFrequency: 'weekly' | 'biweekly' | 'monthly';
  paymentDayOfWeek?: number; // 0-6 for weekly/biweekly
  paymentDayOfMonth?: string; // "1", "15", "first_thursday", "last_thursday"
  paymentAmount: number; // calculated
  startDate: Date;
  status: 'draft' | 'pending_signature' | 'active' | 'completed' | 'cancelled';
  contractUrl?: string;
  signedContractUrl?: string;
  signatureDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentSchedule {
  scheduleId: string;
  loanId: string;
  paymentNumber: number;
  dueDate: Date;
  amountDue: number;
  status: 'scheduled' | 'pending' | 'completed' | 'missed' | 'delayed';
  reminderSentAt?: Date;
}

interface LoanPayment {
  paymentId: string;
  loanId: string;
  scheduleId?: string;
  paymentNumber: number;
  amountPaid: number;
  paidDate: Date;
  paymentMethod?: string;
  notes?: string;
  recordedBy: string;
}
```

---

## 3. API ENDPOINTS (tRPC)

### Loan Management Router: `loans`

#### Create Loan
```typescript
loans.createLoan.mutation({
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone?: string;
  principalAmount: number;
  totalRepaymentAmount: number;
  numberOfPayments: number;
  paymentFrequency: 'weekly' | 'biweekly' | 'monthly';
  paymentDayOfWeek?: number;
  paymentDayOfMonth?: string;
  startDate: Date;
}) => LoanContract
```

#### Generate & Send Contract
```typescript
loans.generateAndSendContract.mutation({
  loanId: string;
}) => { contractUrl: string; emailSent: boolean }
```

#### Update Loan Terms
```typescript
loans.updateLoanTerms.mutation({
  loanId: string;
  totalRepaymentAmount?: number;
  numberOfPayments?: number;
  paymentFrequency?: string;
  paymentDayOfWeek?: number;
  paymentDayOfMonth?: string;
}) => LoanContract
```

#### Get Loan Details
```typescript
loans.getLoanDetail.query({
  loanId: string;
}) => {
  contract: LoanContract;
  schedule: PaymentSchedule[];
  payments: LoanPayment[];
  nextPayment?: PaymentSchedule;
  totalPaid: number;
  remainingBalance: number;
  completionPercentage: number;
}
```

#### List All Loans (Admin)
```typescript
loans.adminListLoans.query({
  status?: string;
  search?: string;
}) => LoanContract[]
```

#### Record Payment
```typescript
loans.recordPayment.mutation({
  loanId: string;
  scheduleId: string;
  amountPaid: number;
  paidDate: Date;
  paymentMethod?: string;
  notes?: string;
}) => LoanPayment
```

#### Get Payment Schedule
```typescript
loans.getPaymentSchedule.query({
  loanId: string;
}) => PaymentSchedule[]
```

#### Send Payment Reminder
```typescript
loans.sendPaymentReminder.mutation({
  scheduleId: string;
}) => { success: boolean; emailSent: boolean }
```

#### Cancel Loan
```typescript
loans.cancelLoan.mutation({
  loanId: string;
  reason?: string;
}) => LoanContract
```

---

## 4. UI SCREENS & COMPONENTS

### Admin Loans Tab: `app/(tabs)/admin-loans.tsx`
**Features:**
- List all loans with search/filter
- Create new loan button
- Loan cards showing: borrower name, principal, repayment amount, status, next payment
- Quick actions: view details, edit, send contract, record payment

### Loan Detail Screen: `app/(tabs)/admin-loan-detail.tsx`
**Features:**
- Loan summary (principal, repayment, interest, payment schedule)
- Payment schedule timeline
- Payment history
- Edit button (recalculates schedule)
- Record payment button
- Send contract/reminder buttons
- Status badge

### Create/Edit Loan Modal: `components/loan-form-modal.tsx`
**Fields:**
- Borrower name, email, phone
- Principal amount
- Total repayment amount
- Number of payments
- Payment frequency (weekly/biweekly/monthly)
- Payment day selector (dynamic based on frequency)
- Start date

### Payment Tracking: `components/loan-payment-tracker.tsx`
**Shows:**
- Payment schedule with due dates
- Payment status indicators
- Actual payments recorded
- Next payment highlight

---

## 5. UTILITY FUNCTIONS

### Payment Schedule Generator
```typescript
function generatePaymentSchedule(
  loanId: string,
  numberOfPayments: number,
  paymentAmount: number,
  startDate: Date,
  frequency: 'weekly' | 'biweekly' | 'monthly',
  dayOfWeek?: number,
  dayOfMonth?: string
): PaymentSchedule[]
```

**Logic:**
- Weekly: Add 7 days, use specified day of week
- Bi-weekly: Add 14 days, use specified day of week
- Monthly: Add 1 month, use specified day of month (1-31, first_thursday, last_thursday)

### Interest Calculator
```typescript
function calculateInterest(
  principalAmount: number,
  totalRepaymentAmount: number
): number
```

### Payment Status Updater
```typescript
function updatePaymentStatus(
  scheduleId: string,
  paidDate: Date
): 'completed' | 'pending' | 'delayed'
```

### Contract PDF Generator
```typescript
function generateLoanContractPDF(
  contract: LoanContract,
  schedule: PaymentSchedule[]
): Buffer
```

---

## 6. EMAIL TEMPLATES

### Contract Signature Email
- Subject: "Loan Contract from Luxury Wash On Wheels - Signature Required"
- Body: Intro + contract details + signature link
- Attachment: PDF contract
- CTA: "Sign Contract" button

### Payment Reminder Email (Sent to Lender - Day Before Payment)
- Subject: "Great News! You're Getting Paid Tomorrow! 🎉"
- Body: Celebratory tone + payment amount + due date + payment progress (X of Y)
- Tone: Positive, celebratory, partnership-focused
- Sent: Automatically 1 day before each payment due date

### Contract Signed Confirmation Email
- Subject: "Loan Contract Signed - [borrowerName]"
- Body: Confirmation + next payment date + payment details
- Attachment: Signed PDF contract

---

## 7. IMPLEMENTATION PHASES

### Phase 1: Database & Core API
- [ ] Create database tables
- [ ] Build tRPC loan router with CRUD operations
- [ ] Implement payment schedule generator
- [ ] Build DB helper functions

### Phase 2: Admin UI
- [ ] Create admin-loans.tsx tab
- [ ] Build loan-form-modal.tsx
- [ ] Create admin-loan-detail.tsx
- [ ] Add loans tab to admin navigation

### Phase 3: Contract & Signature
- [ ] Build PDF contract generator
- [ ] Create email sending logic
- [ ] Build signature capture endpoint
- [ ] Add contract storage (S3)

### Phase 4: Payment Management
- [ ] Build payment recording UI
- [ ] Implement payment status tracking
- [ ] Create payment reminder scheduler
- [ ] Add automatic email reminders

### Phase 5: Testing & Polish
- [ ] Unit tests for payment schedule generator
- [ ] Integration tests for loan creation/update
- [ ] End-to-end testing
- [ ] UI polish and refinements

---

## 8. KEY CALCULATIONS

### Payment Amount (Auto-calculated)
```
Payment Amount = Total Repayment Amount ÷ Number of Payments
```

### Interest Amount (Auto-calculated)
```
Interest Amount = Total Repayment Amount - Principal Amount
```

### Completion Percentage
```
Completion % = Total Paid ÷ Total Repayment Amount × 100
```

### Remaining Balance
```
Remaining Balance = Total Repayment Amount - Total Paid
```

---

## 9. EDGE CASES & VALIDATIONS

- ✅ Total repayment must be > principal (ensures positive interest)
- ✅ Cannot create loan with past start date
- ✅ Payment amount must be positive
- ✅ Payment date must be valid for selected frequency
- ✅ Cannot record payment for completed loan
- ✅ Cannot edit loan after first payment made
- ✅ Automatic status updates (completed when all payments recorded)

---

## 10. FUTURE ENHANCEMENTS (Not in MVP)

- [ ] Borrower portal (view own loans, payment history)
- [ ] Late payment penalties
- [ ] Early payoff options with recalculation
- [ ] Loan refinancing
- [ ] Payment plans (skip payments, extend terms)
- [ ] Integration with accounting software
- [ ] Loan analytics dashboard

---

## SUMMARY

**Total Implementation Effort:** ~3-4 days
**Complexity:** Medium (similar to VIP contract system)
**Dependencies:** Email service, PDF generation, S3 storage (already available)
**Testing Required:** Payment schedule generation, contract generation, email sending

