"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const util_1 = require("./util");
const permissions_1 = require("../../utils/permissions");
const slugs_1 = require("../../server/utils/slugs");
exports.groupRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('list', {
    input: zod_1.z
        .object({
        actionId: zod_1.z.string().optional(),
    })
        .optional()
        .default({}),
    async resolve({ ctx: { prisma, organizationId }, input: { actionId } }) {
        return prisma.userAccessGroup.findMany({
            where: {
                organizationId,
            },
            include: {
                actionAccesses: actionId
                    ? {
                        where: {
                            actionMetadata: {
                                actionId,
                            },
                        },
                    }
                    : undefined,
                _count: {
                    select: {
                        memberships: true,
                    },
                },
            },
            orderBy: {
                name: 'asc',
            },
        });
    },
})
    .query('one', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, organizationId }, input: { id } }) {
        const group = await prisma.userAccessGroup.findFirst({
            where: {
                id,
                organizationId,
            },
            include: {
                actionAccesses: {
                    include: {
                        actionMetadata: {
                            include: {
                                action: true,
                            },
                        },
                    },
                },
            },
        });
        if (!group) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return group;
    },
})
    .mutation('add', {
    input: zod_1.z.object({
        data: zod_1.z.object({
            name: zod_1.z.string(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const desiredSlug = (0, slugs_1.generateSlug)(data.name);
        const existingSlugs = await prisma.userAccessGroup.findMany({
            where: {
                organizationId,
                slug: {
                    startsWith: desiredSlug,
                },
            },
            select: { slug: true },
        });
        const slug = (0, slugs_1.getCollisionSafeSlug)(desiredSlug, existingSlugs.map(t => String(t.slug)));
        return prisma.userAccessGroup.create({
            data: {
                ...data,
                slug,
                organization: { connect: { id: organizationId } },
            },
        });
    },
})
    .mutation('edit', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        data: zod_1.z.object({
            name: zod_1.z.string().optional(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const group = await prisma.userAccessGroup.findUnique({
            where: { id },
        });
        if (!group) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (group.scimGroupId) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'This team uses SCIM sync and cannot be edited manually.',
            });
        }
        return prisma.userAccessGroup.update({
            where: { id },
            data: {
                ...data,
                organization: { connect: { id: organizationId } },
            },
        });
    },
})
    .mutation('delete', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const group = await prisma.userAccessGroup.findFirst({
            where: {
                id,
                organizationId,
            },
        });
        if (!group) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (group.scimGroupId) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'This team uses SCIM sync and cannot be edited manually.',
            });
        }
        const [, , deletedGroup] = await prisma.$transaction([
            prisma.userAccessGroupMembership.deleteMany({
                where: {
                    groupId: id,
                },
            }),
            prisma.actionAccess.deleteMany({
                where: {
                    userAccessGroupId: id,
                },
            }),
            prisma.userAccessGroup.delete({
                where: { id },
            }),
        ]);
        return deletedGroup;
    },
})
    .mutation('users.add', {
    input: zod_1.z.object({
        groupId: zod_1.z.string(),
        userOrganizationAccessId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { groupId, userOrganizationAccessId }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const group = await prisma.userAccessGroup.findFirst({
            where: {
                id: groupId,
                organizationId,
            },
        });
        if (!group) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (group.scimGroupId) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'This team uses SCIM sync and cannot be edited manually.',
            });
        }
        const userAccess = await prisma.userOrganizationAccess.findUnique({
            where: {
                id: userOrganizationAccessId,
            },
        });
        if (!userAccess || userAccess.organizationId !== organizationId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return prisma.userAccessGroupMembership.create({
            data: {
                userOrganizationAccess: { connect: { id: userOrganizationAccessId } },
                group: { connect: { id: groupId } },
            },
        });
    },
})
    .mutation('users.remove', {
    input: zod_1.z.object({
        groupId: zod_1.z.string(),
        userOrganizationAccessId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { groupId, userOrganizationAccessId }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const membership = await prisma.userAccessGroupMembership.findUnique({
            where: {
                userOrganizationAccessId_groupId: {
                    userOrganizationAccessId,
                    groupId,
                },
            },
            include: {
                group: true,
            },
        });
        if (!membership || membership.group.organizationId !== organizationId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (membership.group.scimGroupId) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'This team uses SCIM sync and cannot be edited manually.',
            });
        }
        return prisma.userAccessGroupMembership.delete({
            where: {
                userOrganizationAccessId_groupId: {
                    userOrganizationAccessId,
                    groupId,
                },
            },
        });
    },
});
