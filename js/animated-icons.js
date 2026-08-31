/**
 * Animated icons.
 *
 * When the "Animated icons" preference is on, the static icons across the app
 * chrome get replaced on screen by hand-authored inline SVGs that animate
 * continuously, and animate harder on hover, focus and state change.
 *
 * Four design decisions worth knowing before editing this file:
 *
 * 1. The swap is additive. The original `<i>` or `<svg>` node stays in the DOM
 *    with `.anim-icon-hidden` on it instead of being deleted, so code that owns
 *    that node keeps working: `UIManager.updateTheme` still flips the theme
 *    button's Font Awesome class, `AIOS.updateUserUI` still owns the avatar
 *    container, and `setPrimaryComposerIcon` still owns the send button.
 *    Turning the preference off just unhides the original.
 *
 * 2. Every path draws with `currentColor` and no baked fill, so the icons follow
 *    the existing `body.dark-mode` / light theme rules with no per-theme asset
 *    and no runtime recolouring. This is also why these are inline SVGs rather
 *    than Lottie JSON: Lottie bakes RGB values into the file, which would need
 *    patching on every theme flip.
 *
 * 3. Motion is declared by labelling parts, not by writing a bespoke animation
 *    per icon. A part carries `data-p="<primitive>"` naming one of the shared
 *    motions in css/animated-icons.css, plus an optional `data-s="1..4"` stagger
 *    step. Adding an icon therefore costs no CSS. Parts that need a pivot other
 *    than the icon centre carry an inline `transform-origin`.
 *
 * 4. Loops run all the time, so each mounted icon gets a `--ai-phase` offset.
 *    Without it 40 icons would pulse in lockstep, which reads as a glitch rather
 *    than as life. The motion itself occupies only the first ~28% of each cycle;
 *    the rest is a hold, which is what keeps a permanent loop calm and keeps the
 *    compositor idle most of the time.
 *
 * This module never writes to localStorage. `AIOS.initSettingsListeners` owns
 * the `aetheria-general-settings` blob; this module only reads it so there is a
 * single writer.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'aetheria-general-settings';
    const PREF_KEY = 'animatedIcons';
    const BODY_CLASS = 'animated-icons';
    const PAUSED_CLASS = 'anim-icons-paused';
    const HOVER_CLASS = 'anim-icon-hover';
    /**
     * An attribute, not a class, on purpose. `UIManager.updateTheme`,
     * `updateWindowControls` and `updateActiveWorkspacePill` all assign
     * `icon.className = 'fas fa-...'` wholesale. A marker class would be wiped
     * by those writes, unhiding the original glyph and leaving two icons stacked
     * in the same button. An attribute survives them.
     */
    const HIDDEN_ATTR = 'data-anim-hidden';

    /** WCAG AA floor for non-text UI indicators. */
    const CONTRAST_FLOOR = 3;
    /** Re-check points after a theme change, spanning the app's transitions. */
    const THEME_SETTLE_MS = [120, 550, 1200];
    /* Slate 900 and slate 200, both already used across the app's palette. Held
       as channels rather than hex because parseColour only reads rgb()/rgba(). */
    const INK_DARK = { r: 15, g: 23, b: 42, a: 1 };
    const INK_LIGHT = { r: 226, g: 232, b: 240, a: 1 };

    /* ── Icon library ────────────────────────────────────────────────────
     * 24x24 viewBox, stroke-only, round joins. Geometry matches the Lucide
     * icons already inlined across the app so enabling the preference changes
     * the motion, not the drawing style.
     *
     * `data-p` names the motion primitive, `data-s` staggers it. Paths that draw
     * themselves carry `pathLength="1"` so the stroke-dash motion works without
     * measuring geometry at runtime.
     */
    const ICONS = {
        /* Chrome and navigation */
        gear: '<path data-p="spin" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>'
            + '<circle data-p="pulse" cx="12" cy="12" r="3"/>',

        tasks: '<rect data-p="pulse" x="3" y="5" width="6" height="6" rx="1" style="transform-origin:6px 8px"/>'
            + '<path data-p="draw" pathLength="1" d="m3 17 2 2 4-4"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M13 6h8"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M13 12h8"/>'
            + '<path data-p="draw" data-s="3" pathLength="1" d="M13 18h8"/>',

        code: '<polyline data-p="right" points="16 18 22 12 16 6"/>'
            + '<polyline data-p="left" points="8 6 2 12 8 18"/>'
            + '<line data-p="fade" pathLength="1" x1="14" x2="10" y1="4" y2="20"/>',

        monitor: '<rect data-p="swell" width="20" height="14" x="2" y="3" rx="2" style="transform-origin:12px 10px"/>'
            + '<line x1="8" x2="16" y1="21" y2="21"/>'
            + '<line data-p="draw" data-s="2" pathLength="1" x1="12" x2="12" y1="17" y2="21"/>'
            + '<line data-p="sweep" x1="5" x2="19" y1="6" y2="6"/>',

        sun: '<circle data-p="pulse" cx="12" cy="12" r="4"/>'
            + '<g data-p="spin"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/>'
            + '<path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/>'
            + '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></g>',

        moon: '<path data-p="tilt" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
            + '<circle data-p="fade" data-s="1" cx="17.5" cy="4.5" r="0.7" fill="currentColor" stroke="none" style="transform-origin:17.5px 4.5px"/>'
            + '<circle data-p="fade" data-s="3" cx="20.5" cy="8.5" r="0.55" fill="currentColor" stroke="none" style="transform-origin:20.5px 8.5px"/>',

        minimize: '<path data-p="press" d="M5 12h14"/>',

        maximize: '<path data-p="out-tl" d="M8 3H5a2 2 0 0 0-2 2v3"/>'
            + '<path data-p="out-tr" d="M16 3h3a2 2 0 0 1 2 2v3"/>'
            + '<path data-p="out-br" d="M21 16v3a2 2 0 0 1-2 2h-3"/>'
            + '<path data-p="out-bl" d="M3 16v3a2 2 0 0 0 2 2h3"/>',

        restore: '<path data-p="out-br" d="M3 8h3a2 2 0 0 0 2-2V3"/>'
            + '<path data-p="out-bl" d="M21 8h-3a2 2 0 0 1-2-2V3"/>'
            + '<path data-p="out-tr" d="M3 16h3a2 2 0 0 1 2 2v3"/>'
            + '<path data-p="out-tl" d="M21 16h-3a2 2 0 0 0-2 2v3"/>',

        close: '<g data-p="tilt"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></g>',

        user: '<circle data-p="swell" cx="12" cy="12" r="10"/>'
            + '<circle data-p="up" cx="12" cy="10" r="3"/>'
            + '<path data-p="press" d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',

        sparkles: '<path data-p="tilt" d="M9.94 15.5A2 2 0 0 0 8.5 14.06L2.37 12.48a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>'
            + '<g data-p="fade" style="transform-origin:20px 5px"><path d="M20 3v4"/><path d="M22 5h-4"/></g>'
            + '<g data-p="fade" data-s="2" style="transform-origin:4px 18px"><path d="M4 17v2"/><path d="M5 18H3"/></g>',

        plug: '<path data-p="draw" pathLength="1" d="M12 22v-5"/>'
            + '<path data-p="up" d="M9 8V2"/>'
            + '<path data-p="up" data-s="1" d="M15 8V2"/>'
            + '<path data-p="down" d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',

        rocket: '<path data-p="flick" d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" style="transform-origin:5px 19px"/>'
            + '<g data-p="lift"><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>'
            + '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>'
            + '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></g>',

        vault: '<rect data-p="hinge" width="20" height="5" x="2" y="3" rx="1" style="transform-origin:3px 8px"/>'
            + '<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M10 12h4"/>',

        brain: '<path data-p="dim" d="M12 5a3 3 0 1 0-6 .13 4 4 0 0 0-2.53 5.77 4 4 0 0 0 .56 6.59A4 4 0 1 0 12 18Z" style="transform-origin:8px 12px"/>'
            + '<path data-p="dim" data-s="2" d="M12 5a3 3 0 1 1 6 .13 4 4 0 0 1 2.53 5.77 4 4 0 0 1-.56 6.59A4 4 0 1 1 12 18Z" style="transform-origin:16px 12px"/>',

        cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/>'
            + '<rect data-p="pulse" width="6" height="6" x="9" y="9" rx="1"/>'
            + '<g data-p="dim"><path d="M9 2v2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M15 20v2"/></g>'
            + '<g data-p="dim" data-s="2"><path d="M15 2v2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M9 20v2"/></g>',

        info: '<circle data-p="swell" cx="12" cy="12" r="10"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M12 16v-4"/>'
            + '<path data-p="drop" d="M12 8h.01" style="transform-origin:12px 8px"/>',

        headset: '<path data-p="swell" d="M3 16v-4a9 9 0 0 1 18 0v4" style="transform-origin:12px 16px"/>'
            + '<rect data-p="swell" x="2" y="14" width="5.5" height="7" rx="2" style="transform-origin:4.75px 17.5px"/>'
            + '<rect data-p="swell" data-s="2" x="16.5" y="14" width="5.5" height="7" rx="2" style="transform-origin:19.25px 17.5px"/>',

        refresh: '<g data-p="spin"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>'
            + '<path d="M21 3v5h-5"/>'
            + '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>'
            + '<path d="M8 16H3v5"/></g>',

        bell: '<g data-p="dim"><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/></g>'
            + '<path data-p="tilt" d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" style="transform-origin:12px 3px"/>'
            + '<path data-p="right" d="M10.27 21a2 2 0 0 0 3.46 0"/>',

        keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/>'
            + '<g data-p="press"><path d="M6 8h.01"/><path d="M12 12h.01"/><path d="M18 8h.01"/></g>'
            + '<g data-p="press" data-s="1"><path d="M10 8h.01"/><path d="M16 12h.01"/><path d="M8 12h.01"/></g>'
            + '<g data-p="press" data-s="2"><path d="M14 8h.01"/></g>'
            + '<path data-p="draw" data-s="3" pathLength="1" d="M7 16h10"/>',

        /* Composer */
        plus: '<g data-p="spin"><path d="M5 12h14"/><path d="M12 5v14"/></g>',

        attach: '<path data-p="tilt" d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',

        shuffle: '<g data-p="right"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/></g>'
            + '<path data-p="draw" pathLength="1" d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.46-8.6a4 4 0 0 1 3.3-1.7H22"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M2 6h1.97a4 4 0 0 1 3.6 2.2"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45"/>',

        chat: '<path data-p="swell" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
            + '<path data-p="dim" d="M8 10h.01"/>'
            + '<path data-p="dim" data-s="1" d="M12 10h.01"/>'
            + '<path data-p="dim" data-s="2" d="M16 10h.01"/>',

        folder: '<path data-p="swell" d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.2-1.8A2 2 0 0 0 7.55 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',

        plan: '<path data-p="swell" d="M14.1 5.55a2 2 0 0 0 1.79 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.79 0l-4.21-2.1a2 2 0 0 0-1.79 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.79 0z"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M15 5.76v15"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M9 3.24v15"/>',

        mic: '<rect data-p="pulse" x="9" y="2" width="6" height="13" rx="3"/>'
            + '<path data-p="swell" d="M19 10v2a7 7 0 0 1-14 0v-2" style="transform-origin:12px 12px"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M12 19v3"/>',

        send: '<path data-p="lift" d="M14.54 21.69a.5.5 0 0 0 .93-.03l6.5-19a.5.5 0 0 0-.63-.63l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="m21.85 2.15-10.94 10.94"/>',

        voice: '<rect data-p="bar" x="2.6" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" stroke="none"/>'
            + '<rect data-p="bar" data-s="1" x="7.2" y="6.5" width="2.2" height="11" rx="1.1" fill="currentColor" stroke="none"/>'
            + '<rect data-p="bar" data-s="2" x="11.8" y="4" width="2.2" height="16" rx="1.1" fill="currentColor" stroke="none"/>'
            + '<rect data-p="bar" data-s="3" x="16.4" y="6.5" width="2.2" height="11" rx="1.1" fill="currentColor" stroke="none"/>'
            + '<rect data-p="bar" data-s="4" x="21" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" stroke="none"/>',

        tools: '<path data-p="tilt" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',

        unlock: '<rect data-p="pulse" width="18" height="11" x="3" y="11" rx="2" style="transform-origin:12px 16.5px"/>'
            + '<path data-p="up" d="M7 11V7a5 5 0 0 1 9.9-1"/>',

        hide: '<g data-p="dim"><path d="M10.73 5.08a10.74 10.74 0 0 1 11.21 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/>'
            + '<path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/>'
            + '<path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/></g>'
            + '<path data-p="draw" pathLength="1" d="m2 2 20 20"/>',

        exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'
            + '<polyline data-p="right" points="16 17 21 12 16 7"/>'
            + '<line data-p="draw" pathLength="1" x1="21" x2="9" y1="12" y2="12"/>',

        design: '<path data-p="swell" d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'
            + '<path data-p="tilt" d="M18.37 2.63a2.12 2.12 0 1 1 3 3L12 15l-4 1 1-4Z" style="transform-origin:10px 16px"/>',

        layers: '<path data-p="up" d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/>'
            + '<path data-p="up" data-s="1" d="m6.08 9.5-3.48 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83L17.9 9.5"/>'
            + '<path data-p="up" data-s="2" d="m6.08 14.5-3.48 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83L17.9 14.5"/>',

        arrow: '<g data-p="right"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></g>',

        /* Workspaces */
        sidebar: '<rect data-p="swell" width="18" height="18" x="3" y="3" rx="2"/>'
            + '<path data-p="left" d="M9 3v18"/>',

        terminal: '<polyline data-p="right" points="4 17 10 11 4 5"/>'
            + '<line data-p="draw" data-s="1" pathLength="1" x1="12" x2="20" y1="19" y2="19"/>',

        cloud: '<path data-p="swell" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',

        git: '<path data-p="swell" d="M15 22v-4a4.8 4.8 0 0 0-1-3.24c3-.34 6-1.53 6-6.6a5.4 5.4 0 0 0-1.5-3.8 5 5 0 0 0-.1-3.8s-1.2-.4-3.9 1.4a13.3 13.3 0 0 0-7 0c-2.7-1.8-3.9-1.4-3.9-1.4a5 5 0 0 0-.1 3.8A5.4 5.4 0 0 0 2 12.16c0 5.1 3 6.3 6 6.6a4.8 4.8 0 0 0-1 3.24v4"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M9 18c-4.51 2-5-2-7-2"/>',

        eye: '<path data-p="swell" d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0Z"/>'
            + '<circle data-p="pulse" cx="12" cy="12" r="3"/>',

        external: '<path data-p="out-tr" d="M15 3h6v6"/>'
            + '<path data-p="out-tr" d="M10 14 21 3"/>'
            + '<path data-p="swell" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',

        branch: '<line data-p="draw" pathLength="1" x1="6" x2="6" y1="3" y2="15"/>'
            + '<circle data-p="pulse" cx="18" cy="6" r="3" style="transform-origin:18px 6px"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M18 9a9 9 0 0 1-9 9"/>'
            + '<circle data-p="pulse" data-s="2" cx="6" cy="18" r="3" style="transform-origin:6px 18px"/>',

        download: '<path data-p="swell" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
            + '<g data-p="down"><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></g>',

        file: '<path data-p="swell" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>'
            + '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>'
            + '<path data-p="draw" data-s="1" pathLength="1" d="M10 9H8"/>'
            + '<path data-p="draw" data-s="2" pathLength="1" d="M16 13H8"/>'
            + '<path data-p="draw" data-s="3" pathLength="1" d="M16 17H8"/>',

        check: '<polyline data-p="draw" pathLength="1" points="20 6 9 17 4 12"/>'
    };

    /* ── Swap targets ────────────────────────────────────────────────────
     * `sel`      host element that owns the icon
     * `icon`     registry key, or `resolve()` when app state picks the variant
     * `variant`  sizing bucket, mirrored in css/animated-icons.css
     * `iconSel`  which child to replace, when the host holds more than one icon
     * `skipIf`   leave the host alone when it matches (e.g. a real avatar photo)
     * `hoverSel` element whose hover drives the animation, when it is not `sel`
     */
    const TARGETS = [
        // ── Sidebar rail ──
        { sel: '#aios-settings-avatar-container', icon: 'gear', variant: 'rail', hoverSel: '#app-icon', skipIf: 'img.user-avatar, .user-initials-avatar' },
        { sel: '#to-do-list-icon', icon: 'tasks', variant: 'rail' },
        { sel: '#project-workspace-icon', icon: 'code', variant: 'rail' },
        { sel: '#computer-workspace-icon', icon: 'monitor', variant: 'rail' },

        // ── Window controls ──
        { sel: '#theme-toggle', variant: 'chrome', resolve: () => (document.body.classList.contains('dark-mode') ? 'sun' : 'moon') },
        { sel: '#minimize-window', icon: 'minimize', variant: 'chrome' },
        { sel: '#resize-window', variant: 'chrome', resolve: () => (document.querySelector('#resize-window i.fa-compress') ? 'restore' : 'maximize') },
        { sel: '#close-window', icon: 'close', variant: 'chrome' },

        // ── Settings window navigation ──
        { sel: '.tabs-sidebar [data-tab="account"]', icon: 'user', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="skills"]', icon: 'sparkles', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="integration"]', icon: 'plug', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="deployments"]', icon: 'rocket', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="database"]', icon: 'vault', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="memory"]', icon: 'brain', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="capabilities"]', icon: 'cpu', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="settings"]', icon: 'gear', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="about"]', icon: 'info', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="support"]', icon: 'headset', variant: 'tab' },
        { sel: '.tabs-sidebar [data-tab="updates"]', icon: 'refresh', variant: 'tab' },

        // ── Settings card headers ──
        { sel: '#settings-tab [data-settings-icon="notifications"]', icon: 'bell', variant: 'card' },
        { sel: '#settings-tab [data-settings-icon="shortcuts"]', icon: 'keyboard', variant: 'card' },
        { sel: '#settings-tab [data-settings-icon="appearance"]', icon: 'sparkles', variant: 'card' },
        { sel: '#settings-tab [data-settings-icon="general"]', icon: 'gear', variant: 'card' },

        // ── Chat composer toolbar ──
        { sel: '.input-toolbar .add-btn', icon: 'plus', variant: 'composer' },
        { sel: '#attach-file-btn', icon: 'attach', variant: 'composer' },
        { sel: '.input-toolbar .shuffle-btn', icon: 'shuffle', variant: 'composer', iconSel: ':scope > i' },
        { sel: '.input-toolbar .tool-btn[data-tool="context"]', icon: 'chat', variant: 'composer' },
        { sel: '#view-content-btn', icon: 'folder', variant: 'composer' },
        { sel: '#ultra-think-btn', icon: 'brain', variant: 'composer' },
        { sel: '#plan-mode-btn', icon: 'plan', variant: 'composer' },
        { sel: '#mic-button', icon: 'mic', variant: 'composer' },
        // The send button's icon host has its innerHTML rewritten by
        // setPrimaryComposerIcon, so it resolves its shape from that state and
        // gets remounted from a hook there.
        {
            sel: '#send-message [data-composer-icon]',
            variant: 'composer-send',
            resolve: () => (document.getElementById('send-message')?.dataset.composerAction === 'send' ? 'send' : 'voice'),
            hoverSel: '#send-message'
        },

        // Shuffle dropdown rows
        { sel: '.shuffle-item[data-action="memory"] .shuffle-item-content', icon: 'brain', variant: 'composer', hoverSel: '.shuffle-item[data-action="memory"]' },
        { sel: '.shuffle-item[data-action="tools"] .shuffle-item-content', icon: 'tools', variant: 'composer', hoverSel: '.shuffle-item[data-action="tools"]' },

        // ── Computer workspace toolbar ──
        { sel: '#computer-toolbar-trigger', icon: 'monitor', variant: 'composer', iconSel: 'i.fa-desktop' },
        { sel: '#computer-manual-grant-btn', icon: 'unlock', variant: 'composer' },
        { sel: '#computer-select-scope-btn', icon: 'folder', variant: 'composer' },
        { sel: '#computer-workspace-close', icon: 'hide', variant: 'composer' },
        { sel: '#computer-exit-btn', icon: 'exit', variant: 'composer' },

        // ── Chat surfaces and floating actions ──
        { sel: '#active-workspace-pill', variant: 'composer', resolve: () => (document.querySelector('#active-workspace-pill i.fa-desktop') ? 'monitor' : 'code') },
        { sel: '.context-active-indicator', icon: 'layers', variant: 'composer' },
        { sel: '#project-know-me-btn', icon: 'info', variant: 'composer' },
        { sel: '#computer-know-me-btn', icon: 'info', variant: 'composer' },
        { sel: '#design-mode-toggle-btn', icon: 'design', variant: 'composer' },
        { sel: '#project-main-file-preview-close', icon: 'close', variant: 'panel' },
        { sel: '#project-local-terminal-close', icon: 'close', variant: 'panel' },
        { sel: '#project-local-terminal-send', icon: 'arrow', variant: 'panel' },
        { sel: '#context-info-btn', icon: 'info', variant: 'panel' },
        { sel: '#session-history-info-btn', icon: 'info', variant: 'panel' },
        { sel: '#history-view-content-btn', icon: 'folder', variant: 'panel' },
        { sel: '#selected-context-viewer .close-viewer-btn', icon: 'close', variant: 'panel' },

        // ── Coder workspace ──
        { sel: '#super-sidebar-toggle-btn', icon: 'sidebar', variant: 'panel' },
        { sel: '#super-terminal-btn', icon: 'terminal', variant: 'panel' },
        { sel: '#super-sync-btn', icon: 'refresh', variant: 'panel' },
        { sel: '#super-cloud-btn', icon: 'cloud', variant: 'pill' },
        { sel: '#super-local-btn', icon: 'monitor', variant: 'pill' },
        { sel: '#super-github-btn', icon: 'git', variant: 'pill' },
        { sel: '.project-workspace-icon', icon: 'code', variant: 'panel-lg' },
        { sel: '#project-exit-btn', icon: 'exit', variant: 'panel-sm' },
        { sel: '#project-workspace-close', icon: 'close', variant: 'panel' },
        { sel: '#project-redeploy-btn', icon: 'refresh', variant: 'panel-sm' },
        { sel: '#project-preview-btn', icon: 'eye', variant: 'panel-sm' },
        { sel: '#project-deploy-btn', icon: 'rocket', variant: 'panel-sm' },

        // ── GitHub panel ──
        { sel: '.ghp-mark', icon: 'git', variant: 'panel' },
        { sel: '#ghp-remote-btn', icon: 'external', variant: 'panel-sm' },
        { sel: '#ghp-refresh-btn', icon: 'refresh', variant: 'panel-sm' },
        { sel: '#ghp-close-btn', icon: 'close', variant: 'panel-sm' },
        { sel: '#ghp-branch-chip', icon: 'branch', variant: 'panel-xs' },
        { sel: '#ghp-open-folder-btn', icon: 'folder', variant: 'panel-xs' },
        { sel: '#ghp-reveal-folder-btn', icon: 'external', variant: 'panel-xs' },
        { sel: '#ghp-terminal-btn', icon: 'terminal', variant: 'panel-xs' },

        // ── Tasks panel ──
        { sel: '#tasks-add-fab', icon: 'plus', variant: 'panel' },
        { sel: '.tasks-empty-icon', icon: 'tasks', variant: 'hero' },
        { sel: '.task-output-panel-icon', icon: 'file', variant: 'panel-sm' },
        { sel: '#task-output-panel-download', icon: 'download', variant: 'panel-xs' },
        { sel: '#task-output-panel-close', icon: 'close', variant: 'panel-sm' },
        { sel: '#new-task-modal #cancel-task-btn', icon: 'close', variant: 'panel' },

        // ── Design mode ──
        { sel: '#design-mode-edit-tab', icon: 'design', variant: 'panel-xs' },
        { sel: '#design-mode-comment-tab', icon: 'chat', variant: 'panel-xs' },
        { sel: '#design-mode-refresh-btn', icon: 'refresh', variant: 'panel-sm' },
        { sel: '#design-mode-done-btn', icon: 'check', variant: 'panel-sm' },
        { sel: '#design-mode-close-btn', icon: 'close', variant: 'panel-sm' }
    ];

    /** Reads the persisted preference. Defaults to off. */
    function readPreference() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            return !!JSON.parse(raw)[PREF_KEY];
        } catch (_err) {
            return false;
        }
    }

    /* ── Colour maths, for the legibility check ──────────────────────── */

    function parseColour(value) {
        const parts = String(value).match(/[\d.]+/g) || [];
        return {
            r: Number(parts[0]) || 0,
            g: Number(parts[1]) || 0,
            b: Number(parts[2]) || 0,
            a: parts[3] === undefined ? 1 : Number(parts[3])
        };
    }

    /**
     * Source-over: `fg` painted on top of `bg`.
     *
     * The accumulated alpha matters. An earlier version returned `a: 1`
     * unconditionally, which made surfaceColour stop after two layers and
     * report the app's translucent glass panels as near-opaque white. That in
     * turn told the legibility check a dark panel was light, so it painted dark
     * ink onto dark glass.
     */
    function composite(fg, bg) {
        const a = fg.a + bg.a * (1 - fg.a);
        if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
        const blend = (f, b) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
        return { r: blend(fg.r, bg.r), g: blend(fg.g, bg.g), b: blend(fg.b, bg.b), a };
    }

    function relativeLuminance(colour) {
        const channel = (raw) => {
            const v = raw / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
    }

    function contrastRatio(fg, bg) {
        const a = relativeLuminance(composite(fg, bg));
        const b = relativeLuminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    /**
     * The colour actually painted behind an element: the nearest painted
     * ancestors composited down until the stack is opaque.
     */
    /** Whatever the page ultimately paints on, when no layer was opaque. */
    function themeCanvas() {
        return document.body.classList.contains('dark-mode')
            ? { r: 10, g: 10, b: 12, a: 1 }
            : { r: 250, g: 250, b: 250, a: 1 };
    }

    function compositeStack(nodes) {
        let acc = { r: 0, g: 0, b: 0, a: 0 };
        for (const node of nodes) {
            const bg = parseColour(getComputedStyle(node).backgroundColor);
            if (bg.a > 0.001) acc = composite(acc, bg);
            if (acc.a >= 0.99) return acc;
        }
        // Nothing was opaque, which happens when the page paints itself with a
        // gradient rather than a background-color.
        return composite(acc, themeCanvas());
    }

    /**
     * The colour actually painted behind an element.
     *
     * Uses hit-test order rather than the DOM ancestor chain, because for
     * positioned elements the two disagree and only the first one is what the
     * eye sees. The window controls are `position: fixed` over a sibling: their
     * ancestors are all transparent down to a black body, while what is really
     * behind them in light mode is the dark glass bar over the light chat
     * surface. Walking ancestors reported near-black and the icons were given
     * pale ink that then sat on mid-grey.
     *
     * Falls back to the ancestor walk for elements with no box, which is the
     * case for anything inside a panel that has not been opened yet.
     */
    function surfaceColour(element) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
            const painted = document.elementsFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2
            );
            const start = painted.indexOf(element);
            // elementsFromPoint is front to back, so everything from the host
            // onwards is painted behind the icon's ink.
            return compositeStack(start >= 0 ? painted.slice(start) : painted);
        }

        const ancestors = [];
        for (let node = element; node; node = node.parentElement) ancestors.push(node);
        return compositeStack(ancestors);
    }

    function buildIcon(key, variant) {
        const body = ICONS[key];
        if (!body) return null;
        // The HTML parser handles foreign content, so an SVG built this way ends
        // up in the correct namespace without manual createElementNS calls.
        const holder = document.createElement('div');
        holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
            + ' stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'
            + ' class="anim-icon" data-anim-icon="' + key + '" data-anim-variant="' + variant + '"'
            + ' aria-hidden="true" focusable="false">' + body + '</svg>';
        return holder.firstElementChild;
    }

    class AnimatedIconManager {
        constructor() {
            /** @type {Map<Element, {svg: SVGElement, hidden: Element[], hoverEl: Element, onEnter: Function, onLeave: Function, phase: number}>} */
            this.mounted = new Map();
            this.enabled = false;
            this.settingsObserver = null;
            this.themeObserver = null;
            this.themeSettleTimers = [];
            this.visibilityBound = false;
            this.phaseCounter = 0;
        }

        /* ── Public API ─────────────────────────────────────────────── */

        isEnabled() {
            return this.enabled;
        }

        /**
         * Applies or removes the animated icons. Does not persist; the settings
         * panel owns the stored value.
         */
        setEnabled(on) {
            const next = !!on;
            if (next === this.enabled) {
                if (next) this.refresh();
                return;
            }
            this.enabled = next;
            document.body.classList.toggle(BODY_CLASS, next);
            if (next) {
                this.mountAll();
                this.watchSettingsWindow();
                this.watchVisibility();
                this.watchTheme();
            } else {
                this.unmountAll();
                this.unwatchSettingsWindow();
            }
        }

        /**
         * Mounts any target that appeared since the last pass. Safe to spam.
         * Pass a selector to limit the pass to one target, which is what the
         * composer hook does on every keystroke.
         */
        refresh(selector) {
            if (!this.enabled) return;
            TARGETS.forEach((target) => {
                if (selector && target.sel !== selector) return;
                this.mount(target);
            });
        }

        /**
         * Switches a mounted host to a different icon and replays it. Used for
         * the icons whose shape tracks app state (theme, maximise, workspace).
         */
        setIcon(selector, key) {
            if (!this.enabled) return;
            const host = document.querySelector(selector);
            const entry = host && this.mounted.get(host);
            if (!entry || entry.svg.dataset.animIcon === key) return;
            const replacement = buildIcon(key, entry.svg.dataset.animVariant);
            if (!replacement) return;
            replacement.style.setProperty('--ai-phase', String(-entry.phase));
            entry.svg.replaceWith(replacement);
            entry.svg = replacement;
            this.ensureLegible(replacement);
            this.play(replacement);
        }

        /** Registry keys, in declaration order. */
        keys() {
            return Object.keys(ICONS);
        }

        /** The declared swap list, for coverage checks. */
        targets() {
            return TARGETS.slice();
        }

        /** The SVG markup for a key, for previews and tests. */
        markup(key, variant) {
            return buildIcon(key, variant || 'preview')?.outerHTML || '';
        }

        /**
         * Restarts an icon's loop from the top of its motion.
         *
         * The loops carry a negative `animation-delay` for phase offset, so
         * `currentTime = 0` would land mid-cycle. The start of the active phase
         * is at `currentTime === delay`, which is where a replay belongs.
         */
        play(target) {
            const svg = target instanceof SVGElement ? target : this.mounted.get(target)?.svg;
            if (!svg || !svg.getAnimations) return;
            svg.getAnimations({ subtree: true }).forEach((animation) => {
                try {
                    animation.currentTime = animation.effect?.getComputedTiming?.().delay || 0;
                } catch (_err) {
                    /* An animation can be detached mid-frame; nothing to replay. */
                }
            });
        }

        /* ── Mounting ───────────────────────────────────────────────── */

        mountAll() {
            TARGETS.forEach((target) => this.mount(target));
        }

        mount(target) {
            const host = document.querySelector(target.sel);
            if (!host) return;
            if (target.skipIf && host.querySelector(target.skipIf)) {
                this.unmount(host);
                return;
            }

            const existing = this.mounted.get(host);
            if (existing) {
                // Still healthy. Nothing to do.
                if (existing.svg.parentNode === host) return;
                // Another module rewrote the host's contents (the avatar
                // container and the send button both do) and took our node with
                // it. Drop the stale entry and mount again, reusing the phase so
                // the icon does not jump to a different point in its cycle.
                this.detachListeners(existing);
                this.mounted.delete(host);
            }

            const key = target.resolve ? target.resolve() : target.icon;
            const svg = buildIcon(key, target.variant);
            if (!svg) return;

            // Clear any orphan from an earlier mount whose bookkeeping was lost,
            // so a host can never end up showing two icons.
            host.querySelectorAll(':scope > .anim-icon').forEach((orphan) => orphan.remove());

            // A host with several icons (the computer trigger carries a glyph and
            // a chevron) names the one to replace; otherwise take them all.
            const hidden = target.iconSel
                ? Array.from(host.querySelectorAll(target.iconSel))
                : Array.from(host.children).filter((child) => child.matches('i, svg, img'));
            hidden.forEach((child) => child.setAttribute(HIDDEN_ATTR, ''));

            if (hidden.length) {
                host.insertBefore(svg, hidden[0]);
            } else {
                host.insertBefore(svg, host.firstChild);
            }

            // Spread the loops around the cycle. 0.382 is irrational enough over
            // small counts that consecutive icons never land near each other.
            const phase = existing ? existing.phase : (this.phaseCounter++ * 0.382) % 1;
            svg.style.setProperty('--ai-phase', String(-phase));

            // pointerenter/leave do not bubble, so these fire only for the hover
            // element and cost nothing while the pointer is elsewhere.
            const hoverEl = (target.hoverSel && document.querySelector(target.hoverSel)) || host;
            const onEnter = () => {
                svg.classList.add(HOVER_CLASS);
                this.play(svg);
            };
            const onLeave = () => svg.classList.remove(HOVER_CLASS);
            hoverEl.addEventListener('pointerenter', onEnter);
            hoverEl.addEventListener('pointerleave', onLeave);
            hoverEl.addEventListener('focus', onEnter);
            hoverEl.addEventListener('blur', onLeave);

            this.mounted.set(host, { svg, hidden, hoverEl, onEnter, onLeave, phase });
            this.ensureLegible(svg);
        }

        detachListeners(entry) {
            entry.hoverEl.removeEventListener('pointerenter', entry.onEnter);
            entry.hoverEl.removeEventListener('pointerleave', entry.onLeave);
            entry.hoverEl.removeEventListener('focus', entry.onEnter);
            entry.hoverEl.removeEventListener('blur', entry.onLeave);
        }

        unmount(host) {
            const entry = this.mounted.get(host);
            if (!entry) return;
            this.detachListeners(entry);
            entry.svg.remove();
            entry.hidden.forEach((child) => child.removeAttribute(HIDDEN_ATTR));
            this.mounted.delete(host);
        }

        unmountAll() {
            Array.from(this.mounted.keys()).forEach((host) => this.unmount(host));
        }

        /* ── Legibility ─────────────────────────────────────────────── */

        /**
         * Guarantees the icon is actually visible on the surface it landed on.
         *
         * Inheriting the host's colour is the right default and matches how the
         * light theme treats font glyphs. It is not universally safe, though,
         * because that theme converts some panels to light and leaves others
         * dark. The coder workspace header stays near-black in light mode while
         * `--icon-color` stays a translucent white; the GitHub panel goes white
         * while its buttons keep that same translucent white. Inheriting is
         * correct on the first and invisible on the second.
         *
         * Reverse-engineering which of ~80 hosts falls on which side would rot
         * the moment a panel is restyled, so this measures the outcome instead:
         * if the inherited colour does not clear the 3:1 WCAG floor for non-text
         * indicators, it is replaced with the readable end of that surface.
         */
        ensureLegible(svg) {
            const measured = this.measureLegibility(svg);
            if (!measured || measured.ratio >= CONTRAST_FLOOR) return;

            // Below the floor. Score both candidate inks against this surface
            // and take the better one, rather than deciding from the surface's
            // luminance. A threshold gets mid-greys wrong: at rgb(136,136,136)
            // the light ink scores 2.9 and the dark ink 5.9, but a luminance
            // test reads that surface as dark and reaches for the light ink.
            const best = [INK_DARK, INK_LIGHT]
                .map((ink) => ({ ink, ratio: contrastRatio(ink, measured.surface) }))
                .sort((a, b) => b.ratio - a.ratio)[0];

            // Never trade down. If the inherited colour already beats both
            // candidates, the surface is the problem and repainting the icon
            // cannot fix it.
            if (best.ratio <= measured.ratio) return;

            const ink = `rgb(${best.ink.r},${best.ink.g},${best.ink.b})`;
            // A computed decision of last resort has to outrank everything,
            // including per-panel rules like `.ghp-quick-row svg` that set a
            // colour the surrounding theme no longer matches. Stroke and fill go
            // alongside `color` because parts resolve `currentColor` against
            // themselves, not against the root.
            svg.style.setProperty('color', ink, 'important');
            svg.style.setProperty('stroke', ink, 'important');
            svg.querySelectorAll('[fill="currentColor"]').forEach((filled) => {
                filled.style.setProperty('fill', ink, 'important');
            });
        }

        /**
         * Contrast of an icon's ink against the surface behind it, with the
         * inline override removed first so the inherited value is what gets
         * judged. Exposed because the checks in .icons-check read it directly.
         */
        measureLegibility(svg, stripOverride = true) {
            const part = svg.querySelector('[data-p]');
            if (!part) return null;
            if (stripOverride) {
                svg.style.removeProperty('color');
                svg.style.removeProperty('stroke');
                svg.querySelectorAll('[fill="currentColor"]').forEach((filled) => {
                    filled.style.removeProperty('fill');
                });
            }
            const style = getComputedStyle(part);
            // Most parts are stroked, but the waveform bars are filled with
            // `stroke="none"`, and reading `stroke` there would measure black.
            const paint = style.stroke && style.stroke !== 'none' ? style.stroke : style.fill;
            const bg = surfaceColour(svg.parentElement);
            return {
                paint,
                surface: bg,
                surfaceLuminance: relativeLuminance(bg),
                ratio: contrastRatio(parseColour(paint), bg)
            };
        }

        ensureLegibleAll() {
            this.mounted.forEach((entry) => this.ensureLegible(entry.svg));
        }

        /**
         * Nothing in this app emits a theme event; the established pattern is to
         * observe the class (see js/thinking-orb.js). The measured colour depends
         * on the theme, so it has to be re-checked when it flips.
         */
        watchTheme() {
            if (this.themeObserver) return;
            let queued = false;
            this.themeObserver = new MutationObserver(() => {
                if (queued) return;
                queued = true;
                // A timeout rather than requestAnimationFrame: this is a style
                // read, not a paint, and rAF does not run while the window is
                // hidden, which would leave the override stale until the window
                // came back.
                setTimeout(() => {
                    queued = false;
                    this.ensureLegibleAll();
                }, 0);
                // Then again as the panels finish their own background-color
                // transitions. Measuring only on the leading edge samples a
                // surface halfway between the two themes and locks in an ink
                // chosen for a colour that no longer exists.
                //
                // Several passes rather than one tuned delay: transition
                // progress is driven by frame production, so a throttled or
                // briefly occluded window can still be interpolating well after
                // any single timeout would have fired. Each pass is a style read
                // over ~80 icons and theme flips are rare.
                this.themeSettleTimers.forEach(clearTimeout);
                this.themeSettleTimers = THEME_SETTLE_MS.map(
                    (delay) => setTimeout(() => this.ensureLegibleAll(), delay)
                );
            });
            this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        /* ── Late-arriving DOM and idling ───────────────────────────── */

        /**
         * The settings window markup is fetched at runtime and its Settings tab
         * is injected later still, so its nav icons are not in the document when
         * this module first runs. Watching that one container is far cheaper than
         * observing the whole body, which streams chat content. The chat and
         * tasks markup lands in one shot, and renderer.js calls refresh() after.
         */
        watchSettingsWindow() {
            const container = document.getElementById('aios-container');
            if (!container || this.settingsObserver) return;
            let queued = false;
            this.settingsObserver = new MutationObserver(() => {
                if (queued) return;
                queued = true;
                setTimeout(() => {
                    queued = false;
                    this.refresh();
                }, 0);
            });
            this.settingsObserver.observe(container, { childList: true, subtree: true });
        }

        unwatchSettingsWindow() {
            this.settingsObserver?.disconnect();
            this.settingsObserver = null;
        }

        /**
         * Chromium already throttles animations in a hidden window, but the loops
         * here are permanent, so stopping them outright when the window is not on
         * screen is worth the four lines.
         */
        watchVisibility() {
            if (this.visibilityBound) return;
            this.visibilityBound = true;
            const sync = () => document.body.classList.toggle(PAUSED_CLASS, document.hidden);
            document.addEventListener('visibilitychange', sync);
            sync();
        }
    }

    const manager = new AnimatedIconManager();
    window.animatedIcons = manager;

    // Apply before the first paint the user sees. `document.body` exists because
    // this script is loaded at the end of <body>.
    manager.setEnabled(readPreference());
})();
