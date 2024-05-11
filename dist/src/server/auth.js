"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requiredIdentityConfirmation = exports.getConfirmUrl = exports.requestEmailConfirmation = exports.createResetUrl = exports.sessionMiddleware = exports.clearDomainlessCookie = exports.ironSessionOptions = exports.unsealSessionCookie = exports.logoutSession = exports.validateSession = exports.createUserSession = exports.tryLogin = exports.verifyMfa = exports.challengeMfa = exports.enrollMfa = exports.loginWithApiKey = exports.generateKey = exports.generatePassword = exports.encryptPassword = exports.defaultIdentityConfirmGracePeriod = exports.workos = exports.isWorkOSEnabled = exports.AuthenticationError = void 0;
const generate_password_1 = __importDefault(require("generate-password"));
const crypto = __importStar(require("crypto"));
const iron_session_1 = require("iron-session");
const node_1 = __importDefault(require("@workos-inc/node"));
// Must be relative because this file is imported from server.ts
const env_1 = __importDefault(require("../env"));
const prisma_1 = __importDefault(require("./prisma"));
const isomorphicConsts_1 = require("../utils/isomorphicConsts");
const express_1 = require("iron-session/express");
const emails_1 = require("../emails");
const auth_1 = require("../utils/auth");
Object.defineProperty(exports, "AuthenticationError", { enumerable: true, get: function () { return auth_1.AuthenticationError; } });
const email_1 = require("../utils/email");
let workos;
exports.workos = workos;
exports.isWorkOSEnabled = !!env_1.default.WORKOS_API_KEY && !!env_1.default.WORKOS_CLIENT_ID;
if (exports.isWorkOSEnabled) {
    exports.workos = workos = new node_1.default(env_1.default.WORKOS_API_KEY);
}
exports.defaultIdentityConfirmGracePeriod = 1000 * 60 * 5; // 5 minutes
function encryptPassword(password) {
    return crypto
        .pbkdf2Sync(password, env_1.default.SECRET, 1000, 64, 'sha512')
        .toString('hex');
}
exports.encryptPassword = encryptPassword;
function generatePassword() {
    return generate_password_1.default.generate({
        length: 24,
        numbers: true,
        symbols: true,
    });
}
exports.generatePassword = generatePassword;
function generateKey(user, env) {
    const key = generate_password_1.default.generate({
        length: 48,
        numbers: true,
        symbols: false,
    });
    const envKey = `${usageEnvironmentToKeyPrefix(env)}_${key}`;
    if (env === 'DEVELOPMENT' && user.firstName) {
        const namePrefix = user.firstName.toLowerCase().replace(/\W/g, '');
        return `${namePrefix}_${envKey}`;
    }
    return envKey;
}
exports.generateKey = generateKey;
function usageEnvironmentToKeyPrefix(env) {
    switch (env) {
        case 'PRODUCTION':
            return 'live';
        case 'DEVELOPMENT':
            return 'dev';
    }
}
async function loginWithApiKey(key) {
    const apiKey = await prisma_1.default.apiKey.findFirst({
        where: {
            organization: {
                deletedAt: null,
            },
            OR: [
                {
                    key,
                    usageEnvironment: 'DEVELOPMENT',
                },
                {
                    key: encryptPassword(key),
                    usageEnvironment: 'PRODUCTION',
                },
            ],
        },
        include: {
            user: {
                // We don't want to possibly leak private info, and don't need it here anyway
                select: {
                    id: true,
                    lastName: true,
                    firstName: true,
                    email: true,
                    mfaId: true,
                },
            },
            organization: true,
            organizationEnvironment: true,
        },
    });
    if (!apiKey || apiKey.deletedAt)
        return null;
    return {
        user: apiKey.user,
        organization: apiKey.organization,
        organizationEnvironment: apiKey.organizationEnvironment,
        apiKey,
    };
}
exports.loginWithApiKey = loginWithApiKey;
async function enrollMfa(user) {
    if (!workos) {
        throw new Error('WorkOS credentials not found, WorkOS integration not enabled.');
    }
    return workos.mfa.enrollFactor({
        type: 'totp',
        issuer: 'Interval',
        user: user.email,
    });
}
exports.enrollMfa = enrollMfa;
async function challengeMfa(mfaId) {
    if (!workos) {
        throw new Error('WorkOS credentials not found, WorkOS integration not enabled.');
    }
    const response = await workos.mfa.challengeFactor({
        authenticationFactorId: mfaId,
    });
    return prisma_1.default.userMfaChallenge.create({
        data: {
            id: response.id,
            mfaId,
            createdAt: response.created_at,
            updatedAt: response.updated_at,
            expiresAt: response.expires_at,
        },
    });
}
exports.challengeMfa = challengeMfa;
async function verifyMfa(challengeId, code, session) {
    if (!workos) {
        throw new Error('WorkOS credentials not found, WorkOS integration not enabled.');
    }
    try {
        const response = await workos.mfa.verifyChallenge({
            authenticationChallengeId: challengeId,
            code,
        });
        if (!response.valid) {
            throw new auth_1.AuthenticationError('INVALID');
        }
    }
    catch (err) {
        if (err instanceof auth_1.AuthenticationError) {
            throw err;
        }
        throw new auth_1.AuthenticationError('INVALID');
    }
    return prisma_1.default.userMfaChallenge.update({
        where: { id: challengeId },
        data: {
            session: { connect: { id: session.id } },
            verifiedAt: new Date(),
        },
    });
}
exports.verifyMfa = verifyMfa;
/**
 * This attempts logging in a user, returning the user and the session if successful or throwing an AuthenticationError otherwise.
 */
async function tryLogin(email, password) {
    const user = await prisma_1.default.user.findFirst({
        where: {
            email: email,
            password: encryptPassword(password),
        },
        select: {
            id: true,
            lastName: true,
            firstName: true,
            email: true,
            mfaId: true,
        },
    });
    if (!user) {
        throw new auth_1.AuthenticationError('NOT_FOUND', 'No user found');
    }
    const session = await createUserSession(user);
    return {
        user,
        session,
    };
}
exports.tryLogin = tryLogin;
async function createUserSession(user, { ssoAccessToken } = {}) {
    return prisma_1.default.userSession.create({
        data: {
            user: {
                connect: {
                    id: user.id,
                },
            },
            ssoAccessToken,
        },
    });
}
exports.createUserSession = createUserSession;
async function validateSession(id) {
    try {
        const session = await prisma_1.default.userSession.update({
            where: { id },
            data: {
                lastUsedAt: new Date(),
            },
            include: {
                mfaChallenge: true,
                user: {
                    select: {
                        id: true,
                        lastName: true,
                        firstName: true,
                        email: true,
                        mfaId: true,
                    },
                },
            },
        });
        if (exports.isWorkOSEnabled && session.user.mfaId && !session.mfaChallenge) {
            throw new auth_1.AuthenticationError('NEEDS_MFA');
        }
        if (session.mfaChallenge && !session.mfaChallenge.verifiedAt) {
            throw new auth_1.AuthenticationError('INVALID');
        }
        const { user, mfaChallenge, ...cleanedSession } = session;
        return {
            session: cleanedSession,
            user,
        };
    }
    catch (e) {
        if (e instanceof auth_1.AuthenticationError) {
            throw e;
        }
        else {
            // Invalid session, not found
            throw new auth_1.AuthenticationError('NOT_FOUND');
        }
    }
}
exports.validateSession = validateSession;
async function logoutSession(id) {
    try {
        return prisma_1.default.userSession.deleteMany({
            where: { id },
        });
    }
    catch (err) {
        // No session to log out!
    }
}
exports.logoutSession = logoutSession;
async function unsealSessionCookie(cookie) {
    return (0, iron_session_1.unsealData)(cookie, {
        password: exports.ironSessionOptions.password,
        ttl: exports.ironSessionOptions.ttl,
    });
}
exports.unsealSessionCookie = unsealSessionCookie;
const appDomain = new URL(env_1.default.APP_URL).hostname;
exports.ironSessionOptions = {
    cookieName: isomorphicConsts_1.AUTH_COOKIE_NAME,
    password: env_1.default.AUTH_COOKIE_SECRET,
    ttl: 0,
    cookieOptions: {
        domain: appDomain,
        secure: process.env.NODE_ENV === 'production',
    },
};
function clearDomainlessCookie(_req, res, next) {
    if (appDomain && appDomain !== 'localhost') {
        res.clearCookie(isomorphicConsts_1.AUTH_COOKIE_NAME, {
            // iron-session defaults
            httpOnly: true,
            path: '/',
            sameSite: 'lax',
            // our overrides
            ...exports.ironSessionOptions.cookieOptions,
            // domainless
            domain: undefined,
        });
    }
    next?.();
}
exports.clearDomainlessCookie = clearDomainlessCookie;
exports.sessionMiddleware = (0, express_1.ironSession)(exports.ironSessionOptions);
async function createResetUrl(resetTokenId) {
    const seal = await (0, iron_session_1.sealData)({
        resetTokenId,
    }, {
        password: exports.ironSessionOptions.password,
    });
    return `${env_1.default.APP_URL}/reset-password?seal=${seal}`;
}
exports.createResetUrl = createResetUrl;
async function requestEmailConfirmation(user, newEmail) {
    let token = await prisma_1.default.userEmailConfirmToken.findFirst({
        where: { userId: user.id },
    });
    if (token && (token.expiresAt < new Date() || newEmail)) {
        // if regenerating a token for an email change, include the email with the new token
        if (token.email && !newEmail) {
            newEmail = token.email;
        }
        // remove existing token and generate a new one
        await prisma_1.default.userEmailConfirmToken.delete({
            where: { userId: user.id },
        });
        token = null;
    }
    if (!token) {
        token = await prisma_1.default.userEmailConfirmToken.create({
            data: {
                user: { connect: { id: user.id } },
                email: newEmail,
            },
        });
    }
    const confirmUrl = await getConfirmUrl(token.id);
    await (0, emails_1.confirmEmail)(newEmail ?? user.email, {
        confirmUrl,
        isEmailChange: !!newEmail,
    });
}
exports.requestEmailConfirmation = requestEmailConfirmation;
async function getConfirmUrl(confirmTokenId) {
    const seal = await (0, iron_session_1.sealData)({
        confirmTokenId,
    }, {
        password: exports.ironSessionOptions.password,
    });
    return `${env_1.default.APP_URL}/confirm-email?seal=${seal}`;
}
exports.getConfirmUrl = getConfirmUrl;
async function requiredIdentityConfirmation(user) {
    const domain = (0, email_1.getDomain)(user.email);
    const sso = await prisma_1.default.organizationSSO.findFirst({
        where: {
            domain,
            workosOrganizationId: {
                not: null,
            },
        },
    });
    if (exports.isWorkOSEnabled && user.mfaId) {
        return 'MFA';
    }
    else if (exports.isWorkOSEnabled && sso) {
        return 'SSO';
    }
    else if (exports.isWorkOSEnabled && !user.password) {
        return 'LOGIN_WITH_GOOGLE';
    }
    else {
        return 'PASSWORD';
    }
}
exports.requiredIdentityConfirmation = requiredIdentityConfirmation;
