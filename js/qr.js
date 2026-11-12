export function drawQR(container, text) {
  container.replaceChildren();
  // Dense SDP is deliberately text-only rather than an unreliable tiny QR.
  if (text.length > 1500) {
    const p = document.createElement('p');
    p.textContent = 'Pairing code is too large for a reliable QR. Use Copy text and paste it on the other device.';
    container.append(p); return;
  }
  try {
    const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    const count = qr.getModuleCount(), cell = 4, margin = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (count + margin * 2) * cell;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'QR code for the text shown below');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
    container.append(canvas);
  } catch { container.textContent = 'QR unavailable. Copy and paste the text instead.'; }
}

export async function scanQR(video, onResult, onError) {
  let stream, stopped = false, timer;
  const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS and camera permission. Paste the code instead.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    if (!video.isConnected) { stop(); return stop; }
    video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const frame = () => {
      if (stopped || !video.isConnected) { stop(); return; }
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = Math.min(video.videoWidth, 960);
        canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (result) { stop(); onResult(result.data); return; }
      }
      timer = setTimeout(frame, 160);
    };
    frame();
  } catch (error) { stop(); onError(error.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in browser settings, or paste the text.' : error.message); }
  return stop;
}
