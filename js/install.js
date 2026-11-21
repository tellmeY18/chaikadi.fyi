// "Add to home screen" guidance. Android Chrome can show its own install
// dialog from a button (beforeinstallprompt). iOS Safari has no such API, so
// the app can only point at Share → Add to Home Screen.
export const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function platform({ ua = '', standalone = false, platformName = '', touchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platformName === 'MacIntel' && touchPoints > 1);
  const android = /Android/.test(ua);
  // Browsers other than Safari on iOS still use the Share sheet; in-app browsers cannot install at all.
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)/.test(ua);
  return { installed: !!standalone, ios, android, inApp, chrome: /Chrome|CriOS/.test(ua) && !/Edg|OPR|SamsungBrowser/.test(ua) };
}
export const currentPlatform = () => platform({ ua: navigator.userAgent, platformName: navigator.platform, touchPoints: navigator.maxTouchPoints,
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true });

// What to offer right now: null (nothing), or one of
//  'prompt'  a native install button (Chrome / Edge / Samsung on Android)
//  'ios'     Share → Add to Home Screen steps
//  'android' browser-menu steps (no native prompt available yet)
//  'browser' in-app browser: open in Chrome / Safari first
export function installOffer(p, { hasPrompt = false, snoozedUntil = 0, now = Date.now(), force = false } = {}) {
  if (p.installed) return null;
  if (!force && now < snoozedUntil) return null;
  if (p.inApp) return 'browser';
  if (hasPrompt) return 'prompt';
  if (p.ios) return 'ios';
  if (p.android) return 'android';
  return null;
}
