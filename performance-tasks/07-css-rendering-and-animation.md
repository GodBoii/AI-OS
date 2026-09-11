# Task 07: Reduce Expensive CSS and GPU Work

## Why this task exists

The interface uses a large amount of blur, shadow, animation, and broad transitions. These effects can look polished on a powerful GPU but cause scrolling lag, delayed clicks, high power usage, and choppy streaming on ordinary hardware.

## What happens today

The styles contain hundreds of `backdrop-filter`, `box-shadow`, animation, and `transition: all` declarations. Many blurred or shadowed elements are nested inside scrolling areas. The Electron window itself is transparent, which makes composition more expensive.

There is no broad use of `content-visibility` or CSS containment to skip rendering off-screen sections. A comment in `css/chat.css` says the reduced-motion preference was removed to force animations, and only a small part of the application respects the operating system setting.

## What should improve

Reserve backdrop blur for a few top-level surfaces where it materially supports the design. Inner cards, message rows, menus inside scrolling containers, and repeated list items should normally use an opaque or lightly transparent background without their own blur.

Animate `transform` and `opacity` where possible. Replace `transition: all` with the exact properties that need animation. Pause decorative animation when a panel is hidden or the window is not focused.

Respect `prefers-reduced-motion` across the entire application. Add an optional low-effects mode that disables blur and decorative movement without changing layout or functionality.

Use `content-visibility: auto` and appropriate containment for long lists, session history, settings panels, and other off-screen content. Virtualize lists when they can contain hundreds of rows.

## Implementation guidance

Begin with a GPU and rendering trace while scrolling a long chat and while an answer streams. Identify layers that repaint repeatedly. Change one component group at a time and compare paint time, layer count, and visual output.

Create shared surface and motion tokens rather than allowing every file to define a different blur or shadow. This keeps the visual system consistent and makes a low-effects theme straightforward.

Do not apply containment blindly. Popovers, sticky headers, and elements that intentionally escape their parent need testing.

## Risks and special cases

Removing effects globally in one pass may create contrast or readability problems. Preserve sufficient background contrast and keyboard focus visibility. Reduced motion should stop movement without hiding status or progress information.

## Completion check

Long chats should scroll smoothly while streaming, and hidden views should stop consuming animation time. A system-level reduced-motion setting must visibly reduce nonessential movement. Performance traces should show fewer large repaints and no repeated expensive blur across every chat row.
