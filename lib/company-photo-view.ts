import { companyJobSessionKey } from "./company-job-fieldwork";
import type {
  JobSyncCompanyJobDetail,
  JobSyncJobPhoto,
  JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { positiveJobSyncId } from "./jobsync-mobile-api";

/** Opaque, memory-only scope. Never use this token-bearing key in test IDs or logs. */
export function companyPhotoScope(
  session: JobSyncNativeSession | null,
  jobId: number | null,
): string | null {
  return companyJobSessionKey(session, jobId);
}

type GalleryInput = {
  session: JobSyncNativeSession | null;
  jobId: number | null;
  job: {
    detail: JobSyncCompanyJobDetail | null;
    loading: boolean;
    pending: boolean;
    error: string | null;
  };
};

/** null is unavailable; [] is a successful, authoritative empty gallery. */
export function currentCompanyGallery(
  input: GalleryInput,
): JobSyncJobPhoto[] | null {
  const {
    session,
    jobId,
    job: { detail, loading, pending, error },
  } = input;
  if (
    !companyPhotoScope(session, jobId) ||
    loading ||
    pending ||
    error ||
    !detail ||
    detail.id !== jobId ||
    detail.companyId !== session?.company?.id ||
    !session ||
    !["owner", "dispatcher", "technician"].includes(session.user.role) ||
    (session.user.role === "technician" &&
      detail.assignedUserId !== session.user.id)
  )
    return null;
  return detail.photos;
}

/** Never merge local or legacy URLs into a canonical gallery. */
export function currentCompanyPhotos(input: GalleryInput): JobSyncJobPhoto[] {
  return currentCompanyGallery(input) ?? [];
}

export function sameCompanyPhoto(
  photos: JobSyncJobPhoto[],
  photo: Pick<JobSyncJobPhoto, "id" | "imageUrl">,
): boolean {
  return photos.some(
    (current) => current.id === photo.id && current.imageUrl === photo.imageUrl,
  );
}

/** Derived from canonical signed inputs, NOT a server canDelete flag. Server always authorizes. */
export function canDeleteCompanyPhoto(input: GalleryInput, photoId: number): boolean {
  if (typeof photoId !== "number" || !positiveJobSyncId(photoId)) return false;
  const photo = currentCompanyGallery(input)?.find((item) => item.id === photoId);
  if (!photo || typeof photo.uploadedByUserId !== "number" || !positiveJobSyncId(photo.uploadedByUserId)) return false;
  return input.session?.user.role === "owner" || input.session?.user.role === "dispatcher"
    || (input.session?.user.role === "technician" && input.job.detail?.assignedUserId === input.session.user.id && photo.uploadedByUserId === input.session.user.id);
}
