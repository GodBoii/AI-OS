// desktop-bridge.js - renderer side of the OS-native features.
//
// The main process (js/native-features.js) sends:
//   app-action         jump list / Dock menu / quick prompt / notification buttons
//   open-files         files opened with the app or dropped on its icon
//   system-appearance  OS theme, accent color and window material
//   agent-run-control  pause / resume / stop from the taskbar
//   setting-changed    results of settings that can fail (global hotkey)
//
// Appearance preferences live in the same localStorage object as the other
// General settings (see aios.js initSettingsListeners).
(function initDesktopBridge() {
    'use strict';

    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const SETTINGS_KEY = 'aetheria-general-settings';
    const READY_POLL_MS = 250;
    const READY_TIMEOUT_MS = 5 * 60 * 1000;
    const ACCENT_PROPERTIES = ['--accent-color', '--accent-hover', '--accent-color-rgb', '--accent-muted'];

    let appearanceState = null;

    const notify = (message, type = 'info', duration = 3500) => {
        window.notificationService?.show(message, type, duration);
    };

    function readSettings() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
        } catch {
            return {};
        }
    }

    function writeSetting(key, value) {
        const settings = readSettings();
        settings[key] = value;
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
            // Storage full or blocked; the setting just does not persist.
        }
    }

    /** Resolves once `check()` is truthy; the chat only exists after sign-in. */
    function whenReady(check) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const tick = () => {
                const value = check();
                if (value) {
                    resolve(value);
                } else if (Date.now() - started > READY_TIMEOUT_MS) {
                    reject(new Error('The app did not finish loading.'));
                } else {
                    setTimeout(tick, READY_POLL_MS);
                }
            };
            tick();
        });
    }

    const chatReady = () => whenReady(() => (
        window.chatModule?.sendPromptFromDesktop && window.uiManager && document.getElementById('floating-input')
            ? window.chatModule
            : null
    ));

    // --- app actions ---------------------------------------------------------

    function startVoiceInput() {
        window.stateManager?.setState({ isChatOpen: true });
        const mic = document.getElementById('mic-button');
        if (mic && !mic.disabled) {
            mic.click();
            return;
        }
        const send = document.getElementById('send-message');
        if (send && !send.disabled && send.dataset.composerAction === 'smart-voice') {
            send.click();
            return;
        }
        window.chatModule?.focusComposer();
        notify('Clear the message box to start voice input.', 'info');
    }

    async function handleAppAction(payload) {
        const action = payload?.action;
        if (typeof action !== 'string') return;
        let chat;
        try {
            chat = await chatReady();
        } catch (error) {
            console.warn('[DesktopBridge] Dropped app action:', action, error.message);
            return;
        }

        switch (action) {
            case 'new-chat':
                await window.uiManager.triggerNewConversation();
                break;
            case 'new-task':
                window.uiManager.triggerNewTask();
                break;
            case 'voice-input':
                startVoiceInput();
                break;
            case 'send-prompt': {
                const sent = await chat.sendPromptFromDesktop(payload.text, { newConversation: payload.newConversation !== false });
                if (!sent) notify('Could not send the quick prompt. It may be waiting on another message.', 'error');
                break;
            }
            case 'open-conversation':
                if (!chat.openConversation(payload.conversationId)) {
                    notify('That conversation is no longer open. Find it in History.', 'info');
                }
                break;
            case 'focus-reply':
                if (chat.openConversation(payload.conversationId)) chat.focusComposer();
                else notify('That conversation is no longer open. Find it in History.', 'info');
                break;
            case 'reply': {
                const sent = await chat.sendPromptFromDesktop(payload.text, { conversationId: payload.conversationId });
                if (!sent) notify('Could not send your reply. The conversation may no longer be open.', 'error');
                break;
            }
            default:
                console.warn('[DesktopBridge] Unknown app action:', action);
        }
    }

    // --- opened files -----------------------------------------------------------

    async function handleOpenFiles(payload) {
        const incoming = Array.isArray(payload?.files) ? payload.files : [];
        const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
        if (incoming.length) {
            try {
                await chatReady();
                const handler = await whenReady(() => window.fileAttachmentHandler);
                window.stateManager?.setState({ isChatOpen: true });
                const files = incoming.map((file) => new File([file.data], file.name, { type: file.type || '' }));
                await handler.handleDrop(files);
            } catch (error) {
                console.error('[DesktopBridge] Could not attach opened files:', error);
                notify('Could not attach the opened files.', 'error');
                return;
            }
        }
        if (skipped.length) {
            const list = skipped.map((entry) => `${entry.name} (${entry.reason})`).join(', ');
            notify(`Not attached: ${list}`, 'warning', 6000);
        }
    }

    // --- appearance ---------------------------------------------------------------

    function hexToRgb(hex) {
        const value = Number.parseInt(hex.slice(1), 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    function applyAppearance() {
        const state = appearanceState;
        const settings = readSettings();
        const body = document.body;
        if (!state || !body) return;

        if (settings.followSystemTheme && window.stateManager) {
            const current = window.stateManager.getState().isDarkMode;
            if (current !== state.dark) window.stateManager.setState({ isDarkMode: state.dark });
        }

        if (settings.useSystemAccent && state.accentColor) {
            const [r, g, b] = hexToRgb(state.accentColor);
            // Inline on <body> so it beats the body.dark-mode token overrides.
            body.style.setProperty('--accent-color', state.accentColor);
            body.style.setProperty('--accent-hover', `rgba(${r}, ${g}, ${b}, 0.85)`);
            body.style.setProperty('--accent-color-rgb', `${r}, ${g}, ${b}`);
            body.style.setProperty('--accent-muted', `rgba(${r}, ${g}, ${b}, 0.12)`);
        } else {
            ACCENT_PROPERTIES.forEach((property) => body.style.removeProperty(property));
        }

        body.classList.toggle('native-material', Boolean(state.materialEnabled));
    }

    async function refreshAppearance() {
        try {
            appearanceState = await ipc.invoke('system-appearance:get');
            applyAppearance();
            syncSettingsControls();
        } catch (error) {
            console.warn('[DesktopBridge] Could not read system appearance:', error);
        }
    }

    // --- listeners --------------------------------------------------------------------

    ipc.on('app-action', (payload) => { handleAppAction(payload); });
    ipc.on('open-files', (payload) => { handleOpenFiles(payload); });
    ipc.on('system-appearance', (state) => {
        appearanceState = state;
        applyAppearance();
        syncSettingsControls();
    });
    ipc.on('agent-run-control', (payload) => {
        const messages = {
            pause_run_requested: 'Pausing the agent after its current step...',
            resume_run_requested: 'Resuming the agent.',
            stop_run_requested: 'Stopping the agent after its current step...',
            run_paused: 'Agent paused. Resume it from the taskbar button.',
            run_resumed: 'Agent resumed.',
            run_stopped: 'Agent stopped.',
        };
        const message = messages[payload?.event];
        if (message) notify(message, payload.event === 'run_stopped' ? 'success' : 'info');
    });
    ipc.on('setting-changed', (payload) => {
        if (payload?.key !== 'quickPromptHotkey') return;
        const hint = document.getElementById('settings-desktop-quick-prompt-hint');
        if (hint && payload.ok === false) {
            hint.textContent = `Ctrl + Shift + Space is already used by another app, so the quick prompt is off. ${payload.error}`;
        }
        // Startup failures stay quiet; only a user toggle gets a toast.
        if (payload.ok === false && payload.userInitiated) {
            notify(`Quick prompt shortcut unavailable: ${payload.error}`, 'error', 6000);
        }
    });

    /** Settings window: platform-specific labels and unsupported toggles. */
    function syncSettingsControls() {
        const isMac = window.electron?.platform === 'darwin';
        const quickHint = document.getElementById('settings-desktop-quick-prompt-hint');
        if (quickHint && isMac && !quickHint.dataset.platformSynced) {
            quickHint.dataset.platformSynced = '1';
            quickHint.innerHTML = 'Press <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> from any app to open a small prompt box. Enter sends it to a new chat.';
        }
        const material = document.getElementById('settings-appearance-native-material');
        const materialHint = document.getElementById('settings-appearance-native-material-hint');
        if (material && appearanceState && !appearanceState.material) {
            material.disabled = true;
            if (materialHint) materialHint.textContent = 'Needs Windows 11 (22H2 or newer) or macOS.';
        }
        const accent = document.getElementById('settings-appearance-system-accent');
        if (accent && appearanceState && !appearanceState.accentColor) {
            accent.disabled = true;
        }
    }

    window.desktopBridge = {
        syncSettingsControls,
        /** Re-applies theme / accent after a settings change. */
        applyAppearanceSettings: () => {
            if (appearanceState) applyAppearance();
            else refreshAppearance();
        },
        /** A manual theme toggle ends "follow system theme". */
        stopFollowingSystemTheme: () => {
            if (!readSettings().followSystemTheme) return;
            writeSetting('followSystemTheme', false);
            const checkbox = document.getElementById('settings-appearance-follow-system');
            if (checkbox) checkbox.checked = false;
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshAppearance, { once: true });
    } else {
        refreshAppearance();
    }
})();
