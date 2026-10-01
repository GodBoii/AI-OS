// run-notification.js - "task finished" notification with Open chat / Reply.
//
// macOS:   native action button + inline reply field.
// Windows: a toast with two buttons. Buttons activate aios:// links, which
//          the app already receives (second-instance / deep link). Windows
//          toasts cannot hand typed text back to Electron, so "Reply" opens
//          the conversation with the message box focused. Packaged builds
//          only, because custom toasts need the registered AppUserModelID.
// Linux:   plain notification; clicking it opens the conversation.

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isValidConversationId(value) {
    return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value);
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function notificationLink(action, conversationId) {
    return `aios://notification/${action}?conversation=${encodeURIComponent(conversationId)}`;
}

function buildWindowsToastXml({ title, body, conversationId, silent }) {
    const open = escapeXml(notificationLink('open', conversationId));
    const reply = escapeXml(notificationLink('reply', conversationId));
    return [
        `<toast activationType="protocol" launch="${open}">`,
        '<visual><binding template="ToastGeneric">',
        `<text>${escapeXml(title)}</text>`,
        `<text>${escapeXml(body)}</text>`,
        '</binding></visual>',
        '<actions>',
        `<action content="Open chat" activationType="protocol" arguments="${open}"/>`,
        `<action content="Reply" activationType="protocol" arguments="${reply}"/>`,
        '</actions>',
        silent ? '<audio silent="true"/>' : '',
        '</toast>',
    ].join('');
}

/**
 * Extra NativeNotificationService options for a finished run. `dispatch`
 * receives { action: 'open-conversation' | 'reply', conversationId, text? }.
 */
function buildRunCompletedOptions({ platform, isPackaged, conversationId, title, body, silent = false, dispatch }) {
    if (!isValidConversationId(conversationId)) return {};
    const open = () => dispatch({ action: 'open-conversation', conversationId });

    if (platform === 'darwin') {
        return {
            actions: [{ type: 'button', text: 'Open chat' }],
            hasReply: true,
            replyPlaceholder: 'Reply to Aetheria ai',
            onClick: open,
            onAction: open,
            onReply: (text) => dispatch({ action: 'reply', conversationId, text: String(text || '') }),
        };
    }
    if (platform === 'win32' && isPackaged) {
        // Clicks arrive through the aios:// link, not the click event.
        return { toastXml: buildWindowsToastXml({ title, body, conversationId, silent }) };
    }
    return { onClick: open };
}

/** Parses aios://notification/<open|reply>?conversation=<id>. */
function parseNotificationLink(parsedUrl) {
    if (!parsedUrl || parsedUrl.hostname !== 'notification') return null;
    const action = parsedUrl.pathname.replace(/^\//, '');
    if (action !== 'open' && action !== 'reply') return null;
    const conversationId = parsedUrl.searchParams.get('conversation');
    if (!isValidConversationId(conversationId)) return null;
    return { action: action === 'open' ? 'open-conversation' : 'focus-reply', conversationId };
}

module.exports = {
    isValidConversationId,
    escapeXml,
    buildWindowsToastXml,
    buildRunCompletedOptions,
    parseNotificationLink,
};
