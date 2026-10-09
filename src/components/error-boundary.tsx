"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";

import { isChunkLoadError, RouteErrorBoundary } from "@/components/route-error-boundary";

export const CHUNK_LOAD_RELOAD_PREFIX = "chunk_load_reload_attempted:";

export function getChunkLoadReloadKey(pathname: string): string {
  return `${CHUNK_LOAD_RELOAD_PREFIX}${pathname || "/"}`;
}

export function hasChunkLoadReloadAttempted(pathname: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(getChunkLoadReloadKey(pathname)) === "true";
  } catch {
    return false;
  }
}

export function markChunkLoadReloadAttempted(pathname: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = getChunkLoadReloadKey(pathname);
    window.sessionStorage.setItem(key, "true");
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function clearChunkLoadReloadAttempt(pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getChunkLoadReloadKey(pathname));
  } catch {
    // Ignore storage remove exceptions
  }
}

export type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: unknown[];
  pathname?: string;
};

export type ErrorBoundaryState = {
  hasError: boolean;
  error: (Error & { digest?: string }) | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);

    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const pathname = this.props.pathname ?? window.location.pathname;
      if (!hasChunkLoadReloadAttempted(pathname)) {
        const marked = markChunkLoadReloadAttempted(pathname);
        if (marked) {
          window.location.reload();
        }
      }
    }
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKeys) {
      const hasChanged =
        !prevProps.resetKeys ||
        this.props.resetKeys.length !== prevProps.resetKeys.length ||
        this.props.resetKeys.some((key, i) => key !== prevProps.resetKeys?.[i]);
      if (hasChanged) {
        this.reset();
      }
    }
  }

  reset = (): void => {
    if (typeof window !== "undefined") {
      const pathname = this.props.pathname ?? window.location.pathname;
      clearChunkLoadReloadAttempt(pathname);
    }
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.reset);
      }
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return <RouteErrorBoundary error={this.state.error} reset={this.reset} showReload />;
    }

    return this.props.children;
  }
}
