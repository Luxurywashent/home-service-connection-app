import { useEffect, useRef } from "react";
import { parseStreetViewStatus, type StreetViewStatus } from "@/lib/job-street-view";

export type StreetViewRendererProps = {
  html: string;
  onStatus: (status: StreetViewStatus) => void;
};

/** Metro uses .native.tsx on iOS/Android; web never imports native WebView. */
export function StreetViewRenderer({ html, onStatus }: StreetViewRendererProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const status = parseStreetViewStatus(event.data);
      if (status) onStatus(status);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onStatus]);
  return (
    <iframe
      ref={frame}
      title="Job location Street View"
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin"
      allowFullScreen
      onError={() => onStatus("error")}
      style={{ width: "100%", height: "100%", border: 0, backgroundColor: "#0C1B32" }}
    />
  );
}
