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

/** Play a completion tone for blue dot (new unread). */
export function playUnreadTone() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    // Three-note chime (matches CLI completion tone)
    const osc1 = ctx.createOscillator();
    osc1.connect(gain);
    osc1.frequency.value = 700;
    osc1.type = 'sine';
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    const osc2 = ctx.createOscillator();
    osc2.connect(gain);
    osc2.frequency.value = 900;
    osc2.type = 'sine';
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.25);
    const osc3 = ctx.createOscillator();
    osc3.connect(gain);
    osc3.frequency.value = 600;
    osc3.type = 'sine';
    osc3.start(ctx.currentTime + 0.25);
    osc3.stop(ctx.currentTime + 0.4);
  } catch { /* audio not available */ }
}

/** Play a more attention-seeking tone for desktop notifications. */
export function playNotificationTone() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    // Two-note chime
    const osc1 = ctx.createOscillator();
    osc1.connect(gain);
    osc1.frequency.value = 880;
    osc1.type = 'sine';
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    const osc2 = ctx.createOscillator();
    osc2.connect(gain);
    osc2.frequency.value = 1100;
    osc2.type = 'sine';
    osc2.start(ctx.currentTime + 0.2);
    osc2.stop(ctx.currentTime + 0.5);
  } catch { /* audio not available */ }
}

let currentSetting: DesktopNotificationSetting = 'off';

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
 * Only shows if session is still unread after the delay.
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
    // Only notify if session is still unread after 30s
    if (!isUnreadCheck()) return;

    playNotificationTone();

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
