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
exports.organizationMiddleware = exports.authenticatedMiddleware = exports.createRouter = exports.createContext = void 0;
const trpc = __importStar(require("@trpc/server"));
const prisma_1 = __importDefault(require("../../server/prisma"));
const auth_1 = require("../../server/auth");
const auth_2 = require("../../utils/auth");
const auth_3 = require("../../server/auth");
const environments_1 = require("../../utils/environments");
const logger_1 = require("../../server/utils/logger");
// create context based of incoming request
// set as optional here so it can also be re-used for `getStaticProps()`
async function createContext(opts) {
    const req = opts?.req;
    let user;
    let session;
    let organizationId;
    let organization;
    let userOrganizationAccess;
    let organizationEnvironmentId = null;
    let organizationEnvironment;
    if (req) {
        let sessionUpdated = false;
        let sessionDestroyed = false;
        if (req.session?.user && req.session?.session) {
            try {
                const validatedUserSession = await (0, auth_1.validateSession)(req.session.session.id);
                if (validatedUserSession) {
                    user = validatedUserSession.user;
                    session = validatedUserSession.session;
                    req.session.user = user;
                    req.session.session = session;
                    sessionUpdated = true;
                }
            }
            catch (err) {
                if (err instanceof auth_1.AuthenticationError) {
                    switch (err.code) {
                        case 'NEEDS_MFA':
                            logger_1.logger.error('Session needs MFA', {
                                sessionId: req.session.session.id,
                            });
                            break;
                        case 'INVALID':
                        case 'EXPIRED':
                        case 'NOT_FOUND':
                            logger_1.logger.error('Invalid or expired session, clearing', {
                                sessionId: req.session.session?.id,
                                error: err,
                            });
                            req.session.destroy();
                            sessionDestroyed = true;
                    }
                }
                else {
                    logger_1.logger.error('Error validating session', { error: err });
                    // Errors will be thrown/logged in middleware or auth checks
                }
            }
        }
        if (req.headers.__interval_organization_id &&
            // For some reason undefined headers are being stringified instead of discarded during serialization
            req.headers.__interval_organization_id !== 'undefined') {
            organizationId = String(req.headers.__interval_organization_id);
            req.session.currentOrganizationId = organizationId;
            sessionUpdated = true;
        }
        else {
            req.session.currentOrganizationId = undefined;
            sessionUpdated = true;
        }
        if (user && organizationId) {
            const access = await prisma_1.default.userOrganizationAccess.findUnique({
                where: {
                    userId_organizationId: {
                        userId: user.id,
                        organizationId,
                    },
                },
                include: {
                    organization: {
                        include: {
                            environments: {
                                where: {
                                    deletedAt: null,
                                },
                            },
                        },
                    },
                },
            });
            userOrganizationAccess = access;
            organization = access?.organization;
        }
        if (req.headers.__interval_organization_environment_id &&
            req.headers.__interval_organization_environment_id !== 'undefined') {
            organizationEnvironmentId =
                req.headers.__interval_organization_environment_id?.toString();
            req.session.currentOrganizaitonEnvironmentId = organizationEnvironmentId;
            sessionUpdated = true;
        }
        else {
            req.session.currentOrganizaitonEnvironmentId = undefined;
            sessionUpdated = true;
        }
        if (user && organization) {
            if (organizationEnvironmentId) {
                organizationEnvironment =
                    organization.environments.find(env => env.id === organizationEnvironmentId) ?? null;
            }
            else {
                organizationEnvironment =
                    organization.environments.find(env => env.slug === environments_1.PRODUCTION_ORG_ENV_SLUG) ?? null;
                if (organizationEnvironment) {
                    organizationEnvironmentId = organizationEnvironment.id;
                }
            }
        }
        if (!sessionDestroyed && sessionUpdated) {
            await req.session.save();
        }
    }
    return {
        req,
        // make prisma available in router handlers
        prisma: prisma_1.default,
        // user session if authenticated
        session,
        // user information
        user,
        // current organization ID
        organizationId,
        // current organization
        organization,
        // UserOrganizationAccess for current organization
        userOrganizationAccess,
        // current organization environment ID
        organizationEnvironmentId,
        // current organization environment
        organizationEnvironment,
    };
}
exports.createContext = createContext;
function createRouter() {
    return trpc.router();
}
exports.createRouter = createRouter;
const authenticatedMiddleware = ({ ctx, next }) => {
    if (!ctx?.user?.id || !ctx?.session) {
        throw new trpc.TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
        ctx: {
            ...ctx,
            user: {
                ...ctx.user,
            },
            session: {
                ...ctx.session,
            },
        },
    });
};
exports.authenticatedMiddleware = authenticatedMiddleware;
// This relies on a header set by the client config if
// used within DashboardContext. Will not work elsewhere.
const organizationMiddleware = ({ ctx, next }) => {
    if (!ctx.organizationId) {
        throw new trpc.TRPCError({ code: 'BAD_REQUEST' });
    }
    if (!ctx.userOrganizationAccess || !ctx.organization) {
        throw new trpc.TRPCError({ code: 'NOT_FOUND' });
    }
    if (!ctx.organizationEnvironmentId || !ctx.organizationEnvironment) {
        throw new trpc.TRPCError({ code: 'NOT_FOUND' });
    }
    if (auth_3.isWorkOSEnabled &&
        ctx.organization.requireMfa &&
        !(0, auth_2.sessionHasMfa)(ctx.session)) {
        throw new trpc.TRPCError({
            code: 'UNAUTHORIZED',
            cause: new auth_1.AuthenticationError('MFA_REQUIRED'),
        });
    }
    return next({
        ctx: {
            ...ctx,
            organizationId: ctx.organizationId,
            organization: ctx.organization,
            organizationEnvironmentId: ctx.organizationEnvironmentId,
            organizationEnvironment: ctx.organizationEnvironment,
            userOrganizationAccess: ctx.userOrganizationAccess,
        },
    });
};
exports.organizationMiddleware = organizationMiddleware;
