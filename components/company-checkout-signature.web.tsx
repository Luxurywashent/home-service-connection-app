import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CompanyCheckoutSignatureProps, CompanyCheckoutSignatureRef } from "./company-checkout-signature.native";
export type { CompanyCheckoutSignatureProps, CompanyCheckoutSignatureRef } from "./company-checkout-signature.native";

const unavailable = () => new Error("Signature is empty, unavailable, or no longer current.");
/** Browser drawing only. Secure real-card entry remains unavailable in the separate web card bridge. */
export const CompanyCheckoutSignature = forwardRef<CompanyCheckoutSignatureRef, CompanyCheckoutSignatureProps>(function CompanyCheckoutSignature(props, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  useLayoutEffect(() => { live.current = props; }, [props]);
  const mounted = useRef(true);
  const hasInk = useRef(false);
  const pointer = useRef<number | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const generation = useRef(0);
  const current = () => mounted.current && !live.current.disabled && live.current.isCurrent();
  const reset = (notify = true) => {
    generation.current++;
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (element && context) {
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, element.width, element.height);
    }
    if (pointer.current !== null && element?.hasPointerCapture?.(pointer.current)) element.releasePointerCapture(pointer.current);
    pointer.current = null; lastPoint.current = null; hasInk.current = false;
    if (notify && mounted.current && live.current.isCurrent()) {
      live.current.onChange(null); live.current.onDrawingChange?.(false);
    }
  };
  const read = async () => {
    if (!current() || pointer.current !== null || !hasInk.current || !canvas.current) throw unavailable();
    const png = canvas.current.toDataURL("image/png");
    if (png.length > 4 * 1024 * 1024 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png)) throw unavailable();
    if (!current()) throw unavailable();
    return png;
  };
  useImperativeHandle(ref, () => ({ read, clear: () => { if (current()) reset(); } }));
  useEffect(() => {
    mounted.current = true;
    const resize = () => {
      const element = canvas.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (element.width === width && element.height === height) return;
      element.width = width; element.height = height;
      // A resize discards drawing rather than approving scaled or stale evidence.
      reset();
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (canvas.current) observer?.observe(canvas.current);
    window.addEventListener("resize", resize);
    return () => { mounted.current = false; observer?.disconnect(); window.removeEventListener("resize", resize); reset(false); };
  }, []);
  useEffect(() => { if (props.disabled) reset(); }, [props.disabled]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * element.width / Math.max(rect.width, 1), y: (event.clientY - rect.top) * element.height / Math.max(rect.height, 1) };
  };
  const end = async (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null; lastPoint.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current()) { reset(); return; }
    const captured = generation.current;
    live.current.onDrawingChange?.(false);
    try { const png = await read(); if (current() && generation.current === captured) live.current.onChange(png); }
    catch { if (current() && generation.current === captured) live.current.onChange(null); }
  };
  return <canvas ref={canvas} aria-label="Customer signature drawing area" aria-disabled={props.disabled}
    style={{ width: "100%", height: "100%", display: "block", background: "#ffffff", touchAction: "none", cursor: props.disabled ? "not-allowed" : "crosshair" }}
    onPointerDown={(event) => {
      if (!current() || pointer.current !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      const context = event.currentTarget.getContext("2d"); if (!context) return;
      generation.current++;
      event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
      lastPoint.current = point(event); hasInk.current = true;
      live.current.onChange(null); live.current.onDrawingChange?.(true);
      context.fillStyle = "#142139"; context.beginPath(); context.arc(lastPoint.current.x, lastPoint.current.y, 2, 0, Math.PI * 2); context.fill();
    }}
    onPointerMove={(event) => {
      if (!current() || pointer.current !== event.pointerId || !lastPoint.current) return;
      event.preventDefault(); const context = event.currentTarget.getContext("2d"); if (!context) return;
      const next = point(event); context.strokeStyle = "#142139"; context.lineWidth = 3 * Math.min(window.devicePixelRatio || 1, 3);
      context.lineCap = "round"; context.lineJoin = "round"; context.beginPath(); context.moveTo(lastPoint.current.x, lastPoint.current.y); context.lineTo(next.x, next.y); context.stroke(); lastPoint.current = next;
    }}
    onPointerUp={(event) => { void end(event); }}
    onPointerCancel={() => reset()}
    onLostPointerCapture={() => { if (pointer.current !== null) reset(); }} />;
});
