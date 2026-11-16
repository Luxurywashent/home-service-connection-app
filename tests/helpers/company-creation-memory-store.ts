import type { CompanyCreationRecord, CompanyCreationStore } from "../../lib/company-job-creation-storage";
/** Test-only persistence: structured clones retain immutable submissions across controllers.
 * No native module, real browser database, customer data or live transport is used.
 */
export function memoryCreationStorageModule() {
  const records = new Map<string, CompanyCreationRecord>();
  let sequence = 0;
  const key = (companyId: number, userId: number) => `${companyId}:${userId}`;
  const copy = <T>(value: T): T => structuredClone(value);
  const companyCreationStore: CompanyCreationStore = {
    async read(companyId, userId) { const row = records.get(key(companyId, userId)); return row ? copy(row) : null; },
    async reserve(record) { const id = key(record.companyId, record.userId); if (records.has(id)) return false; records.set(id, copy(record)); return true; },
    async update(record) { const id = key(record.companyId, record.userId); if (records.get(id)?.operationKey !== record.operationKey) return false; records.set(id, copy(record)); return true; },
    async remove(companyId, userId, operationKey) { const id = key(companyId, userId); if (records.get(id)?.operationKey !== operationKey) return false; records.delete(id); return true; },
  };
  return { companyCreationStore, newCompanyCreationOperationKey: () => `hsc-job-test-key-${++sequence}` };
}
