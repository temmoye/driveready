# Design System Strategy: High-End Editorial Utility

This document defines the visual and structural language for a premium UK vehicle management experience. We are moving beyond standard utility to create an interface that feels like a high-end concierge—authoritative, clean, and meticulously layered.

---

## 1. Overview & Creative North Star
**The Creative North Star: "The Digital Concierge"**
The aesthetic is rooted in **Precision Layering**. We reject the "flat" web look in favor of a UI that feels like stacked sheets of frosted glass and heavy-stock paper. By using intentional asymmetry in layout and high-contrast typography scales, we transform a utility app into a premium editorial experience. The goal is to make the user feel in total control through a calm, high-clarity environment.

---

## 2. Colors & Surface Philosophy

The palette is anchored in charcoal and neutrals, using status colors as surgical accents rather than dominant themes.

### The "No-Line" Rule
**Prohibit 1px solid borders for sectioning.** Conventional lines create visual "noise" that cheapens the experience. Instead, define boundaries through:
- **Tonal Shifts:** Place a `surface_container_lowest` card on a `surface_container_low` background.
- **Negative Space:** Use the Spacing Scale (e.g., `8` or `10`) to create air between functional groups.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack. Importance is dictated by "height" through color:
1.  **Base Layer:** `surface` (#f8f9fa) – The foundation.
2.  **Sectioning:** `surface_container_low` (#f1f4f6) – Used for grouping related content blocks.
3.  **Actionable Cards:** `surface_container_lowest` (#ffffff) – The highest "physical" layer for primary interactions.
4.  **Recessed Depth:** `surface_dim` (#d1dce0) – Used for inactive states or background elements that need to feel "pressed" into the surface.

### The Glass & Gradient Rule
To achieve a signature fintech polish, use **Glassmorphism** for floating elements (e.g., Sticky Navigation or Modal Headers):
- **Effect:** `surface_container_lowest` at 80% opacity with a `20px` backdrop-blur.
- **CTAs:** Apply a subtle linear gradient to Primary Buttons (from `primary` to `primary_dim`) to give them a tactile, "molded" feel.

---

## 3. Typography: Editorial Authority

We use **Inter** to mimic the San Francisco aesthetic, but we drive authority through extreme scale variance.

*   **Display (Editorial Moments):** Use `display-lg` (3.5rem) for empty states or key vehicle stats (e.g., "0" days until MOT). This creates a "magazine" feel.
*   **Headlines (Information Architecture):** `headline-sm` (1.5rem) should be used for section headers, paired with significant top-padding (`spacing-12`) to allow the content to breathe.
*   **Body & Labels (Utility):** `body-md` (0.875rem) is the workhorse. Ensure `on_surface_variant` is used for labels to create a clear secondary hierarchy against the `on_surface` charcoal text.
*   **Registration Plate Styling:** When displaying UK plates, use a dedicated container with `rounded-sm` corners, a `tertiary_fixed` (Yellow-tinted) background, and `on_tertiary_fixed` (Black) high-contrast bold typography.

---

## 4. Elevation & Depth

We eschew traditional drop shadows for **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface_container_lowest` card placed on a `surface_container` background provides a natural lift.
*   **Ambient Shadows:** If a shadow is required for a floating Action Button, use a custom blur:
    *   `Box-shadow: 0 10px 30px -5px rgba(43, 52, 55, 0.06);` (Using a 6% opacity of the `on_surface` color to mimic natural light).
*   **The "Ghost Border":** For accessibility in input fields, use `outline_variant` at **15% opacity**. Never use 100% opaque borders.

---

## 5. Components

### Cards & Lists (The Core Unit)
*   **Geometry:** Use `rounded-lg` (2rem) for main dashboard cards and `rounded-md` (1.5rem) for nested items.
*   **Separation:** **Forbid divider lines.** Use vertical white space (`spacing-4` to `spacing-6`) or a `surface_container_low` background strip to separate list items.
*   **Interaction:** On tap, cards should subtly scale to 98% and shift to `surface_container_high`.

### Buttons
*   **Primary:** `primary` background, `on_primary` text. `rounded-full` for a modern, friendly touch.
*   **Secondary:** `secondary_container` background with `on_secondary_container` text.
*   **Tertiary:** No background. Bold `primary` text with an icon.

### Status Indicators (Utility-First)
*   **Success:** `tertiary` (#006d4a) for text on `tertiary_container` background.
*   **Warning:** `error_container` (#fe8983) for background with `on_error_container` text for critical alerts.
*   *Note:* Use these sparingly as small "pills" or subtle background washes behind text.

### Vehicle-Specific Components
*   **Timeline Progress:** A vertical track using `outline_variant` (20% opacity) with `tertiary` dots to show vehicle service history.
*   **Document Slots:** `surface_container_lowest` cards with a `ghost-border` to represent uploaded insurance or V5C documents.

---

## 6. Do's and Don'ts

### Do
*   **DO** use asymmetric padding. For example, a card might have `spacing-6` on the left but `spacing-8` on the right to create a sophisticated, non-grid feel.
*   **DO** use "Overlapping Content." Let a vehicle image bleed 20px off the edge of a card to break the container box.
*   **DO** prioritize "Breathing Room." If in doubt, double the spacing.

### Don't
*   **DON'T** use 100% black. Always use `on_surface` (#2b3437) for text to maintain a premium charcoal feel.
*   **DON'T** use standard iOS dividers. They clutter the UI and break the "concierge" flow.
*   **DON'T** use harsh drop shadows. If a shadow is visible at first glance, it is too heavy. It should be felt, not seen.