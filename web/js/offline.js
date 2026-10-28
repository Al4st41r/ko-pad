// Service worker registration and the offline download panel.
const SAMPLE_CACHE = 'kopad-samples-v1';

export async function initOffline(A) {
  const chip = document.getElementById('offline');
  if (!('serviceWorker' in navigator)) { chip.textContent = 'NO OFFLINE'; return; }
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    chip.textContent = 'OFFLINE READY'; chip.classList.add('ok');
    reg.addEventListener('updatefound', () => A.toast('Update downloaded. Reopen the app to use it.'));
  } catch { chip.textContent = 'OFFLINE OFF'; }
  A.updateOfflineChip = async () => {
    const n = await cachedCount();
    const total = A.catalogue.length;
    chip.textContent = n >= total && total ? 'ALL SOUNDS OFFLINE' : 'OFFLINE READY';
    chip.classList.toggle('ok', true);
  };
  A.updateOfflineChip();

  A.renderOffline = async (box) => {
    const total = A.catalogue.length;
    const n = await cachedCount();
    let est = '';
    try { const e = await navigator.storage.estimate(); est = `Storage used ${(e.usage / 1048576).toFixed(0)} MB of ${(e.quota / 1048576).toFixed(0)} MB. `; } catch { /* unsupported */ }
    if (!total) { box.innerHTML = '<p class="note">The app itself is stored for offline use after the first visit. Sounds you import or record are kept on this device and need no connection.</p>'; return; }
    box.innerHTML = `<div class="row"><button class="btn small accent" id="dl">DOWNLOAD ALL ${total} SOUNDS</button><span id="dlp" class="dim">${n} of ${total} stored for offline use. ${est}</span></div>
      <p class="note">The app itself is always stored after the first visit. Download all sounds once while online if you want every sample in the browser available on a plane. Add the app to the Home Screen so iPadOS keeps it.</p>`;
    box.querySelector('#dl').onclick = async () => {
      const btn = box.querySelector('#dl'), p = box.querySelector('#dlp'); btn.disabled = true;
      try { await navigator.storage.persist?.(); } catch { /* ignore */ }
      let done = 0; const ids = A.catalogue.map((c) => c.id);
      const worker = async () => {
        while (ids.length) {
          const id = ids.pop();
          try { await (await fetch(`samples/${String(id).padStart(3, '0')}.flac`)).arrayBuffer(); } catch { /* retry on next press */ }
          p.textContent = `Downloading ${++done} of ${total}`;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      btn.disabled = false; A.updateOfflineChip(); A.renderOffline(box); A.toast('Sounds stored for offline use');
    };
  };
}

async function cachedCount() {
  try { return (await (await caches.open(SAMPLE_CACHE)).keys()).filter((r) => r.url.endsWith('.flac')).length; } catch { return 0; }
}
