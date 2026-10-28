// Theme and layout classes on <html>. A classic script in <head>, so the page is styled before first paint.
// data-theme: dark | light | black. .hw: HARDWARE layout. .compact: phone-sized screen or HARDWARE (see style.css).
(function () {
  const PHONE = '(max-width: 600px) and (orientation: portrait), (max-height: 500px) and (orientation: landscape)';
  const SHORT = '(max-height: 500px) and (orientation: landscape)';
  const THEMES = { dark: '#16171a', light: '#cfd1d2', black: '#121212' };
  window.KoLook = {
    PHONE, SHORT,
    // Applies the settings and returns the values actually used (an unknown theme or layout falls back to the default).
    apply(s) {
      const root = document.documentElement;
      const theme = THEMES[s.theme] ? s.theme : 'light';
      const layout = s.layout === 'auto' ? 'auto' : 'hardware';
      const hw = layout === 'hardware' && !matchMedia(SHORT).matches;
      root.dataset.theme = theme;
      root.classList.toggle('hw', hw);
      root.classList.toggle('compact', hw || matchMedia(PHONE).matches);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = THEMES[theme];
      return { theme, layout, hw };
    },
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('ko.settings')) || {}; } catch (e) { /* defaults */ }
  window.KoLook.apply(saved);
})();
