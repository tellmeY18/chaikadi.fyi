import test from 'node:test';
import assert from 'node:assert/strict';
import { platform, installOffer, SNOOZE_MS } from '../js/install.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 330.0';

test('android chrome gets the native prompt once the browser offers it, else menu steps', () => {
  const p = platform({ ua: ANDROID });
  assert.ok(p.android && p.chrome && !p.ios);
  assert.equal(installOffer(p, { hasPrompt: true }), 'prompt');
  assert.equal(installOffer(p), 'android');
});
test('iOS (Safari, Chrome, iPadOS desktop mode) gets Share steps', () => {
  for (const ua of [IPHONE, IOS_CHROME]) assert.equal(installOffer(platform({ ua })), 'ios');
  assert.equal(installOffer(platform({ ua: 'Mozilla/5.0 (Macintosh)', platformName: 'MacIntel', touchPoints: 5 })), 'ios');
});
test('installed apps, desktops and snoozed users are not nagged; in-app browsers are told to switch', () => {
  assert.equal(installOffer(platform({ ua: ANDROID, standalone: true }), { hasPrompt: true }), null);
  assert.equal(installOffer(platform({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126' })), null);
  const now = 1_000_000, p = platform({ ua: IPHONE });
  assert.equal(installOffer(p, { snoozedUntil: now + SNOOZE_MS, now }), null);
  assert.equal(installOffer(p, { snoozedUntil: now - 1, now }), 'ios');
  assert.equal(installOffer(p, { snoozedUntil: now + SNOOZE_MS, now, force: true }), 'ios', 'Settings always offers it');
  assert.equal(installOffer(platform({ ua: INSTAGRAM })), 'browser');
});
