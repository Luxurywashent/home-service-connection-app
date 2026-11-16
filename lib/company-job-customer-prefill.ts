import { companyCreateJobAllowed, companyCreateJobScope } from "./company-create-job";
import {
  getJobSyncCompanyCustomer, getJobSyncMobileSession,
  type JobSyncCompanyCustomer, type JobSyncNativeSession,
} from "./jobsync-mobile-api";

/** A route/profile lookup candidate, never authorization or a name/contact match. */
export type CompanyJobCustomerPrefill = { customerId: number; companyId: number };
function canonicalId(value: unknown): number | null {
  if (typeof value === "string") {
    if (!/^[1-9]\d*$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function parseCompanyJobCustomerPrefill(customerId: unknown, companyId: unknown): CompanyJobCustomerPrefill | null {
  const id = canonicalId(customerId), company = canonicalId(companyId);
  return id && company ? { customerId: id, companyId: company } : null;
}
export type CompanyJobPrefillTransport = {
  session: typeof getJobSyncMobileSession;
  customer: typeof getJobSyncCompanyCustomer;
};
/** Only fresh signed-session and exact bearer-scoped detail reads establish selection. */
export async function verifyCompanyJobCustomerPrefill(
  session: JobSyncNativeSession,
  candidate: CompanyJobCustomerPrefill,
  isCurrent: () => boolean,
  api: CompanyJobPrefillTransport = { session: getJobSyncMobileSession, customer: getJobSyncCompanyCustomer },
): Promise<JobSyncCompanyCustomer | null> {
  if (!isCurrent()) return null;
  const parsed = parseCompanyJobCustomerPrefill(candidate.customerId, candidate.companyId);
  if (!companyCreateJobAllowed(session) || !parsed || parsed.companyId !== session.company!.id) {
    throw new Error("This customer link does not belong to the current Company. Select a customer from this Company.");
  }
  const scope = companyCreateJobScope(session);
  const signed = await api.session(session.token);
  if (!isCurrent()) return null;
  if (!companyCreateJobAllowed(signed) || companyCreateJobScope(signed) !== scope) {
    throw new Error("Your Company sign-in changed. Reopen Add Job and select the customer again.");
  }
  const customer = await api.customer(signed.token, parsed.customerId);
  if (!isCurrent()) return null;
  const row = customer as JobSyncCompanyCustomer & { companyId?: unknown };
  if (customer.id !== parsed.customerId || (row.companyId !== undefined && row.companyId !== parsed.companyId)) {
    throw new Error("The selected Company customer could not be verified. Select the customer again.");
  }
  return customer;
}
