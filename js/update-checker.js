/**
 * Update checker (renderer side).
 *
 * Downloading and installing happens in the main process (js/updater.js). This
 * file only drives the Updates tab in Settings and the "update available" toast.
 * Builds that cannot update themselves (dev runs, .deb/.rpm, unsigned macOS)
 * fall back to the releases page.
 */

const RELEASES_PAGE = 'https://github.com/GodBoii/AI-OS-website/releases/latest';

class UpdateChecker {
    constructor() {
        this.currentVersion = '';
        this.state = 'idle';
        this.info = null;
        this.percent = 0;
        this.error = null;
        this.lastCheckTime = null;
        this.silentCheck = true;
        this.checkInterval = 3600000;
        this.autoCheckEnabled = true; // Controlled by settings
    }

    async init() {
        if (this.ipc) return; // Already initialised; never stack listeners twice.

        const ipc = window.electron?.ipcRenderer;
        if (!ipc) {
            console.warn('Update checker: IPC bridge unavailable');
            return;
        }
        this.ipc = ipc;

        // Listeners go up before any await so a slow or failing main process
        // cannot leave the Updates tab permanently inert.
        this.ipc.on('updater-event', (payload) => this.onUpdaterEvent(payload));

        // The Settings markup is injected asynchronously by renderer.js, so the
        // buttons do not exist yet. Delegate from document, in the capture phase
        // so nothing inside the settings window can swallow the click. Opening
        // the tab re-renders, which is how state set before the markup existed
        // reaches the screen.
        document.addEventListener('click', (event) => {
            if (event.target.closest?.('#check-updates-btn')) this.check(false);
            else if (event.target.closest?.('#update-action-btn')) this.runAction();
            else if (event.target.closest?.('[data-tab="updates"]')) this.render();
        }, true);

        setTimeout(() => { if (this.autoCheckEnabled) this.check(true); }, 8000);
        setInterval(() => { if (this.autoCheckEnabled) this.check(true); }, this.checkInterval);

        const status = await this.ipc.invoke('updater-action', { action: 'version' });
        this.currentVersion = status?.version || '';

        if (status?.downloadedVersion) {
            this.info = { version: status.downloadedVersion, releaseNotes: null };
            this.setState('downloaded');
        } else {
            this.render();
        }
    }

    async check(silent) {
        // A download in flight owns the UI; a background check must not reset it.
        if (this.state === 'downloading' || this.state === 'downloaded') return;

        this.silentCheck = silent;
        this.error = null;
        this.lastCheckTime = new Date();
        this.setState('checking');

        const result = await this.ipc.invoke('updater-action', { action: 'check' });
        // On success the update-available / update-not-available event has
        // already set the final state.
        if (result?.ok) return;

        if (result?.code === 'unsupported') {
            this.setState('unsupported');
        } else {
            this.error = result?.error || null;
            this.setState('error');
        }
    }

    async runAction() {
        if (this.state === 'available') {
            this.percent = 0;
            this.setState('downloading');
            const result = await this.ipc.invoke('updater-action', { action: 'download' });
            if (!result?.ok) {
                this.error = result?.error || null;
                this.setState('error');
            }
        } else if (this.state === 'downloaded') {
            await this.ipc.invoke('updater-action', { action: 'install' });
        } else {
            window.electron?.shell?.openExternal(RELEASES_PAGE);
        }
    }

    onUpdaterEvent(payload = {}) {
        switch (payload.type) {
            case 'available':
                this.info = { version: payload.version, releaseNotes: payload.releaseNotes };
                this.setState('available');
                if (this.silentCheck) this.notifyUpdate(payload.version);
                break;
            case 'not-available':
                this.info = null;
                this.setState('up-to-date');
                break;
            case 'progress':
                // Main already collapsed these to whole percents.
                this.percent = payload.percent || 0;
                this.setState('downloading');
                break;
            case 'downloaded':
                this.setState('downloaded');
                break;
            case 'error':
                this.error = payload.error;
                this.setState('error');
                break;
        }
    }

    setState(state) {
        this.state = state;
        this.render();
    }

    /**
     * Presentation for the current state. Keeping this separate from render()
     * means the DOM writes below stay uniform regardless of state.
     */
    view() {
        const version = this.info?.version;

        switch (this.state) {
            case 'checking':
                return { icon: 'fas fa-spinner fa-spin', title: 'Checking for updates...', message: 'Contacting the release server.', busy: true };
            case 'up-to-date':
                return { icon: 'fas fa-check-circle', color: '#4caf50', title: 'You\'re up to date', message: `Aetheria ai v${this.currentVersion} is the latest version.` };
            case 'available':
                return { icon: 'fas fa-arrow-circle-down', color: '#ff9800', title: 'Update available', message: `Version ${version} is ready to download.`, action: 'Download update', actionIcon: 'fi fi-tr-download' };
            case 'downloading':
                return { icon: 'fas fa-spinner fa-spin', color: '#ff9800', title: 'Downloading update', message: `Version ${version}, ${this.percent}% complete.`, busy: true, action: `Downloading ${this.percent}%`, actionIcon: 'fi fi-tr-download' };
            case 'downloaded':
                // Re-checking is pointless once the installer is on disk, so the
                // check button stays disabled here too.
                return { icon: 'fas fa-check-circle', color: '#4caf50', title: 'Update ready to install', message: `Version ${version} installs when the app restarts.`, busy: true, action: 'Restart and install', actionIcon: 'fi fi-tr-refresh' };
            case 'unsupported':
                return { icon: 'fas fa-info-circle', title: 'In-app updates unavailable', message: 'This build cannot install updates itself. Download the latest release manually.', action: 'Open releases page', actionIcon: 'fi fi-tr-download' };
            case 'error':
                return { icon: 'fas fa-times-circle', color: '#f44336', title: 'Update check failed', message: this.error || 'Could not reach the release server.', action: 'Open releases page', actionIcon: 'fi fi-tr-download' };
            default:
                return { icon: 'fi fi-tr-check-circle', title: 'Software updates', message: 'Check whether a newer version is available.' };
        }
    }

    render() {
        const el = (id) => document.getElementById(id);
        const title = el('update-status-title');
        const icon = el('update-icon');
        const actionBtn = el('update-action-btn');
        const progress = el('update-progress');

        // Every element below lives in the same injected fragment, so one gate
        // covers them all. Missing means Settings has not loaded yet.
        if (!title || !icon || !actionBtn || !progress) return;

        const view = this.view();

        icon.innerHTML = `<i class="${view.icon}"></i>`;
        icon.style.color = view.color || '';
        title.textContent = view.title;
        el('update-status-message').textContent = view.message;
        el('current-version-display').textContent = this.currentVersion || 'unknown';
        el('last-check-time').textContent = this.lastCheckTime ? this.getTimeAgo(this.lastCheckTime) : 'Never';
        el('check-updates-btn').disabled = Boolean(view.busy);

        actionBtn.classList.toggle('hidden', !view.action);
        actionBtn.disabled = this.state === 'downloading';
        if (view.action) actionBtn.innerHTML = `<i class="${view.actionIcon}"></i> ${view.action}`;

        progress.classList.toggle('hidden', this.state !== 'downloading');
        progress.setAttribute('aria-valuenow', String(this.percent));
        el('update-progress-bar').style.width = `${this.percent}%`;

        el('update-details').classList.toggle('hidden', !this.info);
        if (this.info) {
            el('new-version-number').textContent = this.info.version;
            el('release-notes-content').innerHTML = this.sanitizeNotes(this.info.releaseNotes);
        }
    }

    sanitizeNotes(html) {
        const notes = html || 'Bug fixes and improvements.';
        return window.DOMPurify ? window.DOMPurify.sanitize(notes) : notes;
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    }

    /**
     * One toast per version, on automatic checks only. Clicking it opens the
     * Updates tab where the download lives.
     */
    notifyUpdate(version) {
        if (localStorage.getItem('lastNotifiedVersion') === version) return;
        localStorage.setItem('lastNotifiedVersion', version);
        if (!window.notificationService) return;

        const id = window.notificationService.show(
            `Version ${version} is available. Open Settings to install it.`, 'info', 8000);

        setTimeout(() => {
            const toast = document.querySelector(`[data-notification-id="${id}"]`);
            if (!toast) return;
            toast.style.cursor = 'pointer';
            toast.addEventListener('click', () => {
                window.AIOS?.showWindow();
                window.AIOS?.switchTab('updates');
            });
        }, 100);
    }
}

const updateChecker = new UpdateChecker();
window.updateChecker = updateChecker;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateChecker.init());
} else {
    updateChecker.init();
}
