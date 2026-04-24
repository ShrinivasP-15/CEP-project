/**
 * AuthSession Module
 * Handles user session persistence across page loads and different storage types (Local, Session, and Window.name)
 * to ensure a robust authentication state for the Public Works Monitoring System.
 */
(function () {
    const STORAGE_KEY = 'currentUser';
    const WINDOW_KEY = '__dtms_current_user__';

    /**
     * Standardizes role strings for case-insensitive comparison
     */
    function normalizeRole(role) {
        return String(role ?? '').trim().toLowerCase();
    }

    /**
     * Checks if a user object has one of the allowed roles
     * @param {Object} user - The user object from the session
     * @param {string|string[]} allowedRoles - A single role or array of roles to check against
     */
    function hasRole(user, allowedRoles) {
        if (!user) return false;
        const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
        const role = normalizeRole(user.role);
        return allowed.some(r => normalizeRole(r) === role);
    }

    /**
     * Reads custom session state stored in window.name (a persistent string across same-tab navigations)
     */
    function readWindowState() {
        try {
            if (!window.name) return {};
            const parsed = JSON.parse(window.name);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    /**
     * Writes custom session state to window.name
     */
    function writeWindowState(state) {
        try {
            window.name = JSON.stringify(state || {});
        } catch {}
    }

    /**
     * Safely parses JSON strings with error handling
     */
    function safeParseJson(value) {
        if (!value) return null;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    /**
     * Sets user data in a specified storage (localStorage or sessionStorage)
     */
    function setStorageUser(storage, user) {
        try {
            if (!storage) return;
            storage.setItem(STORAGE_KEY, JSON.stringify(user));
        } catch {}
    }

    /**
     * Retrieves and parses user data from a specified storage
     */
    function getStorageUser(storage) {
        try {
            if (!storage) return null;
            return safeParseJson(storage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    /**
     * Core Session Retrieval: Checks LocalStorage, SessionStorage, and Window.name
     * to find and synchronize the current user state.
     */
    function getCurrentUser() {
        // 1. Check LocalStorage (persistent)
        const localUser = getStorageUser(window.localStorage);
        if (localUser) {
            const state = readWindowState();
            state[WINDOW_KEY] = localUser;
            writeWindowState(state);
            setStorageUser(window.sessionStorage, localUser);
            return localUser;
        }

        // 2. Check SessionStorage (current tab session)
        const sessionUser = getStorageUser(window.sessionStorage);
        if (sessionUser) {
            const state = readWindowState();
            state[WINDOW_KEY] = sessionUser;
            writeWindowState(state);
            setStorageUser(window.localStorage, sessionUser);
            return sessionUser;
        }

        // 3. Fallback to Window State (handles edge cases like tab restoration)
        const state = readWindowState();
        const fallbackUser = state[WINDOW_KEY] || null;
        if (fallbackUser) {
            setStorageUser(window.localStorage, fallbackUser);
            setStorageUser(window.sessionStorage, fallbackUser);
        }
        return fallbackUser;
    }

    /**
     * Saves user session data across all available storage mechanisms
     */
    function setCurrentUser(user) {
        setStorageUser(window.localStorage, user);
        setStorageUser(window.sessionStorage, user);
        const state = readWindowState();
        state[WINDOW_KEY] = user;
        writeWindowState(state);
    }

    /**
     * Clears all session data on logout
     */
    function clearCurrentUser() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {}
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch {}
        const state = readWindowState();
        delete state[WINDOW_KEY];
        writeWindowState(state);
    }

    // Export AuthSession API to global window
    window.AuthSession = {
        getCurrentUser,
        setCurrentUser,
        clearCurrentUser,
        normalizeRole,
        hasRole
    };
})();
