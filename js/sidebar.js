(function() {
    document.addEventListener('DOMContentLoaded', async () => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        try {
            const response = await fetch('/sidebar.html', { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            sidebar.innerHTML = html;

            // Highlight the active link based on current page
            const pathname = window.location.pathname.toLowerCase();
            const currentPage = (pathname.split('/').pop() || 'index.html');
            sidebar.querySelectorAll('[data-pages]').forEach(link => {
                const pages = link.dataset.pages.split(',').map(p => p.trim().toLowerCase());
                const isActive = pages.some(p => p.startsWith('/') ? pathname.startsWith(p) : p === currentPage);
                if (isActive) {
                    link.classList.add('active');
                }
            });

            setupUserPanel();
            setupGlobalMarketBar();

            // Refresh icons if lucide is available
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        } catch (error) {
            console.error('[Sidebar] Failed to load shared sidebar:', error);
        }
    });
})();

function parseTokenPayload(token) {
    try {
        const payload = token.split('.')[1];
        const json = atob(payload);
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function setupUserPanel() {
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const loginEl = document.getElementById('sidebarLogin');
    const registerEl = document.getElementById('sidebarRegister');
    const profileEl = document.getElementById('sidebarProfile');
    const adminEl = document.getElementById('sidebarAdmin');
    const logoutEl = document.getElementById('sidebarLogout');

    if (!nameEl || !roleEl) return;

    const token = localStorage.getItem('authToken');
    const payload = token ? parseTokenPayload(token) : null;
    const username = payload?.username || 'Guest';

    nameEl.textContent = username;

    const isAuthed = Boolean(token && payload);
    const isAdmin = Boolean(payload?.is_admin);

    roleEl.textContent = isAuthed ? (isAdmin ? 'Admin' : 'Member') : 'Not signed in';

    if (loginEl) loginEl.style.display = isAuthed ? 'none' : 'inline-flex';
    if (registerEl) registerEl.style.display = isAuthed ? 'none' : 'inline-flex';
    if (profileEl) profileEl.style.display = isAuthed ? 'inline-flex' : 'none';
    if (adminEl) adminEl.style.display = isAuthed && isAdmin ? 'inline-flex' : 'none';
    if (logoutEl) logoutEl.style.display = isAuthed ? 'inline-flex' : 'none';

    if (logoutEl) {
        logoutEl.onclick = () => {
            localStorage.removeItem('authToken');
            window.location.href = 'login.html';
        };
    }
}

function setupGlobalMarketBar() {
    if (document.getElementById('globalMarketBar')) return;
    const bar = document.createElement('div');
    bar.id = 'globalMarketBar';
    bar.className = 'global-market-bar';
    bar.innerHTML = `
        <div class="market-pill-group">
            <div class="market-pill" id="marketPillLDN">
                <span class="market-pill__flag market-pill__flag--uk" aria-hidden="true"></span>
                <div class="market-pill__label">LDN</div>
                <div class="market-pill__meta">
                    <div class="market-pill__time" id="marketTimeLDN">--:--</div>
                    <div class="market-pill__status" id="marketStatusLDN">Loading...</div>
                </div>
            </div>
            <div class="market-pill__divider" aria-hidden="true"></div>
            <div class="market-pill" id="marketPillNYC">
                <span class="market-pill__flag market-pill__flag--us" aria-hidden="true"></span>
                <div class="market-pill__label">NYC</div>
                <div class="market-pill__meta">
                    <div class="market-pill__time" id="marketTimeNYC">--:--</div>
                    <div class="market-pill__status" id="marketStatusNYC">Loading...</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(bar);
    document.body.classList.add('has-global-bar');

    const update = () => {
        updateMarketPill({
            label: 'LDN',
            timeEl: document.getElementById('marketTimeLDN'),
            statusEl: document.getElementById('marketStatusLDN'),
            timezone: 'Europe/London',
            hours: { openH: 8, openM: 0, closeH: 16, closeM: 30 }
        });

        updateMarketPill({
            label: 'NYC',
            timeEl: document.getElementById('marketTimeNYC'),
            statusEl: document.getElementById('marketStatusNYC'),
            timezone: 'America/New_York',
            hours: { openH: 9, openM: 30, closeH: 16, closeM: 0 }
        });
    };

    update();
    setInterval(update, 30000);
}

function updateMarketPill({ timeEl, statusEl, timezone, hours }) {
    if (!timeEl || !statusEl) return;
    const now = new Date();
    const zoned = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

    const hh = String(zoned.getHours()).padStart(2, '0');
    const mm = String(zoned.getMinutes()).padStart(2, '0');
    timeEl.textContent = `${hh}:${mm}`;

    const state = getMarketState(zoned, hours);
    statusEl.textContent = state;
}

function getMarketState(zonedDate, hours) {
    const day = zonedDate.getDay();
    const isWeekend = day === 0 || day === 6;

    const open = new Date(zonedDate);
    open.setHours(hours.openH, hours.openM, 0, 0);

    const close = new Date(zonedDate);
    close.setHours(hours.closeH, hours.closeM, 0, 0);

    const formatDiff = (ms) => {
        const totalMins = Math.max(0, Math.floor(ms / 60000));
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    if (isWeekend) {
        // Next open Monday
        const nextOpen = new Date(zonedDate);
        nextOpen.setDate(nextOpen.getDate() + ((1 + 7 - day) % 7 || 1));
        nextOpen.setHours(hours.openH, hours.openM, 0, 0);
        return `Closed · opens in ${formatDiff(nextOpen - zonedDate)}`;
    }

    if (zonedDate < open) {
        return `Opens in ${formatDiff(open - zonedDate)}`;
    }

    if (zonedDate >= open && zonedDate < close) {
        return `Open · closes in ${formatDiff(close - zonedDate)}`;
    }

    // After close today, compute next open (likely next weekday)
    const nextOpen = new Date(open);
    nextOpen.setDate(nextOpen.getDate() + 1);

    // Skip weekends
    while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
    }
    return `Closed · opens in ${formatDiff(nextOpen - zonedDate)}`;
}
