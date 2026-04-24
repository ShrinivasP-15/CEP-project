(function () {
    function formatLongDate(date) {
        try {
            return new Intl.DateTimeFormat('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            }).format(date);
        } catch {
            return date.toDateString();
        }
    }

    function updateLiveDates() {
        const now = new Date();
        const text = formatLongDate(now);
        document.querySelectorAll('[data-live-date]').forEach((el) => {
            el.textContent = text;
            if (el.tagName === 'TIME') {
                try {
                    el.setAttribute('datetime', now.toISOString());
                } catch {}
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateLiveDates();
            setInterval(updateLiveDates, 60_000);
        });
    } else {
        updateLiveDates();
        setInterval(updateLiveDates, 60_000);
    }
})();

