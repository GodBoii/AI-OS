// notification-settings.js - User preferences for notifications

class NotificationSettings {
    constructor() {
        this.storageKey = 'aetheria-notification-settings';
        this.settings = this.loadSettings();
        this.init();
    }

    init() {
        // Apply saved settings
        this.applySettings();
        
        // Create settings UI if it doesn't exist
        this.createSettingsUI();
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
            console.error('Failed to load notification settings:', error);
        }

        // Default settings
        return {
            nativeNotifications: true,
            inAppNotifications: true,
            soundEnabled: false,
            computerToolNotifications: true
        };
    }

    saveSettings() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
            this.applySettings();
        } catch (error) {
            console.error('Failed to save notification settings:', error);
        }
    }

    applySettings() {
        // Apply native notification setting
        if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.send('toggle-native-notifications', this.settings.nativeNotifications);
        }

        // Apply in-app notification setting
        if (window.notificationService) {
            // Could add a method to notification service to toggle
            console.log('In-app notifications:', this.settings.inAppNotifications ? 'enabled' : 'disabled');
        }
    }

    createSettingsUI() {
        // Check if settings button already exists
        if (document.querySelector('.notification-settings-btn')) {
            return;
        }

        // Create settings button in the UI (you can position this wherever you want)
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'notification-settings-btn';
        settingsBtn.innerHTML = '<i class="fas fa-bell"></i>';
        settingsBtn.title = 'Notification Settings';
        settingsBtn.onclick = () => this.showSettingsModal();

        // Add to DOM (adjust selector based on your UI structure)
        const header = document.querySelector('.window-controls') || document.body;
        if (header) {
            header.appendChild(settingsBtn);
        }
    }

    showSettingsModal() {
        // Remove existing modal if any
        const existingModal = document.querySelector('.notification-settings-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'notification-settings-modal';
        modal.innerHTML = `
            <div class="notification-settings-overlay"></div>
            <div class="notification-settings-content">
                <div class="notification-settings-header">
                    <h3>Notification Settings</h3>
                    <button class="notification-settings-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="notification-settings-body">
                    <div class="notification-setting-item">
                        <div class="notification-setting-info">
                            <label>Native System Notifications</label>
                            <p>Show notifications in your system notification center</p>
                        </div>
                        <label class="notification-toggle">
                            <input type="checkbox" id="native-notifications-toggle" ${this.settings.nativeNotifications ? 'checked' : ''}>
                            <span class="notification-toggle-slider"></span>
                        </label>
                    </div>
                    
                    <div class="notification-setting-item">
                        <div class="notification-setting-info">
                            <label>In-App Notifications</label>
                            <p>Show notifications within the application</p>
                        </div>
                        <label class="notification-toggle">
                            <input type="checkbox" id="inapp-notifications-toggle" ${this.settings.inAppNotifications ? 'checked' : ''}>
                            <span class="notification-toggle-slider"></span>
                        </label>
                    </div>
                    
                    <div class="notification-setting-item">
                        <div class="notification-setting-info">
                            <label>Computer Tool Notifications</label>
                            <p>Get notified when Computer Agent performs actions</p>
                        </div>
                        <label class="notification-toggle">
                            <input type="checkbox" id="computer-tool-toggle" ${this.settings.computerToolNotifications ? 'checked' : ''}>
                            <span class="notification-toggle-slider"></span>
                        </label>
                    </div>
                    
                    <div class="notification-setting-item">
                        <div class="notification-setting-info">
                            <label>Notification Sounds</label>
                            <p>Play sound when notifications appear</p>
                        </div>
                        <label class="notification-toggle">
                            <input type="checkbox" id="sound-toggle" ${this.settings.soundEnabled ? 'checked' : ''}>
                            <span class="notification-toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="notification-settings-footer">
                    <button class="notification-settings-save">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        const closeBtn = modal.querySelector('.notification-settings-close');
        const overlay = modal.querySelector('.notification-settings-overlay');
        const saveBtn = modal.querySelector('.notification-settings-save');

        const closeModal = () => {
            modal.classList.add('closing');
            setTimeout(() => modal.remove(), 300);
        };

        closeBtn.onclick = closeModal;
        overlay.onclick = closeModal;

        saveBtn.onclick = () => {
            this.settings.nativeNotifications = document.getElementById('native-notifications-toggle').checked;
            this.settings.inAppNotifications = document.getElementById('inapp-notifications-toggle').checked;
            this.settings.computerToolNotifications = document.getElementById('computer-tool-toggle').checked;
            this.settings.soundEnabled = document.getElementById('sound-toggle').checked;
            
            this.saveSettings();
            
            // Show confirmation
            if (window.notificationService) {
                window.notificationService.show('Settings saved successfully', 'success', 2000);
            }
            
            closeModal();
        };

        // Animate in
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });
    }

    getSetting(key) {
        return this.settings[key];
    }

    setSetting(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.notificationSettings = new NotificationSettings();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationSettings;
}
