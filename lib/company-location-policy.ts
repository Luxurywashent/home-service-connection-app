export function shouldPublishCompanyLocation(input: {
  role: string | undefined;
  clockedIn: boolean;
  disclosureAccepted: boolean;
  foregroundGranted: boolean;
  appActive: boolean;
}) {
  return input.role === "technician"
    && input.clockedIn
    && input.disclosureAccepted
    && input.foregroundGranted
    && input.appActive;
}

export function shouldUseBackgroundCompanyLocation(input: {
  role: string | undefined;
  clockedIn: boolean;
  disclosureAccepted: boolean;
  backgroundAlreadyGranted: boolean;
}) {
  return input.role === "technician"
    && input.clockedIn
    && input.disclosureAccepted
    && input.backgroundAlreadyGranted;
}
