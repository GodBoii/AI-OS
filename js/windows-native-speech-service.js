const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const STARTUP_TIMEOUT_MS = 10000;
const STOP_TIMEOUT_MS = 6000;

class WindowsNativeSpeechService {
    constructor(targetWindow) {
        this.targetWindow = targetWindow;
        this.child = null;
        this.stdoutBuffer = '';
        this.stopping = false;
        this.ready = false;
        this.reportedError = false;
        this.startupTimer = null;
        this.stopTimer = null;
    }

    isSupported() {
        return process.platform === 'win32';
    }

    getStatus() {
        return {
            supported: this.isSupported(),
            active: Boolean(this.child),
            ready: this.ready,
        };
    }

    start(options = {}) {
        if (!this.isSupported()) {
            return { ok: false, code: 'platform_unsupported', error: 'Windows native speech input is only available on Windows.' };
        }
        if (this.child) {
            return { ok: false, code: 'already_active', error: 'Windows speech input is already active.' };
        }

        const language = this.normalizeLanguage(options.language);
        const scriptPath = this.resolveHelperPath();
        this.stdoutBuffer = '';
        this.stopping = false;
        this.ready = false;
        this.reportedError = false;

        try {
            this.child = spawn('powershell.exe', [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath,
                '-Language', language,
            ], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            this.child = null;
            return { ok: false, code: 'launch_failed', error: error.message };
        }

        const child = this.child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => this.handleStdout(chunk));
        child.stderr.on('data', (chunk) => {
            const message = String(chunk || '').trim();
            if (message) {
                console.warn('[WindowsSpeech] Helper stderr:', message);
            }
        });
        child.on('error', (error) => {
            this.reportedError = true;
            this.sendEvent({ type: 'error', code: 'launch_failed', message: error.message });
        });
        child.on('close', (code) => this.handleClose(child, code));

        this.startupTimer = setTimeout(() => {
            if (this.child === child && !this.ready) {
                this.sendEvent({
                    type: 'error',
                    code: 'startup_timeout',
                    message: 'Windows Speech Recognition did not start in time.',
                });
                this.disposeChild(child);
            }
        }, STARTUP_TIMEOUT_MS);

        return { ok: true, supported: true, language };
    }

    stop() {
        if (!this.child) {
            return { ok: true, active: false };
        }

        const child = this.child;
        this.stopping = true;
        try {
            child.stdin.write('stop\n');
        } catch (error) {
            this.disposeChild(child);
            return { ok: false, code: 'stop_failed', error: error.message };
        }

        clearTimeout(this.stopTimer);
        this.stopTimer = setTimeout(() => this.disposeChild(child), STOP_TIMEOUT_MS);
        return { ok: true, active: true };
    }

    dispose() {
        if (this.child) {
            this.stopping = true;
            this.disposeChild(this.child);
        }
        this.targetWindow = null;
    }

    normalizeLanguage(language) {
        const value = String(language || 'en-US').trim();
        return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(value) ? value : 'en-US';
    }

    resolveHelperPath() {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, 'app.asar.unpacked', 'js', 'windows-native-stt.ps1');
        }
        return path.join(__dirname, 'windows-native-stt.ps1');
    }

    handleStdout(chunk) {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const payload = JSON.parse(trimmed);
                if (payload.type === 'ready' || payload.type === 'listening') {
                    this.ready = true;
                    clearTimeout(this.startupTimer);
                    this.startupTimer = null;
                }
                if (payload.type === 'error') {
                    this.reportedError = true;
                }
                this.sendEvent(payload);
            } catch (error) {
                console.warn('[WindowsSpeech] Ignoring non-JSON helper output:', trimmed);
            }
        }
    }

    handleClose(child, code) {
        if (this.child !== child) return;

        const wasStopping = this.stopping;
        this.clearTimers();
        this.child = null;
        this.ready = false;
        this.stopping = false;

        if (!wasStopping && code !== 0 && !this.reportedError) {
            this.sendEvent({
                type: 'error',
                code: 'helper_exited',
                message: `Windows Speech Recognition stopped unexpectedly (${code}).`,
            });
        }
        this.sendEvent({ type: 'closed', code: code ?? null });
    }

    disposeChild(child) {
        if (!child) return;
        try {
            child.stdin.end();
        } catch (_) {
            // The helper may already be closing.
        }
        try {
            child.kill();
        } catch (_) {
            // The helper may already have exited.
        }
    }

    clearTimers() {
        clearTimeout(this.startupTimer);
        clearTimeout(this.stopTimer);
        this.startupTimer = null;
        this.stopTimer = null;
    }

    sendEvent(payload) {
        const webContents = this.targetWindow?.webContents;
        if (!webContents || webContents.isDestroyed()) return;
        webContents.send('native-speech-event', payload);
    }
}

module.exports = WindowsNativeSpeechService;
