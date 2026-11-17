import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import SignatureCanvas, { type SignatureViewRef } from "react-native-signature-canvas";

export interface CompanyCheckoutSignatureRef {
  /** Resolves only after the native WebView emits an onOK PNG response. */
  read: () => Promise<string>;
  clear: () => void;
}
export interface CompanyCheckoutSignatureProps {
  disabled: boolean;
  isCurrent: () => boolean;
  onChange: (pngDataUrl: string | null) => void;
  onDrawingChange?: (drawing: boolean) => void;
}
interface PendingRead {
  generation: number;
  resolve: (png: string) => void;
  reject: (error: Error) => void;
  promise: Promise<string>;
  timer: ReturnType<typeof setTimeout>;
}
const unavailable = () => new Error("Signature is empty, unavailable, or no longer current.");
const safePng = (value: string) => value.length <= 4 * 1024 * 1024
  && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);

/** Bundled signature-pad/application code only. No images, links, fetch, files, or remote scripts. */
const localHtml = (script: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; font-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">
<style>html,body,#signature-pad,.m-signature-pad--body{margin:0;width:100%;height:100%;overflow:hidden;background:white}canvas{display:block;width:100%;height:100%;touch-action:none}button{display:none}</style>
</head><body><div id="signature-pad"><div class="m-signature-pad--body"><canvas aria-label="Customer signature drawing area"></canvas></div></div><script>${script}</script></body></html>`;

/** Local PNG evidence only; never restore a prior customer signature into the pad. */
export const CompanyCheckoutSignature = forwardRef<CompanyCheckoutSignatureRef, CompanyCheckoutSignatureProps>(function CompanyCheckoutSignature(props, ref) {
  const canvas = useRef<SignatureViewRef>(null);
  const live = useRef(props);
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef<PendingRead | null>(null);
  const drawing = useRef(false);
  const needsRead = useRef(false);
  const hasInk = useRef(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const lastDisabled = useRef(props.disabled);
  const activeRevision = useRef(revision);
  useLayoutEffect(() => { activeRevision.current = revision; }, [revision]);
  const current = () => mounted.current && !live.current.disabled && live.current.isCurrent();
  const rejectPending = () => {
    // Keep a tombstone until the old response arrives; it must not satisfy a newer read.
    pending.current?.reject(unavailable());
  };
  useLayoutEffect(() => {
    live.current = props;
    if (lastDisabled.current !== props.disabled) {
      lastDisabled.current = props.disabled;
      generation.current++; rejectPending();
    }
  }, [props]);
  const reset = (notify: boolean) => {
    generation.current++; needsRead.current = false; drawing.current = false; hasInk.current = false;
    if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(unavailable()); pending.current = null; }
    if (notify && mounted.current && live.current.isCurrent()) {
      live.current.onChange(null); live.current.onDrawingChange?.(false);
    }
  };
  const read = (): Promise<string> => {
    if (!current() || !canvas.current || drawing.current || !hasInk.current) return Promise.reject(unavailable());
    if (pending.current) {
      if (pending.current.generation === generation.current) return pending.current.promise;
      return Promise.reject(unavailable());
    }
    let resolve!: (png: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    const captured = generation.current;
    const timer = setTimeout(() => {
      if (pending.current?.generation !== captured) return;
      reset(true);
      if (mounted.current) { setError(true); setRevision((value) => value + 1); }
    }, 5000);
    pending.current = { generation: captured, resolve, reject, promise, timer };
    canvas.current.readSignature(); // Void API: output arrives asynchronously in onOK/onEmpty.
    return promise;
  };
  const queueRead = () => {
    if (!current() || drawing.current || !hasInk.current) return;
    if (pending.current && pending.current.generation !== generation.current) { needsRead.current = true; return; }
    void read().catch(() => undefined);
  };
  const handleOK = (png: string) => {
    const request = pending.current;
    if (!request) return; // Unsolicited/retained messages cannot authorize anything.
    clearTimeout(request.timer); pending.current = null;
    if (!current() || drawing.current || request.generation !== generation.current || !safePng(png)) {
      request.reject(unavailable());
    } else {
      setError(false); live.current.onChange(png); request.resolve(png);
    }
    if (needsRead.current) { needsRead.current = false; queueRead(); }
  };
  const handleEmpty = () => {
    const request = pending.current;
    if (request) { clearTimeout(request.timer); request.reject(unavailable()); pending.current = null; }
    if (current()) live.current.onChange(null);
    if (needsRead.current) { needsRead.current = false; queueRead(); }
  };
  const clear = () => {
    if (!current()) return;
    reset(true); canvas.current?.clearSignature();
    // A new WebView ensures a late read from the old canvas cannot satisfy a new request.
    setError(false); setRevision((value) => value + 1);
  };
  useImperativeHandle(ref, () => ({ read, clear }));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reset(false); };
  }, []);
  const fail = () => { reset(true); if (mounted.current) setError(true); };
  const padGeneration = revision;
  const activePad = () => mounted.current && padGeneration === activeRevision.current;
  return <View style={styles.container} pointerEvents={props.disabled ? "none" : "auto"}>
    <SignatureCanvas key={revision} ref={canvas} customHtml={localHtml} imageType="image/png"
      backgroundColor="#ffffff" penColor="#142139" minWidth={1.5} maxWidth={3} autoClear={false}
      trimWhitespace={false} scrollable={false} nestedScrollEnabled={false} showsVerticalScrollIndicator={false}
      onOK={(png) => { if (activePad()) handleOK(png); }} onEmpty={() => { if (activePad()) handleEmpty(); }}
      onBegin={() => {
        if (!activePad() || !current()) return;
        generation.current++; rejectPending(); drawing.current = true; hasInk.current = true;
        live.current.onChange(null); live.current.onDrawingChange?.(true);
      }}
      onEnd={() => { if (activePad() && current()) { drawing.current = false; live.current.onDrawingChange?.(false); queueRead(); } }}
      onError={fail}
      webviewProps={{
        // '*' keeps URLs inside should-start policy rather than launching external apps.
        originWhitelist: ["*"],
        onShouldStartLoadWithRequest: (request) => request.url === "about:blank",
        javaScriptCanOpenWindowsAutomatically: false, setSupportMultipleWindows: false,
        onOpenWindow: () => undefined, allowsBackForwardNavigationGestures: false,
        allowFileAccess: false, allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false,
        allowingReadAccessToURL: "about:blank", mixedContentMode: "never", domStorageEnabled: false,
        cacheEnabled: false, cacheMode: "LOAD_NO_CACHE", incognito: true,
        thirdPartyCookiesEnabled: false, sharedCookiesEnabled: false,
        mediaCapturePermissionGrantType: "deny", allowsInlineMediaPlayback: false,
        allowsLinkPreview: false, onFileDownload: () => undefined,
        onError: fail, onHttpError: fail, onContentProcessDidTerminate: fail,
      }} style={styles.canvas} />
    {error && <View style={styles.error}><Text style={styles.errorText}>Signature pad unavailable. Clear and sign again when checkout is ready.</Text></View>}
  </View>;
});
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" }, canvas: { flex: 1, backgroundColor: "#ffffff" },
  error: { position: "absolute", top: 0, left: 0, right: 0, padding: 14, backgroundColor: "#ffffff" },
  errorText: { color: "#334155", fontSize: 14, lineHeight: 20 },
});
