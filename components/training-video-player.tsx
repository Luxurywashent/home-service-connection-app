import React from "react";
import { View, Text, Dimensions, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { useColors } from "@/hooks/use-colors";

interface TrainingVideoPlayerProps {
  videoUrl: string | null | undefined;
  title?: string;
}

export function TrainingVideoPlayer({ videoUrl, title }: TrainingVideoPlayerProps) {
  const colors = useColors();
  const screenWidth = Dimensions.get("window").width;

  if (!videoUrl) {
    return null;
  }

  // Extract video ID and create embed URL for Loom and YouTube
  const getEmbedUrl = (url: string): string => {
    // Loom embed URL
    if (url.includes("loom.com")) {
      if (url.includes("/embed/")) {
        return url;
      }
      const loomId = url.split("/").pop();
      return `https://www.loom.com/embed/${loomId}`;
    }

    // YouTube embed URL
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      let videoId = "";
      if (url.includes("youtube.com/watch?v=")) {
        videoId = url.split("v=")[1]?.split("&")[0] || "";
      } else if (url.includes("youtu.be/")) {
        videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
      }
      return `https://www.youtube.com/embed/${videoId}`;
    }

    return url;
  };

  const embedUrl = getEmbedUrl(videoUrl);
  const videoHeight = (screenWidth / 16) * 9; // 16:9 aspect ratio

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #000;
        }
        .video-container {
          position: relative;
          width: 100%;
          padding-bottom: 56.25%;
          height: 0;
          overflow: hidden;
        }
        .video-container iframe {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border: none;
        }
      </style>
    </head>
    <body>
      <div class="video-container">
        <iframe
          src="${embedUrl}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        ></iframe>
      </div>
    </body>
    </html>
  `;

  return (
    <View className="w-full mb-6 rounded-xl overflow-hidden border border-border">
      <View style={{ backgroundColor: colors.background, height: videoHeight }}>
        <WebView
          source={{ html: htmlContent }}
          style={{ flex: 1 }}
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center bg-background">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          javaScriptEnabled
          scrollEnabled={false}
        />
      </View>
    </View>
  );
}
