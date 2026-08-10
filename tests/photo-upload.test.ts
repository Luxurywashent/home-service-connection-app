import { describe, it, expect, vi } from "vitest";
import { uploadPhotoToS3, uploadMultiplePhotos } from "../lib/s3-upload";

describe("Photo Upload", () => {
  it("should handle single photo upload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://s3.example.com/photo-1.jpg" }),
    });
    global.fetch = mockFetch;

    const base64Data = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const result = await uploadPhotoToS3(base64Data, "test-photo.jpg");

    expect(result).toBe("https://s3.example.com/photo-1.jpg");
    expect(mockFetch).toHaveBeenCalledWith("/api/upload-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining("test-photo.jpg"),
    });
  });

  it("should handle multiple photo uploads", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://s3.example.com/photo-1.jpg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://s3.example.com/photo-2.jpg" }),
      });
    global.fetch = mockFetch;

    const photos = ["data:image/jpeg;base64,/9j/4AAQSkZJRg==", "data:image/jpeg;base64,/9j/4AAQSkZJRg=="];
    const results = await uploadMultiplePhotos(photos);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe("https://s3.example.com/photo-1.jpg");
    expect(results[1]).toBe("https://s3.example.com/photo-2.jpg");
  });

  it("should handle upload errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Server Error",
    });
    global.fetch = mockFetch;

    const base64Data = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    await expect(uploadPhotoToS3(base64Data, "test-photo.jpg")).rejects.toThrow("Upload failed");
  });

  it("should parse photoUrls JSON correctly", () => {
    const photoUrlsJson = '["https://s3.example.com/photo-1.jpg", "https://s3.example.com/photo-2.jpg"]';
    const photos = JSON.parse(photoUrlsJson);

    expect(photos).toHaveLength(2);
    expect(photos[0]).toBe("https://s3.example.com/photo-1.jpg");
  });

  it("should handle empty photoUrls", () => {
    const photoUrlsJson = null;
    const photos = photoUrlsJson ? JSON.parse(photoUrlsJson) : [];

    expect(photos).toHaveLength(0);
  });
});
