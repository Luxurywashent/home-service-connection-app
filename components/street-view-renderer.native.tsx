import { WebView } from "react-native-webview";
import { parseStreetViewStatus } from "@/lib/job-street-view";
import type { StreetViewRendererProps } from "./street-view-renderer";

export function StreetViewRenderer({ html, onStatus }: StreetViewRendererProps) {
  return (
    <WebView
      source={{ html }}
      originWhitelist={["*"]}
      style={{ flex: 1, backgroundColor: "#0C1B32" }}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      onMessage={({ nativeEvent }) => {
        const status = parseStreetViewStatus(nativeEvent.data);
        if (status) onStatus(status);
      }}
      onError={() => onStatus("error")}
      onHttpError={() => onStatus("error")}
      onContentProcessDidTerminate={() => onStatus("error")}
    />
  );
}
