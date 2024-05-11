"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const client_1 = require("@prisma/client");
const util_1 = require("./util");
const auth_1 = require("../../server/auth");
const user_1 = require("../../server/user");
const permissions_1 = require("../../utils/permissions");
const logger_1 = require("../../server/utils/logger");
exports.userRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .query('me', {
    input: zod_1.z
        .object({
        timeZoneName: zod_1.z.string().optional(),
    })
        .optional(),
    async resolve({ ctx, input }) {
        const user = await ctx.prisma.user.findUnique({
            where: {
                id: ctx.user.id,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                defaultNotificationMethod: true,
                timeZoneName: true,
                userOrganizationAccess: {
                    where: {
                        organization: {
                            deletedAt: null,
                        },
                    },
                    orderBy: {
                        lastSwitchedToAt: 'desc',
                    },
                    include: {
                        organization: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                ownerId: true,
                                requireMfa: true,
                            },
                        },
                        groupMemberships: {
                            include: {
                                group: {
                                    select: {
                                        id: true,
                                        slug: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (user && !user.timeZoneName && input?.timeZoneName) {
            try {
                await ctx.prisma.user.update({
                    where: {
                        id: user.id,
                    },
                    data: {
                        timeZoneName: input.timeZoneName,
                    },
                });
                user.timeZoneName = input.timeZoneName;
            }
            catch (err) {
                logger_1.logger.error('Failed updating time zone', {
                    userId: user.id,
                    timeZoneName: input.timeZoneName,
                });
            }
        }
        const pendingConfirmation = await ctx.prisma.userEmailConfirmToken.findFirst({
            // a confirmation with `email` as null will be a first-time confirmation.
            // completing this step is required before certain operations can be performed
            where: { userId: ctx.user.id, email: null },
        });
        return user
            ? {
                ...user,
                isEmailConfirmationRequired: !!pendingConfirmation,
            }
            : null;
    },
})
    .mutation('edit', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        data: zod_1.z.object({
            email: zod_1.z.string().email().optional(),
            firstName: zod_1.z.string().optional(),
            lastName: zod_1.z.string().optional(),
            defaultNotificationMethod: zod_1.z.nativeEnum(client_1.NotificationMethod).optional(),
            timeZoneName: zod_1.z.string().nullish(),
        }),
    }),
    async resolve({ ctx: { prisma, user }, input: { id, data } }) {
        if (user.id !== id) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const { email: newEmail, ...rest } = data;
        let requiresEmailConfirmation = false;
        if (newEmail !== user.email) {
            const existingUser = await prisma.user.findFirst({
                where: { email: newEmail },
            });
            if (existingUser) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Sorry, that email is already in use.',
                });
            }
            await (0, auth_1.requestEmailConfirmation)(user, newEmail);
            requiresEmailConfirmation = true;
        }
        const updatedUser = await prisma.user.update({
            where: { id },
            data: rest,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
            },
        });
        return { updatedUser, requiresEmailConfirmation };
    },
})
    .middleware(util_1.organizationMiddleware)
    .mutation('add', {
    input: zod_1.z.object({
        email: zod_1.z.string().email(),
        firstName: zod_1.z.string(),
        lastName: zod_1.z.string(),
        organizationId: zod_1.z.string().optional(),
    }),
    async resolve({ ctx: { userOrganizationAccess }, input: { organizationId, ...input }, }) {
        if (organizationId &&
            (userOrganizationAccess.organizationId !== organizationId ||
                !(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS'))) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return (0, user_1.createUser)({
            data: input,
            password: (0, auth_1.generatePassword)(),
            organization: organizationId
                ? {
                    existing: {
                        id: organizationId,
                        permissions: ['DEVELOPER'],
                    },
                }
                : undefined,
        });
    },
})
    .mutation('edit-role', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        data: zod_1.z.object({
            orgSlug: zod_1.z.string(),
            permission: zod_1.z.nativeEnum(client_1.UserAccessPermission),
        }),
    }),
    async resolve({ ctx: { prisma, user }, input: { id, data } }) {
        // this is a debug tool; users can't edit their own roles via this endpoint in production
        if (process.env.NODE_ENV === 'production') {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (user.id !== id) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const userOrganizationAccess = await prisma.userOrganizationAccess.findFirst({
            where: {
                user: { id },
                organization: {
                    slug: data.orgSlug,
                },
            },
        });
        if (!userOrganizationAccess) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const updatedAccess = await prisma.userOrganizationAccess.update({
            where: {
                id: userOrganizationAccess.id,
            },
            data: {
                permissions: [data.permission],
            },
        });
        return updatedAccess;
    },
});
