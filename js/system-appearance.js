// system-appearance.js - OS theme, accent color and window material.
//
// The renderer decides whether to follow these (Settings > Appearance); this
// module only reports what the OS says and applies the window material.

const os = require('os');

/** '#rrggbb' from Electron's 'RRGGBBAA' accent string, or null. */
function normalizeAccentColor(value) {
    if (typeof value !== 'string') return null;
    const hex = value.replace(/^#/, '');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
    return `#${hex.slice(0, 6).toLowerCase()}`;
}

/** Mica/acrylic needs Windows 11 22H2 (build 22621) or newer. */
function supportsWindowsMaterial(release = os.release()) {
    const build = Number.parseInt(String(release).split('.')[2], 10);
    return Number.isFinite(build) && build >= 22621;
}

function materialSupport(platform, release) {
    if (platform === 'win32') return supportsWindowsMaterial(release) ? 'mica' : null;
    if (platform === 'darwin') return 'vibrancy';
    return null;
}

class SystemAppearance {
    constructor({ nativeTheme, systemPreferences, platform = process.platform, release = os.release(), logger = console }) {
        this.nativeTheme = nativeTheme;
        this.systemPreferences = systemPreferences;
        this.platform = platform;
        this.release = release;
        this.logger = logger;
        this.materialEnabled = false;
    }

    getState() {
        return {
            dark: Boolean(this.nativeTheme.shouldUseDarkColors),
            accentColor: this._accentColor(),
            material: materialSupport(this.platform, this.release),
            materialEnabled: this.materialEnabled,
            platform: this.platform,
        };
    }

    /** Calls `listener(state)` whenever the OS theme or accent changes. */
    watch(listener) {
        const emit = () => listener(this.getState());
        this.nativeTheme.on('updated', emit);
        if (this.platform === 'win32' && typeof this.systemPreferences.on === 'function') {
            this.systemPreferences.on('accent-color-changed', emit);
        } else if (this.platform === 'darwin' && typeof this.systemPreferences.subscribeNotification === 'function') {
            this.systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', emit);
        }
    }

    /** Applies or removes Mica (Windows 11) / vibrancy (macOS). */
    setMaterial(win, enabled) {
        const kind = materialSupport(this.platform, this.release);
        this.materialEnabled = Boolean(enabled && kind);
        if (!win || win.isDestroyed() || !kind) return this.getState();
        try {
            if (kind === 'mica') {
                win.setBackgroundMaterial(this.materialEnabled ? 'mica' : 'none');
            } else {
                win.setVibrancy(this.materialEnabled ? 'under-window' : null);
            }
        } catch (error) {
            this.materialEnabled = false;
            this.logger.warn('[SystemAppearance] Could not change window material:', error.message);
        }
        return this.getState();
    }

    _accentColor() {
        if (typeof this.systemPreferences.getAccentColor !== 'function') return null;
        try {
            return normalizeAccentColor(this.systemPreferences.getAccentColor());
        } catch {
            // Linux and older macOS have no accent API.
            return null;
        }
    }
}

module.exports = { SystemAppearance, normalizeAccentColor, supportsWindowsMaterial, materialSupport };
