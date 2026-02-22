// native-notification-service.js - Cross-platform Native System Notifications

const { Notification, app } = require('electron');
const path = require('path');

class NativeNotificationService {
    constructor() {
        this.isSupported = Notification.isSupported();
        this.appName = 'Aetheria AI';
        this.iconPath = this.getIconPath();
        this.notificationQueue = [];
        this.activeNotifications = new Map();
        this.maxActiveNotifications = 3;
        this.enabled = true; // Can be toggled by user preference
        
        console.log(`NativeNotificationService: Initialized (Supported: ${this.isSupported})`);
    }

    getIconPath() {
        // Get the app icon path for notifications
        if (process.platform === 'win32') {
            return path.join(__dirname, '../assets/icon.ico');
        } else if (process.platform === 'darwin') {
            return path.join(__dirname, '../assets/icon.png');
        } else {
            return path.join(__dirname, '../assets/icon.png');
        }
    }

    /**
     * Show a native system notification for computer tool usage
     * @param {string} action - The tool action (e.g., 'take_screenshot')
     * @param {string} message - User-friendly message
     * @param {Object} options - Additional options
     */
    showComputerToolNotification(action, message, options = {}) {
        if (!this.isSupported || !this.enabled) {
            console.log('NativeNotificationService: Notifications not supported or disabled');
            return null;
        }

        // Filter: Only show important actions as native notifications to avoid spam
        const importantActions = [
            'take_screenshot',
            'click_mouse',
            'type_text',
            'run_command',
            'open_application',
            'close_application',
            'write_file',
            'delete_file'
        ];

        if (!importantActions.includes(action) && !options.force) {
            console.log(`NativeNotificationService: Skipping non-important action: ${action}`);
            return null;
        }

        // Create notification config
        const notificationConfig = {
            title: 'Computer Agent',
            body: message,
            icon: this.iconPath,
            silent: options.silent || false,
            urgency: options.urgency || 'low', // 'normal', 'critical', 'low'
            timeoutType: 'default', // 'default' or 'never'
            tag: `computer-tool-${action}`, // Replaces previous notification with same tag
        };

        // Add actions for supported platforms (macOS, Windows 10+)
        if (process.platform === 'darwin' || (process.platform === 'win32' && this.isWindows10OrGreater())) {
            notificationConfig.actions = [
                {
                    type: 'button',
                    text: 'View'
                }
            ];
        }

        try {
            const notification = new Notification(notificationConfig);

            // Handle notification click
            notification.on('click', () => {
                console.log('NativeNotificationService: Notification clicked');
                // Bring app to foreground
                if (this.mainWindow) {
                    if (this.mainWindow.isMinimized()) {
                        this.mainWindow.restore();
                    }
                    this.mainWindow.focus();
                }
            });

            // Handle action button click
            notification.on('action', (event, index) => {
                console.log(`NativeNotificationService: Action ${index} clicked`);
                if (this.mainWindow) {
                    if (this.mainWindow.isMinimized()) {
                        this.mainWindow.restore();
                    }
                    this.mainWindow.focus();
                }
            });

            // Handle notification close
            notification.on('close', () => {
                this.activeNotifications.delete(action);
                this.processQueue();
            });

            // Show notification
            notification.show();

            // Track active notification
            this.activeNotifications.set(action, notification);

            console.log(`NativeNotificationService: Showed notification for ${action}`);
            return notification;

        } catch (error) {
            console.error('NativeNotificationService: Error showing notification:', error);
            return null;
        }
    }

    /**
     * Show a generic native notification
     * @param {string} title - Notification title
     * @param {string} body - Notification body
     * @param {Object} options - Additional options
     */
    showNotification(title, body, options = {}) {
        if (!this.isSupported || !this.enabled) {
            return null;
        }

        const notificationConfig = {
            title: title,
            body: body,
            icon: this.iconPath,
            silent: options.silent || false,
            urgency: options.urgency || 'normal',
            tag: options.tag || `notification-${Date.now()}`,
        };

        try {
            const notification = new Notification(notificationConfig);

            notification.on('click', () => {
                if (this.mainWindow) {
                    if (this.mainWindow.isMinimized()) {
                        this.mainWindow.restore();
                    }
                    this.mainWindow.focus();
                }
            });

            notification.show();
            return notification;

        } catch (error) {
            console.error('NativeNotificationService: Error showing notification:', error);
            return null;
        }
    }

    /**
     * Queue notification if too many are active
     */
    queueNotification(action, message, options) {
        if (this.activeNotifications.size >= this.maxActiveNotifications) {
            this.notificationQueue.push({ action, message, options });
            console.log('NativeNotificationService: Notification queued');
        } else {
            this.showComputerToolNotification(action, message, options);
        }
    }

    /**
     * Process queued notifications
     */
    processQueue() {
        if (this.notificationQueue.length > 0 && this.activeNotifications.size < this.maxActiveNotifications) {
            const { action, message, options } = this.notificationQueue.shift();
            this.showComputerToolNotification(action, message, options);
        }
    }

    /**
     * Enable or disable native notifications
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`NativeNotificationService: ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Check if Windows 10 or greater (for action button support)
     */
    isWindows10OrGreater() {
        if (process.platform !== 'win32') return false;
        const release = require('os').release();
        const version = parseInt(release.split('.')[0]);
        return version >= 10;
    }

    /**
     * Set the main window reference for focus handling
     */
    setMainWindow(window) {
        this.mainWindow = window;
    }

    /**
     * Clear all active notifications
     */
    clearAll() {
        this.activeNotifications.forEach(notification => {
            notification.close();
        });
        this.activeNotifications.clear();
        this.notificationQueue = [];
    }
}

module.exports = NativeNotificationService;
