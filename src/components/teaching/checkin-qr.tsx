"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui-primitives";

/*
 * The check-in QR as one SVG path from the `qrcode` module matrix: no canvas,
 * no image, no innerHTML. Dark on light in every theme (`--teaching-qr-*`,
 * which U1 does not redefine for dark), because cameras need a light quiet
 * zone; `forced-color-adjust` stops high contrast repainting it. The SVG
 * carries the Teaching identity itself because the shared display screen sits
 * outside every Teaching page: without it the pair is undefined there and the
 * whole code paints as one black square no camera can read.
 */
const QUIET_ZONE = 4;

export interface QrMatrix {
  readonly path: string;
  readonly size: number;
}

let qrcodeModulePromise: Promise<typeof import("qrcode")> | null = null;
let qrcodeLib: typeof import("qrcode") | null = null;

export function loadQrCode(): Promise<typeof import("qrcode")> {
  if (qrcodeLib) return Promise.resolve(qrcodeLib);
  if (!qrcodeModulePromise) {
    qrcodeModulePromise = import("qrcode").then((mod) => {
      qrcodeLib = mod;
      return mod;
    });
  }
  return qrcodeModulePromise;
}

function computeQrPath(qr: import("qrcode").QRCode): QrMatrix {
  const count = qr.modules.size;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { path, size: count + QUIET_ZONE * 2 };
}

const matrixCache = new Map<string, QrMatrix>();

function getOrComputeMatrix(create: typeof import("qrcode").create, value: string): QrMatrix {
  const cached = matrixCache.get(value);
  if (cached) return cached;
  const qr = create(value, { errorCorrectionLevel: "M" });
  const result = computeQrPath(qr);
  matrixCache.set(value, result);
  return result;
}

export function useQrMatrix(value: string | null): QrMatrix | null {
  const [matrix, setMatrix] = useState<QrMatrix | null>(() => {
    if (!value || !qrcodeLib) return null;
    return getOrComputeMatrix(qrcodeLib.create, value);
  });
  const [prevValue, setPrevValue] = useState<string | null>(value);

  if (value !== prevValue) {
    setPrevValue(value);
    setMatrix(value && qrcodeLib ? getOrComputeMatrix(qrcodeLib.create, value) : null);
  }

  useEffect(() => {
    if (!value || qrcodeLib) return;
    let cancelled = false;
    loadQrCode().then((mod) => {
      if (!cancelled) {
        setMatrix(getOrComputeMatrix(mod.create, value));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return matrix;
}

export async function qrModulePath(value: string): Promise<QrMatrix> {
  const cached = matrixCache.get(value);
  if (cached) return cached;
  const { create } = await loadQrCode();
  return getOrComputeMatrix(create, value);
}

export function CheckinQr({ value, label, className }: { value: string; label: string; className?: string }) {
  const drawn = useQrMatrix(value);
  const size = drawn?.size ?? 29;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      data-testid="teaching-checkin-qr"
      data-mode-identity="teaching"
      data-qr-value={value}
      className={cn("block aspect-square w-full forced-color-adjust-none", className)}
    >
      <rect width={size} height={size} className="fill-[color:var(--teaching-qr-light)]" />
      {drawn ? <path d={drawn.path} className="fill-[color:var(--teaching-qr-dark)]" /> : null}
    </svg>
  );
}
