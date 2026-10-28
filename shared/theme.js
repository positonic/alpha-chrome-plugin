// Light/dark theme. Loaded synchronously in <head> so the page never paints
// in the wrong theme. Sets data-theme="light" | "dark" on <html>; until the
// user picks one with the header toggle, the OS preference is followed.
(function () {
    const STORAGE_KEY = 'THEME';
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function storedTheme() {
        try {
            const value = localStorage.getItem(STORAGE_KEY);
            return value === 'light' || value === 'dark' ? value : null;
        } catch (e) {
            return null;
        }
    }

    function resolvedTheme() {
        return storedTheme() || (media.matches ? 'dark' : 'light');
    }

    function apply(theme) {
        const root = document.documentElement;
        // Suspend transitions so every surface flips at once instead of fading
        root.classList.add('theme-switching');
        root.dataset.theme = theme;
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
        const toggle = document.getElementById('themeToggle');
        if (toggle) {
            const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
            toggle.title = label;
            toggle.setAttribute('aria-label', label);
        }
    }

    apply(resolvedTheme());

    media.addEventListener('change', () => {
        if (!storedTheme()) apply(resolvedTheme());
    });

    // Keep other open extension pages (e.g. a second side panel) in sync
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) apply(resolvedTheme());
    });

    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('themeToggle');
        if (!toggle) return;
        apply(resolvedTheme());
        toggle.addEventListener('click', () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch (e) {
                // Storage unavailable — still switch for this session
            }
            apply(next);
        });
    });
})();
