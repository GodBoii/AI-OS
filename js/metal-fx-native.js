/*
 * Native metal-fx adapter for Aetheria.
 *
 * The shader palette and rendering approach are adapted from metal-fx 1.0.4
 * by Jakub Antalik, used under the MIT License. The React component lifecycle
 * has been replaced with a framework-free class for the Electron renderer.
 * License copy: js/vendor/metal-fx-LICENSE.txt
 */
(function initializeNativeMetalFx(global) {
    'use strict';

    const FRAME_INTERVAL_MS = 1000 / 30;
    const MAX_DEVICE_PIXEL_RATIO = 2;
    const SHADER_SIZE = 96;
    const BUTTON_BASE_WIDTH = 140;
    const BUTTON_BASE_HEIGHT = 40;

    const PRESETS = {
        chromatic: {
            dark: {
                colors: ['#000000', '#aae8ff', '#c5fe9e', '#f7888d', '#0d0d0d'],
                speed: 1.2,
                scale: 1.6,
                vignette: 0.26,
                vignetteOpacity: 0.6,
                shaderOpacity: 1,
            },
            light: {
                colors: ['#ffffff', '#ffffff', '#ffffff', '#ffb3b3', '#adadad'],
                speed: 1.2,
                scale: 2.5,
                vignette: 0.24,
                vignetteOpacity: 0.16,
                shaderOpacity: 1,
            },
        },
        silver: {
            dark: {
                colors: ['#000000', '#dedede', '#747270', '#e5e5e5', '#0d0d0d'],
                speed: 1.2,
                scale: 2.5,
                vignette: 0.26,
                vignetteOpacity: 0.6,
                shaderOpacity: 0.88,
            },
            light: {
                colors: ['#f6f6f6', '#ffffff', '#ffffff', '#f7f7f7', '#c9c9c9'],
                speed: 1.2,
                scale: 2.5,
                vignette: 0.2,
                vignetteOpacity: 0.26,
                shaderOpacity: 1,
            },
        },
        gold: {
            dark: {
                colors: ['#000000', '#ffffff', '#ffffff', '#f7d488', '#0d0d0d'],
                speed: 1,
                scale: 2.5,
                vignette: 0.26,
                vignetteOpacity: 0.6,
                shaderOpacity: 0.92,
            },
            light: {
                colors: ['#fff8e1', '#fffbe0', '#ffffff', '#fff6d6', '#d2c7a7'],
                speed: 1.2,
                scale: 2.5,
                vignette: 0.22,
                vignetteOpacity: 0.24,
                shaderOpacity: 1,
            },
        },
    };

    const VERTEX_SHADER = `
        attribute vec2 a_position;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    const FRAGMENT_SHADER = `
        precision highp float;

        uniform vec2 u_resolution;
        uniform float u_time;
        uniform vec3 u_color1;
        uniform vec3 u_color2;
        uniform vec3 u_color3;
        uniform vec3 u_color4;
        uniform vec3 u_color5;
        uniform float u_scale;
        uniform float u_vignette;
        uniform float u_vignetteOpacity;
        uniform float u_shaderOpacity;

        vec3 mod289(vec3 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec2 mod289v2(vec2 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec3 permute(vec3 x) {
            return mod289((x * 34.0 + 1.0) * x);
        }

        float snoise(vec2 v) {
            const vec4 C = vec4(
                0.211324865405187,
                0.366025403784439,
                -0.577350269189626,
                0.024390243902439
            );
            vec2 i = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289v2(i);
            vec3 p = permute(
                permute(i.y + vec3(0.0, i1.y, 1.0))
                + i.x
                + vec3(0.0, i1.x, 1.0)
            );
            vec3 m = max(
                0.5 - vec3(
                    dot(x0, x0),
                    dot(x12.xy, x12.xy),
                    dot(x12.zw, x12.zw)
                ),
                0.0
            );
            m = m * m;
            m = m * m;
            vec3 x = 2.0 * fract(p * C.www) - 1.0;
            vec3 h = abs(x) - 0.5;
            vec3 ox = floor(x + 0.5);
            vec3 a0 = x - ox;
            m *= 1.79284291400159
                - 0.85373472095314 * (a0 * a0 + h * h);
            vec3 g;
            g.x = a0.x * x0.x + h.x * x0.y;
            g.yz = a0.yz * x12.xz + h.yz * x12.yw;
            return 130.0 * dot(m, g);
        }

        float fbm(vec2 point) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int octave = 0; octave < 5; octave++) {
                value += amplitude * snoise(point);
                point *= 2.0;
                amplitude *= 0.5;
            }
            return value;
        }

        vec3 palette(float value) {
            float t = clamp(value, 0.0, 1.0);
            t = t * t * (3.0 - 2.0 * t);
            float k = 64.0;
            float weight1 = exp(-k * t * t);
            float weight2 = exp(-k * (t - 0.25) * (t - 0.25));
            float weight3 = exp(-k * (t - 0.5) * (t - 0.5));
            float weight4 = exp(-k * (t - 0.75) * (t - 0.75));
            float weight5 = exp(-k * (t - 1.0) * (t - 1.0));
            float total = weight1 + weight2 + weight3 + weight4 + weight5 + 0.0001;
            return (
                u_color1 * weight1
                + u_color2 * weight2
                + u_color3 * weight3
                + u_color4 * weight4
                + u_color5 * weight5
            ) / total;
        }

        vec3 computeMetal(vec2 uv, float aspect, float time) {
            vec2 point = (uv - 0.5) * u_scale;
            point.x *= aspect;
            point += vec2(0.173648, 0.984807) * time * 0.15;

            float frequency = 8.44;
            float value = 0.0;
            value += sin(point.x * frequency + time);
            value += sin(point.y * frequency + time * 1.3);
            value += sin((point.x + point.y) * frequency * 0.7 + time * 0.7);
            value += sin(length(point) * frequency * 0.8 - time * 1.5);

            vec2 warp = vec2(
                fbm(point + vec2(time * 0.1, 0.0)),
                fbm(point + vec2(0.0, time * 0.12) + 5.0)
            ) * 0.6;
            value += (warp.x + warp.y) * 0.3;
            value = value * 0.4 + 0.5;
            return palette(clamp(value, 0.0, 1.0));
        }

        void main() {
            vec2 uv = gl_FragCoord.xy / u_resolution;
            float aspect = u_resolution.x / u_resolution.y;
            float blurRadius = 0.02;
            vec3 color = computeMetal(uv, aspect, u_time) * 0.4;
            color += computeMetal(uv + vec2(blurRadius, 0.0), aspect, u_time) * 0.15;
            color += computeMetal(uv - vec2(blurRadius, 0.0), aspect, u_time) * 0.15;
            color += computeMetal(uv + vec2(0.0, blurRadius), aspect, u_time) * 0.15;
            color += computeMetal(uv - vec2(0.0, blurRadius), aspect, u_time) * 0.15;
            color = pow(color, vec3(1.3));

            float edgeDistance = min(
                min(uv.x, 1.0 - uv.x),
                min(uv.y, 1.0 - uv.y)
            );
            float vignettePixels = 40.0 / min(u_resolution.x, u_resolution.y);
            float vignetteRange = vignettePixels * (1.0 + u_vignette * 3.0);
            float vignette = edgeDistance * edgeDistance
                / (vignetteRange * vignetteRange);
            vignette = smoothstep(0.0, 1.0, vignette);
            color *= mix(1.0, vignette, u_vignette * u_vignetteOpacity);

            gl_FragColor = vec4(color, u_shaderOpacity);
        }
    `;

    function hexToRgb(hex) {
        let value = String(hex).replace('#', '');
        if (value.length === 3) {
            value = value.split('').map((character) => character + character).join('');
        }
        return [
            Number.parseInt(value.slice(0, 2), 16) / 255,
            Number.parseInt(value.slice(2, 4), 16) / 255,
            Number.parseInt(value.slice(4, 6), 16) / 255,
        ];
    }

    function compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('metal-fx: unable to create shader');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
            gl.deleteShader(shader);
            throw new Error(`metal-fx: shader compilation failed: ${message}`);
        }
        return shader;
    }

    function createProgram(gl) {
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        const program = gl.createProgram();
        if (!program) throw new Error('metal-fx: unable to create program');
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || 'Unknown link error';
            gl.deleteProgram(program);
            throw new Error(`metal-fx: shader link failed: ${message}`);
        }
        return program;
    }

    class SharedMetalRenderer {
        constructor() {
            this.instances = new Set();
            this.animationFrame = 0;
            this.lastFrameAt = 0;
            this.startedAt = performance.now();
            this.documentVisible = !document.hidden;
            this.canvas = document.createElement('canvas');

            const shaderDpr = Math.min(
                MAX_DEVICE_PIXEL_RATIO,
                global.devicePixelRatio || 1
            );
            this.canvas.width = Math.round(SHADER_SIZE * shaderDpr);
            this.canvas.height = Math.round(SHADER_SIZE * shaderDpr);
            this.gl = this.canvas.getContext('webgl', {
                alpha: true,
                antialias: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: true,
            });
            if (!this.gl) throw new Error('metal-fx: WebGL is unavailable');

            this.setupProgram();
            this.boundTick = (timestamp) => this.tick(timestamp);
            this.boundVisibilityChange = () => {
                this.documentVisible = !document.hidden;
                if (this.documentVisible) this.wake();
                else this.stop();
            };
            this.boundContextLost = (event) => {
                event.preventDefault();
                this.contextLost = true;
                this.stop();
            };
            this.boundContextRestored = () => {
                this.setupProgram();
                this.contextLost = false;
                this.instances.forEach((instance) => {
                    instance.hasFrame = false;
                });
                this.wake();
            };

            document.addEventListener('visibilitychange', this.boundVisibilityChange);
            this.canvas.addEventListener('webglcontextlost', this.boundContextLost);
            this.canvas.addEventListener('webglcontextrestored', this.boundContextRestored);
        }

        setupProgram() {
            const gl = this.gl;
            this.program = createProgram(gl);
            gl.useProgram(this.program);

            this.buffer = gl.createBuffer();
            if (!this.buffer) throw new Error('metal-fx: unable to create buffer');
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([
                    -1, -1,
                    1, -1,
                    -1, 1,
                    -1, 1,
                    1, -1,
                    1, 1,
                ]),
                gl.STATIC_DRAW
            );

            const position = gl.getAttribLocation(this.program, 'a_position');
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            const uniformNames = [
                'u_resolution',
                'u_time',
                'u_color1',
                'u_color2',
                'u_color3',
                'u_color4',
                'u_color5',
                'u_scale',
                'u_vignette',
                'u_vignetteOpacity',
                'u_shaderOpacity',
            ];
            this.uniforms = Object.fromEntries(
                uniformNames.map((name) => [name, gl.getUniformLocation(this.program, name)])
            );
            this.appliedPresetKey = '';
        }

        register(instance) {
            this.instances.add(instance);
            this.wake();
        }

        unregister(instance) {
            this.instances.delete(instance);
            if (!this.instances.size) {
                this.destroy();
                SharedMetalRenderer.instance = null;
            }
        }

        applyPreset(presetName, theme) {
            const presetKey = `${presetName}:${theme}`;
            if (this.appliedPresetKey === presetKey) return PRESETS[presetName][theme];

            const gl = this.gl;
            const preset = PRESETS[presetName][theme];
            gl.useProgram(this.program);
            gl.uniform2f(
                this.uniforms.u_resolution,
                this.canvas.width,
                this.canvas.height
            );
            preset.colors.forEach((color, index) => {
                const [red, green, blue] = hexToRgb(color);
                gl.uniform3f(
                    this.uniforms[`u_color${index + 1}`],
                    red,
                    green,
                    blue
                );
            });
            gl.uniform1f(this.uniforms.u_scale, preset.scale);
            gl.uniform1f(this.uniforms.u_vignette, preset.vignette);
            gl.uniform1f(
                this.uniforms.u_vignetteOpacity,
                preset.vignetteOpacity
            );
            gl.uniform1f(this.uniforms.u_shaderOpacity, preset.shaderOpacity);
            this.appliedPresetKey = presetKey;
            return preset;
        }

        drawShader(timestamp, presetName, theme) {
            const gl = this.gl;
            const preset = this.applyPreset(presetName, theme);
            const time = ((timestamp - this.startedAt) / 1000) * preset.speed;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(this.uniforms.u_time, time);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        copyToInstance(instance) {
            const width = instance.canvas.width;
            const height = instance.canvas.height;
            if (width < 1 || height < 1) return;

            const shaderWidth = this.canvas.width;
            const shaderHeight = this.canvas.height;
            const dpr = instance.dpr;
            const baselineWidth = BUTTON_BASE_WIDTH * dpr;
            const baselineHeight = BUTTON_BASE_HEIGHT * dpr;
            let sourceWidth = width
                * (shaderWidth / baselineWidth)
                / instance.shaderScale;
            let sourceHeight = height
                * (shaderHeight / baselineHeight)
                / instance.shaderScale;
            sourceWidth = Math.min(shaderWidth, sourceWidth);
            sourceHeight = Math.min(shaderHeight, sourceHeight);
            const sourceX = Math.max(0, (shaderWidth - sourceWidth) / 2);
            const sourceY = Math.max(0, (shaderHeight - sourceHeight) / 2);

            const context = instance.context;
            context.clearRect(0, 0, width, height);
            context.drawImage(
                this.canvas,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                0,
                0,
                width,
                height
            );

            const ring = instance.ringWidth * dpr;
            const innerRadius = Math.max(
                0,
                (instance.borderRadius - instance.ringWidth) * dpr
            );
            context.save();
            context.globalCompositeOperation = 'destination-out';
            context.fillStyle = '#000';
            context.beginPath();
            context.roundRect(
                ring,
                ring,
                Math.max(0, width - ring * 2),
                Math.max(0, height - ring * 2),
                innerRadius
            );
            context.fill();
            context.restore();
            instance.hasFrame = true;
        }

        tick(timestamp) {
            this.animationFrame = 0;
            if (this.contextLost || !this.documentVisible || !this.instances.size) return;
            if (timestamp - this.lastFrameAt < FRAME_INTERVAL_MS) {
                this.wake();
                return;
            }
            this.lastFrameAt = timestamp;

            const drawable = [...this.instances].filter(
                (instance) => instance.visible
                    && instance.active
                    && (!instance.paused || !instance.hasFrame)
            );
            if (!drawable.length) return;

            const groups = new Map();
            drawable.forEach((instance) => {
                const key = `${instance.preset}:${instance.theme}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(instance);
            });
            groups.forEach((instances) => {
                const lead = instances[0];
                this.drawShader(timestamp, lead.preset, lead.theme);
                instances.forEach((instance) => this.copyToInstance(instance));
            });

            if (drawable.some((instance) => !instance.paused)) this.wake();
        }

        wake() {
            if (
                this.animationFrame
                || this.contextLost
                || !this.documentVisible
                || !this.instances.size
            ) {
                return;
            }
            this.animationFrame = requestAnimationFrame(this.boundTick);
        }

        stop() {
            if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }

        destroy() {
            this.stop();
            document.removeEventListener('visibilitychange', this.boundVisibilityChange);
            this.canvas.removeEventListener('webglcontextlost', this.boundContextLost);
            this.canvas.removeEventListener('webglcontextrestored', this.boundContextRestored);
            try {
                this.gl.deleteBuffer(this.buffer);
                this.gl.deleteProgram(this.program);
                this.gl.getExtension('WEBGL_lose_context')?.loseContext();
            } catch (_) {
                // The browser may already have released the context.
            }
        }

        static get() {
            if (!SharedMetalRenderer.instance) {
                SharedMetalRenderer.instance = new SharedMetalRenderer();
            }
            return SharedMetalRenderer.instance;
        }
    }

    SharedMetalRenderer.instance = null;

    class NativeMetalFx {
        constructor(host, options = {}) {
            if (!(host instanceof HTMLElement)) {
                throw new TypeError('NativeMetalFx requires an HTMLElement');
            }
            this.host = host;
            const requestedStrength = Number(options.strength);
            this.options = {
                preset: PRESETS[options.preset] ? options.preset : 'chromatic',
                strength: Number.isFinite(requestedStrength)
                    ? Math.min(1, Math.max(0, requestedStrength))
                    : 0.8,
                ringWidth: Math.max(1, Number(options.ringWidth) || 1.5),
                shaderScale: Math.max(0.5, Number(options.shaderScale) || 1.6),
                active: options.active !== false,
                paused: !!options.paused,
            };
            this.renderer = SharedMetalRenderer.get();
            this.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
            this.active = this.options.active;
            this.paused = this.options.paused || this.reducedMotion.matches;
            this.visible = true;
            this.hasFrame = false;
            this.preset = this.options.preset;
            this.strength = this.options.strength;
            this.ringWidth = this.options.ringWidth;
            this.shaderScale = this.options.shaderScale;
            this.theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            this.originalParent = host.parentNode;
            this.originalNextSibling = host.nextSibling;

            this.wrapper = document.createElement('span');
            this.wrapper.className = 'native-metal-fx';
            this.wrapper.dataset.preset = this.preset;
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'native-metal-fx-canvas';
            this.canvas.setAttribute('aria-hidden', 'true');
            this.context = this.canvas.getContext('2d', { alpha: true });
            if (!this.context) throw new Error('metal-fx: Canvas 2D is unavailable');

            this.originalParent.insertBefore(this.wrapper, host);
            this.wrapper.append(host, this.canvas);
            this.host.classList.add('native-metal-fx-host');
            this.wrapper.classList.toggle('is-active', this.active);
            this.wrapper.classList.toggle('is-paused', this.paused);
            this.wrapper.style.setProperty('--metal-strength', String(this.strength));

            this.boundMeasure = () => this.measure();
            this.boundReducedMotionChange = (event) => {
                this.paused = event.matches || this.options.paused;
                this.hasFrame = false;
                this.renderer.wake();
            };

            this.resizeObserver = new ResizeObserver(this.boundMeasure);
            this.resizeObserver.observe(this.host);

            this.intersectionObserver = new IntersectionObserver(
                (entries) => {
                    this.visible = entries.some((entry) => entry.isIntersecting);
                    if (this.visible) this.renderer.wake();
                },
                { threshold: 0.01 }
            );
            this.intersectionObserver.observe(this.wrapper);

            this.themeObserver = new MutationObserver(() => {
                const nextTheme = document.body.classList.contains('dark-mode')
                    ? 'dark'
                    : 'light';
                if (nextTheme !== this.theme) {
                    this.theme = nextTheme;
                    this.hasFrame = false;
                    this.renderer.appliedPresetKey = '';
                    this.renderer.wake();
                }
            });
            this.themeObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['class'],
            });

            this.reducedMotion.addEventListener?.(
                'change',
                this.boundReducedMotionChange
            );
            this.renderer.register(this);
            this.measure();
        }

        measure() {
            const bounds = this.host.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            this.cssWidth = bounds.width;
            this.cssHeight = bounds.height;
            this.dpr = Math.min(
                MAX_DEVICE_PIXEL_RATIO,
                global.devicePixelRatio || 1
            );
            const computedStyle = getComputedStyle(this.host);
            this.borderRadius = Number.parseFloat(computedStyle.borderRadius) || 0;
            const width = Math.max(1, Math.round(bounds.width * this.dpr));
            const height = Math.max(1, Math.round(bounds.height * this.dpr));
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
                this.hasFrame = false;
            }
            this.renderer.wake();
        }

        setActive(active) {
            this.active = !!active;
            this.wrapper.classList.toggle('is-active', this.active);
            if (this.active) {
                requestAnimationFrame(() => {
                    this.measure();
                    this.renderer.wake();
                });
            }
        }

        setPaused(paused) {
            this.options.paused = !!paused;
            this.paused = this.options.paused || this.reducedMotion.matches;
            this.wrapper.classList.toggle('is-paused', this.paused);
            if (!this.hasFrame) this.renderer.wake();
        }

        setStrength(strength) {
            this.strength = Math.min(1, Math.max(0, Number(strength) || 0));
            this.wrapper.style.setProperty('--metal-strength', String(this.strength));
        }

        destroy() {
            this.renderer.unregister(this);
            this.resizeObserver.disconnect();
            this.intersectionObserver.disconnect();
            this.themeObserver.disconnect();
            this.reducedMotion.removeEventListener?.(
                'change',
                this.boundReducedMotionChange
            );
            this.host.classList.remove('native-metal-fx-host');
            if (this.originalParent) {
                this.originalParent.insertBefore(
                    this.host,
                    this.originalNextSibling
                );
            }
            this.wrapper.remove();
        }
    }

    global.NativeMetalFx = NativeMetalFx;
})(window);
