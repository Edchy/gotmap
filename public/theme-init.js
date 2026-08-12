(() => {
  let theme = 'dark';
  try {
    const stored = localStorage.getItem('atlas-theme');
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
  } catch {
    // A deterministic dark fallback is preferable to blocking first paint.
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f1f6f9' : '#090e12');
})();
