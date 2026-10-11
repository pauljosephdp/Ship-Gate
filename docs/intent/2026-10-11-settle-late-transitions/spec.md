# Spec: axe waits for late scroll-driven transitions
Intent: intent.md. Status: accepted (Paul, 11 October 2026).

## Requirements
1. After `window.scrollTo(0, 0)`, `settle()` waits three animation frames before it reads `document.getAnimations()`.
2. It then polls every 100 ms and returns after two consecutive polls with no running finite animation, or at the
   existing 3 s deadline.
3. README (axe bullet) says late scroll-driven transitions are waited for. CHANGELOG v3.13.1 (patch); README and caller
   template pins move to v3.13.1.

## Concerns
- Adds about 250 ms to each `settle()` on a quiet page (three frames plus two polls).
- Infinite animations stay ignored, as before.
