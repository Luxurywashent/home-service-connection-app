import { companyPhotoScope, currentCompanyGallery } from "./company-photo-view";
import type {
  JobSyncCompanyJobDetail,
  JobSyncNativeSession,
} from "./jobsync-mobile-api";

export const COMPANY_PHOTO_DRAFT_MAX_BYTES = 15 * 1024 * 1024;
export const COMPANY_PHOTO_DRAFT_LABEL =
  "Local draft — not uploaded or saved to this Job";
export const COMPANY_PHOTO_DRAFT_BACKEND_PENDING =
  "Camera and Library prepare a local preview only. Upload persistence and authorized deletion are unavailable until JobSync connects bearer-authenticated Company Job photo upload/delete routes. Existing server photos remain read-only.";

export type CompanyPhotoDraftInput = {
  session: JobSyncNativeSession | null;
  jobId: number | null;
  job: {
    detail: JobSyncCompanyJobDetail | null;
    loading: boolean;
    pending: boolean;
    error: string | null;
  };
};
export type LocalPhotoDraft = {
  uri: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};
export type LocalPhotoCandidate = {
  uri?: string | null;
  type?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number;
};
type LocalFileInfo = {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
};
export type ReadLocalFileInfo = (uri: string) => Promise<LocalFileInfo>;

/** The same authoritative detail/read scope as the gallery, not field-progress opt-in policy. */
export function companyPhotoDraftScope(
  input: CompanyPhotoDraftInput,
): string | null {
  return currentCompanyGallery(input) !== null
    ? companyPhotoScope(input.session, input.jobId)
    : null;
}

/** Only controlled messages may reach the UI; native errors may contain local paths or credentials. */
export class LocalPhotoDraftError extends Error {}

function checkedSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0)
    throw new LocalPhotoDraftError(
      "Photo size is missing or empty. Choose another photo and retry.",
    );
  if (size > COMPANY_PHOTO_DRAFT_MAX_BYTES)
    throw new LocalPhotoDraftError(
      "Photo exceeds the 15 MiB limit. Choose a smaller photo and retry.",
    );
  return size;
}

function candidateMime(
  candidate: LocalPhotoCandidate,
): LocalPhotoDraft["mimeType"] {
  // A supplied unsupported MIME is never overridden by a friendly-looking filename.
  const supplied = candidate.mimeType?.trim().toLowerCase();
  if (supplied) {
    if (["image/jpeg", "image/png", "image/webp"].includes(supplied))
      return supplied as LocalPhotoDraft["mimeType"];
    throw new LocalPhotoDraftError(
      "Unsupported photo format. Choose a JPEG, PNG or WebP image.",
    );
  }
  // Some native picker results omit MIME. Infer only the three supported extensions.
  const extension = (candidate.fileName || candidate.uri || "")
    .match(/\.([a-z0-9]+)$/i)?.[1]
    ?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  throw new LocalPhotoDraftError(
    "Photo format is missing or unsupported. Choose a JPEG, PNG or WebP image.",
  );
}

/** Metadata read only: no copying, encoding, persistence, upload or record mutation. */
export async function prepareCompanyPhotoDraft(
  candidate: LocalPhotoCandidate,
  getInfo: ReadLocalFileInfo,
): Promise<LocalPhotoDraft> {
  const uri = candidate.uri;
  // Do not guess how to resolve ph://, content://, remote URLs or web blobs.
  if (
    typeof uri !== "string" ||
    !/^file:\/\/\/[^?#\u0000-\u0020]+$/.test(uri) ||
    uri === "file:///"
  )
    throw new LocalPhotoDraftError(
      "Photo must be a readable local file. Choose another photo and retry.",
    );
  if (candidate.type != null && candidate.type !== "image")
    throw new LocalPhotoDraftError(
      "Only still JPEG, PNG or WebP images are supported. Video and Live Photos are unavailable.",
    );
  const mimeType = candidateMime(candidate);
  if (candidate.fileSize !== undefined) checkedSize(candidate.fileSize);
  let info: LocalFileInfo;
  try {
    // Even when the picker gives a size, metadata is needed to reject missing files/directories
    // and enforce the limit on the actual local file, not just picker metadata.
    info = await getInfo(uri);
  } catch {
    throw new LocalPhotoDraftError(
      "Could not read this local photo. Choose another photo and retry.",
    );
  }
  if (!info?.exists || info.isDirectory !== false)
    throw new LocalPhotoDraftError(
      "Photo file is missing or unreadable. Choose another photo and retry.",
    );
  return { uri, mimeType, size: checkedSize(info.size) };
}
