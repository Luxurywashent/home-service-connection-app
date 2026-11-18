import {
  captureCompanyInvoiceOperationIntent,
  type CompanyInvoiceOperationContext,
  type CompanyInvoiceOperationIntent,
} from "./company-job-invoice-operation";

export type CompanyInvoiceOperationLiveScope = Readonly<{
  mounted: boolean;
  focused: boolean;
  appActive: boolean;
  context: CompanyInvoiceOperationContext | null;
}>;
/**
 * Call against a ref updated in useLayoutEffect, not a render-mutated ref.
 * Clear/invalidate synchronously on close, blur, logout, Job change or inactive
 * AppState. The callback must reject both old async work and old UI handlers.
 */
export function isCurrentCompanyInvoiceOperationIntent(
  captured: CompanyInvoiceOperationIntent,
  live: CompanyInvoiceOperationLiveScope,
): boolean {
  if (!live.mounted || !live.focused || !live.appActive || !live.context)
    return false;
  try {
    const current = captureCompanyInvoiceOperationIntent(live.context);
    return (
      current.token === captured.token &&
      current.companyId === captured.companyId &&
      current.userId === captured.userId &&
      current.role === captured.role &&
      current.jobId === captured.jobId &&
      current.operationKey === captured.operationKey &&
      current.lifetime.sheetEpoch === captured.lifetime.sheetEpoch &&
      current.lifetime.focusEpoch === captured.lifetime.focusEpoch &&
      current.options.method === captured.options.method &&
      current.options.resend === captured.options.resend &&
      current.options.recipientEmail === captured.options.recipientEmail
    );
  } catch {
    return false;
  }
}
