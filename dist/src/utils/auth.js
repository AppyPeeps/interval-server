"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionHasMfa = exports.checkSession = exports.tryPasswordReset = exports.logout = exports.tryLogin = exports.AuthenticationError = void 0;
const isomorphicConsts_1 = require("../utils/isomorphicConsts");
class AuthenticationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.AuthenticationError = AuthenticationError;
async function tryLogin(input) {
    return fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    });
}
exports.tryLogin = tryLogin;
async function logout() {
    // Remove any cached login state in localStorage
    if (typeof window !== 'undefined') {
        window.localStorage.removeItem(isomorphicConsts_1.ME_LOCAL_STORAGE_KEY);
    }
    return fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
    });
}
exports.logout = logout;
async function tryPasswordReset(input) {
    return fetch('/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
    });
}
exports.tryPasswordReset = tryPasswordReset;
async function checkSession(cookie) {
    try {
        const r = await fetch('/api/auth/session', {
            credentials: 'include',
            headers: cookie
                ? {
                    cookie,
                }
                : undefined,
        });
        if (r.ok) {
            return true;
        }
        const body = await r.json();
        if ('code' in body && body.code === 'NEEDS_MFA') {
            throw new AuthenticationError('NEEDS_MFA');
        }
        return false;
    }
    catch (err) {
        if (err instanceof AuthenticationError) {
            throw err;
        }
        return false;
    }
}
exports.checkSession = checkSession;
function sessionHasMfa(session) {
    return session.mfaChallengeId;
}
exports.sessionHasMfa = sessionHasMfa;
