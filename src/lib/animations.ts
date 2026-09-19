import gsap from "gsap";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Subtle tab content transition on panel switch.
 */
export function animateTabSwitch(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { opacity: 0.85, y: 3 },
      { opacity: 1, y: 0, duration: 0.12, ease: "power1.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Subtle page entrance transition.
 */
export function animatePageEntrance(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { opacity: 0.9, y: 4 },
      { opacity: 1, y: 0, duration: 0.15, ease: "power1.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Subtle modal / form slide entrance.
 */
export function animateModalEntrance(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { opacity: 0, scale: 0.985, y: -4 },
      { opacity: 1, scale: 1, y: 0, duration: 0.14, ease: "power2.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Live SSE event row entrance.
 */
export function animateEventRow(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { opacity: 0, x: -3 },
      { opacity: 1, x: 0, duration: 0.12, ease: "power1.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Staggered list item entrance for multiple items.
 */
export function animateListItems(container: HTMLElement | null, selector = "> *") {
  if (!container || prefersReducedMotion()) return;
  try {
    const items = container.querySelectorAll(selector);
    if (items.length === 0) return;
    gsap.fromTo(
      items,
      { opacity: 0, y: 4 },
      { opacity: 1, y: 0, duration: 0.1, stagger: 0.02, ease: "power1.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Inspector / detail panel slide-in.
 */
export function animateDetailOpen(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { opacity: 0, x: 6 },
      { opacity: 1, x: 0, duration: 0.15, ease: "power2.out", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}

/**
 * Dialog overlay + content entrance.
 */
export function animateDialogOpen(overlay: HTMLElement | null, content: HTMLElement | null) {
  if (prefersReducedMotion()) return;
  try {
    if (overlay) {
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power1.out" });
    }
    if (content) {
      gsap.fromTo(
        content,
        { opacity: 0, scale: 0.97, y: -6 },
        { opacity: 1, scale: 1, y: 0, duration: 0.15, ease: "power2.out", clearProps: "all" }
      );
    }
  } catch {
    /* safe fallback */
  }
}

/**
 * Status badge transition (pulse then settle).
 */
export function animateStatusChange(node: HTMLElement | null) {
  if (!node || prefersReducedMotion()) return;
  try {
    gsap.fromTo(
      node,
      { scale: 0.9 },
      { scale: 1, duration: 0.2, ease: "back.out(2)", clearProps: "all" }
    );
  } catch {
    /* safe fallback */
  }
}
