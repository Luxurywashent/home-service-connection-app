/**
 * VIP Video Context
 *
 * Creates the VIP explainer video player once at app startup so it is
 * fully buffered before the customer ever taps the VIP tab.
 * The player is shared via context so vip.tsx can consume it directly
 * without creating a second player instance.
 */
import React, { createContext, useContext, useEffect, useRef } from "react";
import { createVideoPlayer } from "expo-video";
import type { VideoPlayer } from "expo-video";

export const VIP_VIDEO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/EvDmJQGFjZoaCrwU.mp4";

const VipVideoContext = createContext<VideoPlayer | null>(null);

export function VipVideoProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<VideoPlayer | null>(null);

  if (!playerRef.current) {
    // Create player synchronously on first render so buffering starts immediately
    const p = createVideoPlayer(VIP_VIDEO_URL);
    p.loop = false;
    p.muted = false;
    p.volume = 1.0;
    // Ensure the player starts paused — expo-video may auto-play on some platforms
    p.pause();
    playerRef.current = p;
  }

  useEffect(() => {
    return () => {
      // Release player when the provider unmounts (app close)
      playerRef.current?.release();
    };
  }, []);

  return (
    <VipVideoContext.Provider value={playerRef.current}>
      {children}
    </VipVideoContext.Provider>
  );
}

export function useVipVideoPlayer(): VideoPlayer | null {
  return useContext(VipVideoContext);
}
