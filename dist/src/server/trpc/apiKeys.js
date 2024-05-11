"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyRouter = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const server_1 = require("@trpc/server");
const util_1 = require("./util");
const auth_1 = require("../../server/auth");
const permissions_1 = require("../../utils/permissions");
const apiKey_1 = require("../../server/utils/apiKey");
const environments_1 = require("../../utils/environments");
exports.keyRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('prod', {
    input: zod_1.z.object({
        organizationId: zod_1.z.string().optional(),
        organizationSlug: zod_1.z.string().optional(),
    }),
    async resolve({ ctx: { prisma, user, organizationId }, input }) {
        return prisma.apiKey.findMany({
            where: {
                userId: user.id,
                organization: {
                    id: input?.organizationId || organizationId,
                    slug: input?.organizationSlug,
                },
                deletedAt: null,
                usageEnvironment: 'PRODUCTION',
            },
            select: {
                id: true,
                usageEnvironment: true,
                createdAt: true,
                deletedAt: true,
                label: true,
                organization: true,
                organizationEnvironment: true,
                hostInstances: {
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: 1,
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    },
})
    .mutation('add', {
    input: zod_1.z.object({
        label: zod_1.z.string().optional(),
        usageEnvironment: zod_1.z.nativeEnum(client_1.UsageEnvironment),
        organizationEnvironmentId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user, organizationId, userOrganizationAccess }, input: { label, usageEnvironment, organizationEnvironmentId }, }) {
        const requiredPermission = usageEnvironment === 'PRODUCTION'
            ? 'CREATE_PROD_API_KEYS'
            : 'CREATE_DEV_API_KEYS';
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, requiredPermission)) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (usageEnvironment === 'PRODUCTION') {
            const pendingConfirmation = await prisma.userEmailConfirmToken.findFirst({
                where: { userId: user.id, email: null },
            });
            if (pendingConfirmation) {
                throw new server_1.TRPCError({
                    code: 'FORBIDDEN',
                    message: 'Must confirm your email to create live keys',
                });
            }
        }
        const token = (0, auth_1.generateKey)(user, usageEnvironment);
        const organizationEnvironment = await prisma.organizationEnvironment.findUnique({
            where: {
                id: organizationEnvironmentId,
            },
        });
        if (!organizationEnvironment) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const key = await prisma.apiKey.create({
            data: {
                key: usageEnvironment === 'PRODUCTION' ? (0, auth_1.encryptPassword)(token) : token,
                label,
                usageEnvironment,
                organizationEnvironment: {
                    connect: {
                        id: organizationEnvironmentId,
                    },
                },
                user: {
                    connect: {
                        id: user.id,
                    },
                },
                organization: {
                    connect: {
                        id: organizationId,
                    },
                },
            },
        });
        if (!key) {
            // Organization doesn't exist, or I guess random key happened to already exist
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return {
            key,
            token,
        };
    },
})
    // For development key
    .mutation('regenerate', {
    async resolve({ ctx: { prisma, user, organizationId, userOrganizationAccess, organization, }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'CREATE_DEV_API_KEYS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const devEnv = organization.environments.find(env => env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG);
        if (!devEnv) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        await prisma.apiKey.updateMany({
            where: {
                userId: user.id,
                organizationId,
                usageEnvironment: 'DEVELOPMENT',
            },
            data: {
                deletedAt: new Date(),
            },
        });
        const key = await prisma.apiKey.create({
            data: {
                key: (0, auth_1.generateKey)(user, 'DEVELOPMENT'),
                usageEnvironment: 'DEVELOPMENT',
                organizationEnvironment: {
                    connect: {
                        id: devEnv.id,
                    },
                },
                user: {
                    connect: {
                        id: user.id,
                    },
                },
                organization: {
                    connect: {
                        id: organizationId,
                    },
                },
            },
        });
        if (!key) {
            // Organization doesn't exist, or I guess random key happened to already exist
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return key;
    },
})
    .query('dev', {
    async resolve({ ctx: { user, organizationId, userOrganizationAccess } }) {
        return (0, apiKey_1.getDevKey)({
            user,
            organizationId,
            userOrganizationAccess,
        });
    },
})
    .mutation('delete', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user, userOrganizationAccess }, input: { id }, }) {
        const key = await prisma.apiKey.findUnique({
            where: {
                id,
            },
        });
        if (!key ||
            key.deletedAt ||
            (key.userId !== user.id &&
                !(0, permissions_1.hasPermission)(userOrganizationAccess, 'DELETE_ORG_USER_API_KEYS'))) {
            return new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return prisma.apiKey.update({
            where: {
                id,
            },
            data: {
                deletedAt: new Date(),
            },
        });
    },
});
