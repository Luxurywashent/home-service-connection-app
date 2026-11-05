import type { JobSyncCompanyCustomer } from "./jobsync-mobile-api";

/** Match by the job's backend customer ID, never by a non-unique name. */
export function findJobCustomerPhone(customers: JobSyncCompanyCustomer[], customerId: string | number | null | undefined): string | null {
  if (customerId === null || customerId === undefined || String(customerId).trim() === "") return null;
  const id = Number(customerId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return customers.find((customer) => customer.id === id)?.phone?.trim() || null;
}

/** No message body or send operation: these URLs only open the device's apps. */
export function customerContactUrl(action: "call" | "message", phone: string | null | undefined): string | null {
  const input = phone?.trim() ?? "";
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;
  const normalized = input.replace(/[\s().-]/g, "");
  const digits = normalized.replace(/^\+/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${action === "call" ? "tel" : "sms"}:${normalized}`;
}
