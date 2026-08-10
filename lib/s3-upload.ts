/**
 * S3 Upload Utility for Door Hanger Photos
 * Handles uploading compressed photos to S3 storage
 */

export async function uploadPhotoToS3(base64Data: string, fileName: string): Promise<string> {
  try {
    // Call backend API to upload to S3
    const response = await fetch("/api/upload-photo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base64Data,
        fileName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.url; // Return S3 URL
  } catch (error) {
    console.error("Photo upload error:", error);
    throw error;
  }
}

export async function uploadMultiplePhotos(
  photos: string[]
): Promise<string[]> {
  const uploadPromises = photos.map((photo, index) =>
    uploadPhotoToS3(photo, `door-hanger-${Date.now()}-${index}.jpg`)
  );

  return Promise.all(uploadPromises);
}
