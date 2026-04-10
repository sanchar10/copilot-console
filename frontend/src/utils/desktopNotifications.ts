/**
 * Desktop notification utility.
 * 
 * Shows browser Notification API notifications when:
 * - Agent completes a response (setting: "all")
 * - Agent needs user input via ask_user/elicitation (setting: "all" or "input_only")
 * 
 * Notifications are delayed 30 seconds and only shown if the session
 * is still unread (user hasn't viewed it) and the tab is not focused.
 */

const NOTIFICATION_DELAY_MS = 30_000;

type DesktopNotificationSetting = 'all' | 'input_only' | 'off';

let currentSetting: DesktopNotificationSetting = 'all';

export function setDesktopNotificationSetting(setting: DesktopNotificationSetting) {
  currentSetting = setting;
}

export function getDesktopNotificationSetting(): DesktopNotificationSetting {
  return currentSetting;
}

/** Request notification permission if not already granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Schedule a desktop notification after 30s delay.
 * Only shows if session is still unread and tab is not focused.
 */
export function scheduleDesktopNotification(
  sessionId: string,
  sessionName: string,
  type: 'response' | 'input_needed',
  isUnreadCheck: () => boolean,
  onNotificationClick?: () => void,
) {
  if (currentSetting === 'off') return;
  if (currentSetting === 'input_only' && type === 'response') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  setTimeout(() => {
    // Only notify if tab is not focused and session is still unread
    if (!document.hidden) return;
    if (!isUnreadCheck()) return;

    const title = type === 'input_needed'
      ? `💬 ${sessionName || 'Copilot'} needs your input`
      : `✅ ${sessionName || 'Copilot'} responded`;

    const body = type === 'input_needed'
      ? 'The agent is waiting for your answer'
      : 'Agent has finished responding';

    const notification = new Notification(title, {
      body,
      icon: '/copilot-icon.png',
      tag: `copilot-${sessionId}`,
      requireInteraction: type === 'input_needed',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      onNotificationClick?.();
    };
  }, NOTIFICATION_DELAY_MS);
}
