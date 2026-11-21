// Keep the transcript at its newest line. Returns nothing on purpose: an effect
// that returns a value React can't call crashes the page, and newer Chrome makes
// scrollIntoView return a Promise.
export function scrollToEnd(el: { scrollIntoView?: (opts: ScrollIntoViewOptions) => unknown } | null | undefined): void {
  el?.scrollIntoView?.({ block: "end" });
}
