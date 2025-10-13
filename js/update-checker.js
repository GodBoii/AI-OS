/**
 * Update Checker Service
 * Checks for new versions and notifies users
 */

class UpdateChecker {
    constructor() {
        this.currentVersion = '1.1.0'; // Should match package.json
        this.updateCheckUrl = 'https://raw.githubusercontent.com/GodBoii/AI-OS-website/main/version.json';
        this.checkInterval = 3600000; // Check every hour (in milliseconds)
        this.lastCheckTime = null;
    }

    /**
     * Initialize the update checker
     */
    init() {
        // Check on startup (after 10 seconds delay)
        setTimeout(() => this.checkForUpdates(), 10000);
        
        // Check periodically
        setInterval(() => this.checkForUpdates(), this.checkInterval);
        
        console.log('Update checker initialized');
    }

    /**
     * Check for updates from remote server
     */
    async checkForUpdates() {
        try {
            this.lastCheckTime = new Date();
            
            const response = await fetch(this.updateCheckUrl, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                console.warn('Failed to check for updates:', response.status);
                return;
            }

            const data = await response.json();
            const latestVersion = data.version;
            
            if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                this.notifyUpdate(data);
            } else {
                console.log('App is up to date:', this.currentVersion);
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    /**
     * Compare version numbers (semantic versioning)
     */
    isNewerVersion(latest, current) {
        const latestParts = latest.split('.').map(Number);
        const currentParts = current.split('.').map(Number);

        for (let i = 0; i < 3; i++) {
            if (latestParts[i] > currentParts[i]) return true;
            if (latestParts[i] < currentParts[i]) return false;
        }
        return false;
    }

    /**
     * Detect user's platform
     */
    detectPlatform() {
        const platform = navigator.platform.toLowerCase();
        const userAgent = navigator.userAgent.toLowerCase();
        
        if (platform.includes('win')) return 'windows';
        if (platform.includes('mac')) return 'mac';
        if (platform.includes('linux')) return 'linux';
        
        // Fallback to user agent
        if (userAgent.includes('windows')) return 'windows';
        if (userAgent.includes('mac')) return 'mac';
        if (userAgent.includes('linux')) return 'linux';
        
        return 'unknown';
    }

    /**
     * Get appropriate download URL for user's platform
     */
    getDownloadUrl(updateData) {
        const platform = this.detectPlatform();
        
        // If platform-specific downloads exist
        if (updateData.downloads) {
            if (platform === 'windows' && updateData.downloads.windows) {
                return updateData.downloads.windows;
            }
            if (platform === 'linux') {
                // Prefer AppImage for Linux
                return updateData.downloads['linux-appimage'] || 
                       updateData.downloads['linux-deb'] || 
                       updateData.downloads['linux-rpm'];
            }
            if (platform === 'mac' && updateData.downloads.mac) {
                return updateData.downloads.mac;
            }
        }
        
        // Fallback to general download URL
        return updateData.downloadUrl;
    }

    /**
     * Show update notification to user
     */
    notifyUpdate(updateData) {
        const { version, releaseNotes, critical } = updateData;
        const downloadUrl = this.getDownloadUrl(updateData);
        
        // Create update notification
        const notification = {
            id: `update-${version}`,
            type: critical ? 'error' : 'info',
            title: critical ? '🚨 Critical Update Available' : '🎉 New Version Available',
            message: `Version ${version} is now available. You're using ${this.currentVersion}.`,
            persistent: true,
            actions: [
                {
                    label: 'Download Now',
                    callback: () => {
                        window.open(downloadUrl, '_blank');
                        this.dismissUpdateNotification(version);
                    }
                },
                {
                    label: 'View Changes',
                    callback: () => {
                        this.showReleaseNotes(releaseNotes, version, updateData);
                    }
                },
                {
                    label: 'Later',
                    callback: () => {
                        this.dismissUpdateNotification(version);
                    }
                }
            ]
        };

        // Show notification using your existing notification system
        if (window.notificationService) {
            window.notificationService.show(notification);
        } else {
            // Fallback to browser notification
            this.showBrowserNotification(version, downloadUrl);
        }

        // Store that we've notified about this version
        localStorage.setItem('lastNotifiedVersion', version);
    }

    /**
     * Show release notes in a modal
     */
    showReleaseNotes(notes, version, updateData) {
        const downloadUrl = this.getDownloadUrl(updateData);
        const platform = this.detectPlatform();
        
        // Build download options HTML
        let downloadOptions = '';
        if (updateData.downloads) {
            downloadOptions = '<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color, #333);"><p style="margin-bottom: 8px; font-weight: 500;">Download for other platforms:</p><div style="display: flex; flex-direction: column; gap: 8px;">';
            
            if (updateData.downloads.windows) {
                downloadOptions += `<a href="${updateData.downloads.windows}" target="_blank" style="color: var(--primary-color, #007bff); text-decoration: none;">🪟 Windows (.exe)</a>`;
            }
            if (updateData.downloads['linux-appimage']) {
                downloadOptions += `<a href="${updateData.downloads['linux-appimage']}" target="_blank" style="color: var(--primary-color, #007bff); text-decoration: none;">🐧 Linux AppImage</a>`;
            }
            if (updateData.downloads['linux-deb']) {
                downloadOptions += `<a href="${updateData.downloads['linux-deb']}" target="_blank" style="color: var(--primary-color, #007bff); text-decoration: none;">🐧 Linux (.deb)</a>`;
            }
            if (updateData.downloads['linux-rpm']) {
                downloadOptions += `<a href="${updateData.downloads['linux-rpm']}" target="_blank" style="color: var(--primary-color, #007bff); text-decoration: none;">🐧 Linux (.rpm)</a>`;
            }
            if (updateData.downloads.mac) {
                downloadOptions += `<a href="${updateData.downloads.mac}" target="_blank" style="color: var(--primary-color, #007bff); text-decoration: none;">🍎 macOS (.dmg)</a>`;
            }
            
            downloadOptions += '</div></div>';
        }
        
        const modal = document.createElement('div');
        modal.className = 'update-modal';
        modal.innerHTML = `
            <div class="update-modal-content">
                <div class="update-modal-header">
                    <h2>What's New in v${version}</h2>
                    <button class="update-modal-close">&times;</button>
                </div>
                <div class="update-modal-body">
                    ${notes || 'Bug fixes and improvements'}
                    ${downloadOptions}
                </div>
                <div class="update-modal-footer">
                    <button class="btn-secondary update-modal-later">Remind Me Later</button>
                    <button class="btn-primary update-modal-download">Download for ${platform === 'windows' ? 'Windows' : platform === 'linux' ? 'Linux' : 'Your Platform'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('.update-modal-close').onclick = () => modal.remove();
        modal.querySelector('.update-modal-later').onclick = () => modal.remove();
        modal.querySelector('.update-modal-download').onclick = () => {
            window.open(downloadUrl, '_blank');
            modal.remove();
        };
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    /**
     * Fallback browser notification
     */
    showBrowserNotification(version, downloadUrl) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification('Update Available', {
                body: `Version ${version} is ready to download`,
                icon: 'assets/icon.png'
            });
            
            notification.onclick = () => {
                window.open(downloadUrl, '_blank');
            };
        }
    }

    /**
     * Dismiss update notification
     */
    dismissUpdateNotification(version) {
        localStorage.setItem('dismissedVersion', version);
        localStorage.setItem('dismissedAt', Date.now());
    }

    /**
     * Manual check for updates (triggered by user)
     */
    async manualCheck() {
        const notification = window.notificationService?.show({
            type: 'info',
            title: 'Checking for updates...',
            message: 'Please wait',
            duration: 2000
        });

        await this.checkForUpdates();
    }
}

// Initialize on page load
const updateChecker = new UpdateChecker();
window.updateChecker = updateChecker;

// Auto-start if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateChecker.init());
} else {
    updateChecker.init();
}
