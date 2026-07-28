/*
 * Vanilla canvas port of the "solving" and "composing" visuals from thinking-orbs.
 * Source: https://github.com/JakubAntalik/thinking-orbs
 *
 * MIT License
 *
 * Copyright (c) 2026 Jakub Antalik
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const mountedOrbs = new WeakMap();
const liveOrbs = new Set();
const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
const darkModeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null;

let documentObserver = null;
let pruneFrame = 0;

function resolveDarkMode(element) {
    const explicitTheme = element.closest?.('[data-theme]')?.getAttribute('data-theme');
    if (explicitTheme === 'dark') return true;
    if (explicitTheme === 'light') return false;

    if (element.closest?.('.dark-mode, .dark')) return true;
    // AI-OS treats the presence/absence of body.dark-mode as an explicit
    // app theme choice, so it takes precedence over the operating system.
    if (document.body) return document.body.classList.contains('dark-mode');
    return Boolean(darkModeQuery?.matches);
}

function refreshAllOrbs() {
    liveOrbs.forEach(orb => orb.refreshEnvironment());
}

function pruneDetachedOrbs() {
    pruneFrame = 0;
    liveOrbs.forEach(orb => {
        if (!orb.canvas.isConnected) orb.destroy();
    });
}

function ensureDocumentObserver() {
    if (documentObserver || typeof MutationObserver === 'undefined') return;

    documentObserver = new MutationObserver(records => {
        const themeChanged = records.some(record => record.type === 'attributes');
        const nodesRemoved = records.some(record => record.removedNodes?.length);

        if (themeChanged) refreshAllOrbs();
        if (nodesRemoved && !pruneFrame) {
            pruneFrame = requestAnimationFrame(pruneDetachedOrbs);
        }
    });

    documentObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
        childList: true,
        subtree: true,
    });

    reducedMotionQuery?.addEventListener?.('change', refreshAllOrbs);
    darkModeQuery?.addEventListener?.('change', refreshAllOrbs);
}

function releaseDocumentObserver() {
    if (liveOrbs.size) return;
    documentObserver?.disconnect();
    documentObserver = null;
    reducedMotionQuery?.removeEventListener?.('change', refreshAllOrbs);
    darkModeQuery?.removeEventListener?.('change', refreshAllOrbs);
    if (pruneFrame) cancelAnimationFrame(pruneFrame);
    pruneFrame = 0;
}

function hashDot(a, b) {
    const hash = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return hash - Math.floor(hash);
}

function fibonacciDirection(index, count) {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(1 - y * y);
    const angle = index * goldenAngle;
    return [radial * Math.cos(angle), y, radial * Math.sin(angle)];
}

function makeProjection(yaw, tilt, centerX, centerY, scale) {
    const sineTilt = Math.sin(tilt);
    const cosineTilt = Math.cos(tilt);
    const sineYaw = Math.sin(yaw);
    const cosineYaw = Math.cos(yaw);

    return (x, y, z) => {
        const rotatedX = x * cosineYaw + z * sineYaw;
        const rotatedZ = -x * sineYaw + z * cosineYaw;
        const rotatedY = y * cosineTilt - rotatedZ * sineTilt;
        const depth = y * sineTilt + rotatedZ * cosineTilt;
        return [
            centerX + rotatedX * scale,
            centerY - rotatedY * scale,
            depth,
        ];
    };
}

function radiusScale(size, power) {
    return (size / 300) ** power;
}

function paintDots(context, dots, darkMode, minimumRadius = 0.3) {
    dots.sort((a, b) => a.z - b.z);

    dots.forEach(dot => {
        const alpha = dot.alpha ?? 1;
        if (alpha < 0.02) return;
        const white = Math.min(1, Math.max(0, dot.white));
        const grayscale = Math.round((darkMode ? 1 - white : white) * 255);
        context.fillStyle = `rgba(${grayscale}, ${grayscale}, ${grayscale}, ${alpha})`;
        context.beginPath();
        context.arc(dot.x, dot.y, Math.max(minimumRadius, dot.radius), 0, Math.PI * 2);
        context.fill();
    });
}

function solveCycle(time, count, slotDuration, restDuration) {
    const cycleDuration = 2 * count * slotDuration + restDuration;
    const cycleTime = time % cycleDuration;
    const amounts = new Array(count).fill(0);
    let activeMove = -1;

    if (cycleTime < 2 * count * slotDuration) {
        const slot = Math.floor(cycleTime / slotDuration);
        const progress = (cycleTime - slot * slotDuration) / slotDuration;
        const clamped = Math.min(1, progress / 0.7);
        const easedProgress = 1 - (1 - clamped) ** 3;

        if (slot < count) {
            for (let index = 0; index < slot; index += 1) amounts[index] = 1;
            amounts[slot] = easedProgress;
            activeMove = slot;
        } else {
            const reverseIndex = 2 * count - 1 - slot;
            for (let index = 0; index < reverseIndex; index += 1) amounts[index] = 1;
            amounts[reverseIndex] = 1 - easedProgress;
            activeMove = reverseIndex;
        }
    }

    return { amounts, activeMove };
}

function makeSolvingMoves(count) {
    const moves = [];

    for (let index = 0; index < count; index += 1) {
        const axis = Math.min(2, Math.floor(hashDot(index, 2.3) * 3));
        const lowerBound = -1 + 0.5 * Math.min(3, Math.floor(hashDot(index, 5.9) * 4));
        const direction = hashDot(index, 7.7) < 0.5 ? 1 : -1;
        moves.push({
            axis,
            lowerBound,
            upperBound: lowerBound + 0.5,
            angle: (direction * Math.PI) / 2,
        });
    }

    return moves;
}

function applySolvingMoves(point, moves, cycle) {
    let [x, y, z] = point;
    let inActiveMove = false;

    for (let index = 0; index < moves.length; index += 1) {
        if (cycle.amounts[index] <= 0) continue;

        const move = moves[index];
        const coordinate = move.axis === 0 ? x : move.axis === 1 ? y : z;
        if (coordinate < move.lowerBound || coordinate >= move.upperBound) continue;

        if (index === cycle.activeMove) inActiveMove = true;
        const angle = move.angle * cycle.amounts[index];
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);

        if (move.axis === 0) {
            const nextY = y * cosine - z * sine;
            z = y * sine + z * cosine;
            y = nextY;
        } else if (move.axis === 1) {
            const nextX = x * cosine + z * sine;
            z = -x * sine + z * cosine;
            x = nextX;
        } else {
            const nextX = x * cosine - y * sine;
            y = x * sine + y * cosine;
            x = nextX;
        }
    }

    return [x, y, z, inActiveMove];
}

const SOLVING_OPTIONS = Object.freeze({
    latitudeRings: 9,
    longitudeDensity: 24,
    moveCount: 14,
    baseRadius: 0.6 * 1.05,
    depthRadius: 1.7 * 1.05,
    activeRadius: 0.3 * 1.05,
    farInk: 0.62,
    inkSpan: 0.54,
    radiusPower: 0.6,
    minimumRadius: 0.3,
});
const solvingMoves = makeSolvingMoves(SOLVING_OPTIONS.moveCount);

function drawSolvingOrb(context, size, time, darkMode) {
    const center = size / 2;
    const sphereRadius = (size / 2) * 0.82;
    const project = makeProjection(
        time * 0.55,
        0.35 + 0.1 * Math.sin(time * 0.9),
        center,
        center,
        sphereRadius,
    );
    const dotScale = radiusScale(size, SOLVING_OPTIONS.radiusPower);
    const cycle = solveCycle(time, SOLVING_OPTIONS.moveCount, 0.42, 1.2);
    const dots = [];

    for (
        let latitudeIndex = 0;
        latitudeIndex <= SOLVING_OPTIONS.latitudeRings;
        latitudeIndex += 1
    ) {
        const latitude = -Math.PI / 2
            + (latitudeIndex / SOLVING_OPTIONS.latitudeRings) * Math.PI;
        const cosineLatitude = Math.cos(latitude);
        const sineLatitude = Math.sin(latitude);
        const longitudeCount = Math.max(
            1,
            Math.round(Math.abs(cosineLatitude) * SOLVING_OPTIONS.longitudeDensity),
        );

        for (let longitudeIndex = 0; longitudeIndex < longitudeCount; longitudeIndex += 1) {
            const longitude = (longitudeIndex / longitudeCount) * 2 * Math.PI;
            const [x, y, z, inActiveMove] = applySolvingMoves(
                [
                    cosineLatitude * Math.cos(longitude),
                    sineLatitude,
                    cosineLatitude * Math.sin(longitude),
                ],
                solvingMoves,
                cycle,
            );
            const [projectedX, projectedY, projectedDepth] = project(x, y, z);
            const depth = (projectedDepth + 1) / 2;

            dots.push({
                x: projectedX,
                y: projectedY,
                z: projectedDepth,
                radius: (
                    SOLVING_OPTIONS.baseRadius
                    + SOLVING_OPTIONS.depthRadius * depth
                    + (inActiveMove ? SOLVING_OPTIONS.activeRadius : 0)
                ) * dotScale,
                white: SOLVING_OPTIONS.farInk
                    - SOLVING_OPTIONS.inkSpan * depth
                    - (inActiveMove ? 0.14 : 0),
            });
        }
    }

    paintDots(context, dots, darkMode, SOLVING_OPTIONS.minimumRadius);
}

const COMPOSING_OPTIONS = Object.freeze({
    lanes: 3,
    segments: 44,
    ghostCount: 38,
    baseRadius: 1.1 * 0.85,
    depthRadius: 1.7 * 0.85,
    radiusPower: 0.6,
    minimumRadius: 0.3,
    spin: 0,
    bandMultiplier: 3.9,
    wobbleMultiplier: 1,
});

function drawComposingOrb(context, size, time, darkMode) {
    const center = size / 2;
    const sphereRadius = (size / 2) * 0.78;
    const spin = COMPOSING_OPTIONS.spin;
    const project = makeProjection(time * 0.1 * spin, 0.3, center, center, 1);
    const dotScale = radiusScale(size, COMPOSING_OPTIONS.radiusPower);
    const dots = [];

    for (let index = 0; index < COMPOSING_OPTIONS.ghostCount; index += 1) {
        const direction = fibonacciDirection(index, COMPOSING_OPTIONS.ghostCount);
        const [x, y, z] = project(
            direction[0] * sphereRadius,
            direction[1] * sphereRadius,
            direction[2] * sphereRadius,
        );
        const depth = (z / sphereRadius + 1) / 2;
        dots.push({
            x,
            y,
            z,
            radius: 0.8 * dotScale,
            white: 0.78,
            alpha: 0.1 + 0.22 * depth,
        });
    }

    const planeYaw = time * 0.24 * spin;
    const planeTilt = 0.55 + 0.3 * Math.sin(time * 0.18) * spin;
    const ux = Math.cos(planeYaw);
    const uy = 0;
    const uz = Math.sin(planeYaw);
    const vx = -uz * Math.sin(planeTilt);
    const vy = Math.cos(planeTilt);
    const vz = ux * Math.sin(planeTilt);
    const normalX = uy * vz - uz * vy;
    const normalY = uz * vx - ux * vz;
    const normalZ = ux * vy - uy * vx;
    const laneCount = Math.max(
        1,
        Math.round(COMPOSING_OPTIONS.lanes * COMPOSING_OPTIONS.bandMultiplier),
    );

    for (let lane = 0; lane < laneCount; lane += 1) {
        const laneOffset = (
            lane - (laneCount - 1) / 2
        ) * 0.075;
        const edge = Math.abs(lane - (laneCount - 1) / 2)
            / Math.max(1, (laneCount - 1) / 2);

        for (let segment = 0; segment < COMPOSING_OPTIONS.segments; segment += 1) {
            const angle = (segment / COMPOSING_OPTIONS.segments) * 2 * Math.PI;
            const primaryWave = 0.16
                * Math.sin(angle * 3 - time * 1.7 + lane * 0.22);
            const secondaryWave = 0.07
                * Math.sin(angle * 5 + time * 1.1);
            const offset = laneOffset
                + (primaryWave + secondaryWave)
                * COMPOSING_OPTIONS.wobbleMultiplier;
            const x = ux * Math.cos(angle) + vx * Math.sin(angle) + normalX * offset;
            const y = uy * Math.cos(angle) + vy * Math.sin(angle) + normalY * offset;
            const z = uz * Math.cos(angle) + vz * Math.sin(angle) + normalZ * offset;
            const length = Math.sqrt(x * x + y * y + z * z);
            const [projectedX, projectedY, projectedDepth] = project(
                (x / length) * sphereRadius,
                (y / length) * sphereRadius,
                (z / length) * sphereRadius,
            );
            const depth = (projectedDepth / sphereRadius + 1) / 2;

            dots.push({
                x: projectedX,
                y: projectedY,
                z: projectedDepth,
                radius: (
                    COMPOSING_OPTIONS.baseRadius
                    + COMPOSING_OPTIONS.depthRadius * depth
                ) * (1 - 0.25 * edge) * dotScale,
                white: 0.52 - 0.44 * depth + 0.18 * edge,
                alpha: 0.4 + 0.6 * depth,
            });
        }
    }

    paintDots(context, dots, darkMode, COMPOSING_OPTIONS.minimumRadius);
}

const STATE_PRESETS = Object.freeze({
    solving: {
        baseSpeed: 1.82,
        label: 'Solving…',
        draw: drawSolvingOrb,
    },
    composing: {
        baseSpeed: 2.34,
        label: 'Listening and composing…',
        draw: drawComposingOrb,
    },
});

export class ThinkingOrb {
    constructor(target, options = {}) {
        if (!(target instanceof HTMLElement)) {
            throw new TypeError('ThinkingOrb requires an HTML element mount target.');
        }

        this.host = target;
        this.state = STATE_PRESETS[options.state] ? options.state : 'solving';
        this.size = Number(options.size) || 64;
        this.speed = Number.isFinite(Number(options.speed)) ? Number(options.speed) : 1;
        this.paused = Boolean(options.paused);
        this.destroyed = false;
        this.isVisible = true;
        this.frame = 0;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'thinking-orb-canvas';
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.canvas.style.width = `${this.size}px`;
        this.canvas.style.height = `${this.size}px`;
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute(
            'aria-label',
            options.ariaLabel || STATE_PRESETS[this.state].label,
        );
        this.host.replaceChildren(this.canvas);

        this.context = this.canvas.getContext('2d');
        this.onVisibilityChange = () => this.syncAnimation();
        document.addEventListener('visibilitychange', this.onVisibilityChange);

        this.intersectionObserver = typeof IntersectionObserver === 'undefined'
            ? null
            : new IntersectionObserver(entries => {
                this.isVisible = entries[0]?.isIntersecting ?? true;
                this.syncAnimation();
            }, { rootMargin: '80px' });
        this.intersectionObserver?.observe(this.canvas);

        liveOrbs.add(this);
        mountedOrbs.set(this.host, this);
        ensureDocumentObserver();
        this.resizeCanvas();
        this.draw(performance.now());
        this.syncAnimation();
    }

    resizeCanvas() {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(this.size * pixelRatio);
        this.canvas.height = Math.round(this.size * pixelRatio);
        this.context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    shouldAnimate() {
        return !this.destroyed
            && !this.paused
            && !reducedMotionQuery?.matches
            && this.isVisible
            && !document.hidden
            && this.canvas.isConnected;
    }

    syncAnimation() {
        if (this.destroyed) return;
        if (!this.shouldAnimate()) {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.draw(performance.now());
            return;
        }
        if (!this.frame) this.frame = requestAnimationFrame(time => this.animate(time));
    }

    animate(time) {
        this.frame = 0;
        if (!this.shouldAnimate()) {
            this.syncAnimation();
            return;
        }
        this.draw(time);
        this.frame = requestAnimationFrame(nextTime => this.animate(nextTime));
    }

    draw(time) {
        if (!this.context) return;
        this.context.clearRect(0, 0, this.size, this.size);
        const preset = STATE_PRESETS[this.state] || STATE_PRESETS.solving;
        const phase = reducedMotionQuery?.matches
            ? 0.6
            : (time / 1000) * preset.baseSpeed * this.speed;
        preset.draw(
            this.context,
            this.size,
            phase,
            resolveDarkMode(this.canvas),
        );
    }

    setState(state) {
        this.state = STATE_PRESETS[state] ? state : 'solving';
        this.canvas.setAttribute('aria-label', STATE_PRESETS[this.state].label);
        this.draw(performance.now());
    }

    setAriaLabel(label) {
        this.canvas.setAttribute(
            'aria-label',
            label || STATE_PRESETS[this.state].label,
        );
    }

    setPaused(paused) {
        this.paused = Boolean(paused);
        this.syncAnimation();
    }

    refreshEnvironment() {
        this.resizeCanvas();
        this.draw(performance.now());
        this.syncAnimation();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.intersectionObserver?.disconnect();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        mountedOrbs.delete(this.host);
        liveOrbs.delete(this);
        releaseDocumentObserver();
    }
}

export function mountThinkingOrb(target, options = {}) {
    mountedOrbs.get(target)?.destroy();
    return new ThinkingOrb(target, options);
}

export function mountThinkingOrbs(root, options = {}) {
    root?.querySelectorAll?.('[data-thinking-orb]').forEach(target => {
        if (!mountedOrbs.has(target)) mountThinkingOrb(target, options);
    });
}

export function setThinkingOrbsPaused(root, paused) {
    root?.querySelectorAll?.('[data-thinking-orb]').forEach(target => {
        mountedOrbs.get(target)?.setPaused(paused);
    });
}

export function destroyThinkingOrbs(root) {
    root?.querySelectorAll?.('[data-thinking-orb]').forEach(target => {
        mountedOrbs.get(target)?.destroy();
    });
}
