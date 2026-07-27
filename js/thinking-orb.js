/*
 * Vanilla canvas port of the "solving" visual from thinking-orbs.
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
        const white = Math.min(1, Math.max(0, dot.white));
        const grayscale = Math.round((darkMode ? 1 - white : white) * 255);
        context.fillStyle = `rgb(${grayscale}, ${grayscale}, ${grayscale})`;
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

export class ThinkingOrb {
    constructor(target, options = {}) {
        if (!(target instanceof HTMLElement)) {
            throw new TypeError('ThinkingOrb requires an HTML element mount target.');
        }

        this.host = target;
        this.state = options.state || 'solving';
        this.size = Number(options.size) || 64;
        this.speed = Number.isFinite(Number(options.speed)) ? Number(options.speed) : 0.25;
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
        this.canvas.setAttribute('aria-label', options.ariaLabel || 'Solving…');
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
        const phase = reducedMotionQuery?.matches
            ? 0.6
            : (time / 1000) * 1.82 * this.speed;
        drawSolvingOrb(this.context, this.size, phase, resolveDarkMode(this.canvas));
    }

    setState(state) {
        // The vanilla port intentionally starts with the requested solving state.
        this.state = state === 'solving' ? state : 'solving';
        this.draw(performance.now());
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
