"use client";

import { RefObject, useEffect, useRef } from "react";

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Trap Tab inside an overlay; Escape calls onEscape. Restores prior focus on unmount. */
export function useFocusTrap(
  rootRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  active = true
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      initialFocusRef?.current ??
      focusableIn(root).find(
        (el) => el.tagName === "INPUT" || el.tagName === "SELECT"
      ) ??
      focusableIn(root)[0];
    initial?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [rootRef, initialFocusRef, active]);
}
