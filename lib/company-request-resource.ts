export type CompanyRequestResource<T> = {
  requestKey: string;
  data: T;
};

/**
 * Exposes a response only when it belongs to the currently requested Company
 * resource. This prevents a previous member/customer response from flashing
 * while a new selection or Company revision is still loading.
 */
export function companyRequestValue<T>(
  requestKey: string | null | undefined,
  resource: CompanyRequestResource<T> | null | undefined,
): T | null {
  return requestKey && resource?.requestKey === requestKey ? resource.data : null;
}

/** A key change is loading until a matching response (including an empty one) arrives. */
export function companyRequestLoading(
  requestKey: string | null | undefined,
  resource: CompanyRequestResource<unknown> | null | undefined,
) {
  return Boolean(requestKey && resource?.requestKey !== requestKey);
}
