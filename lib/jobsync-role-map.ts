export type JobSyncCompanyRole = "owner" | "dispatcher" | "technician";

export type JobSyncCompanySession = {
  portal: "company" | "platform";
  user: {
    id: number;
    name: string;
    email: string | null;
    role: string;
    memberId?: string;
  };
  company?: {
    id: number;
    name: string;
  };
};

export type NativeEmployeeBridge = {
  employeeId: string;
  fullName: string;
  email: string | null;
  role: "detailer" | "admin" | "operations_manager";
  city: null;
  hireDate: null;
  profilePhotoUrl: null;
  phoneNumber: null;
  hourlyRate: null;
  upsellBonusPct: null;
  companyId: number;
  companyName: string;
  jobSyncMemberId: string | null;
  sessionSource: "jobsync";
};

export function getNativeEmployeeSession(session: JobSyncCompanySession): NativeEmployeeBridge | null {
  if (session.portal !== "company" || !session.company) return null;
  const roleMap: Record<JobSyncCompanyRole, NativeEmployeeBridge["role"]> = {
    owner: "admin",
    dispatcher: "operations_manager",
    technician: "detailer",
  };
  const role = session.user.role;
  if (!(role in roleMap)) return null;
  return {
    employeeId: `jobsync-${session.company.id}-${session.user.id}`,
    fullName: session.user.name,
    email: session.user.email,
    role: roleMap[role as JobSyncCompanyRole],
    city: null,
    hireDate: null,
    profilePhotoUrl: null,
    phoneNumber: null,
    hourlyRate: null,
    upsellBonusPct: null,
    companyId: session.company.id,
    companyName: session.company.name,
    jobSyncMemberId: session.user.memberId ?? null,
    sessionSource: "jobsync",
  };
}
