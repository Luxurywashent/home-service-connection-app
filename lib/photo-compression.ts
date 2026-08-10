import * as ImageManipulator from "expo-image-manipulator";

interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.7,
};

/**
 * Compress an image file to reduce file size while maintaining reasonable quality
 * @param imageUri - URI of the image to compress
 * @param options - Compression options (maxWidth, maxHeight, quality)
 * @returns Compressed image URI
 */
export async function compressImage(
  imageUri: string,
  options: CompressionOptions = DEFAULT_OPTIONS
): Promise<string> {
  try {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    // Use ImageManipulator to resize and compress
    const result = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          resize: {
            width: mergedOptions.maxWidth!,
            height: mergedOptions.maxHeight!,
          },
        },
      ],
      {
        compress: mergedOptions.quality!,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    return result.uri;
  } catch (error) {
    console.error("Photo compression failed:", error);
    // Return original URI if compression fails
    return imageUri;
  }
}

/**
 * Compress multiple images in parallel
 * @param imageUris - Array of image URIs to compress
 * @param options - Compression options
 * @returns Array of compressed image URIs
 */
export async function compressImages(
  imageUris: string[],
  options: CompressionOptions = DEFAULT_OPTIONS
): Promise<string[]> {
  try {
    const compressionPromises = imageUris.map((uri) =>
      compressImage(uri, options)
    );
    return Promise.all(compressionPromises);
  } catch (error) {
    console.error("Batch photo compression failed:", error);
    // Return original URIs if batch compression fails
    return imageUris;
  }
}
