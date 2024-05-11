"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationRouter = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const server_1 = require("@trpc/server");
const util_1 = require("./util");
const permissions_1 = require("../../utils/permissions");
const emails_1 = require("../../emails");
const organizations_1 = require("../utils/organizations");
const env_1 = __importDefault(require("../../env"));
const nanoid_1 = require("nanoid");
const slack_1 = require("../../server/utils/slack");
const user_1 = require("../user");
const logger_1 = require("../../server/utils/logger");
const isomorphicConsts_1 = require("../../utils/isomorphicConsts");
exports.organizationRouter = (0, util_1.createRouter)()
    .query('slug', {
    input: zod_1.z.object({
        slug: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user }, input }) {
        const org = await prisma.organization.findFirst({
            where: { slug: input.slug, deletedAt: null },
            include: {
                userOrganizationAccess: user
                    ? {
                        where: {
                            userId: user.id,
                        },
                    }
                    : false,
                environments: {
                    where: {
                        deletedAt: null,
                    },
                    // TODO: Order nulls first after updating Prisma
                    orderBy: {
                        slug: 'asc',
                    },
                },
                featureFlags: true,
                sso: true,
            },
        });
        if (!org) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (!org.isGhostMode &&
            (!org.userOrganizationAccess || org.userOrganizationAccess.length === 0)) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const privateOrg = await prisma.organizationPrivate.findFirst({
            where: {
                organizationId: org.id,
            },
        });
        return {
            ...org,
            connectedToSlack: !!privateOrg?.slackAccessToken,
            promoCode: org.promoCode,
        };
    },
})
    .middleware(util_1.authenticatedMiddleware)
    .query('is-slug-available', {
    input: zod_1.z.object({
        slug: zod_1.z.string(),
        id: zod_1.z.string().optional(),
    }),
    async resolve({ input: { id, slug } }) {
        return (0, organizations_1.isSlugAvailable)(slug, id);
    },
})
    .query('slack-channels', {
    async resolve({ ctx: { prisma, organizationId } }) {
        const privateOrg = await prisma.organizationPrivate.findFirst({
            where: {
                organizationId,
            },
        });
        let slackChannels = [];
        if (privateOrg?.slackAccessToken) {
            slackChannels = await (0, slack_1.getChannelsFromSlackIntegration)(privateOrg.slackAccessToken, privateOrg.organizationId);
        }
        return slackChannels.map(c => c.name);
    },
})
    .mutation('create', {
    input: zod_1.z.object({
        slug: zod_1.z.string(),
        name: zod_1.z.string(),
    }),
    async resolve({ ctx: { user }, input: { slug, name } }) {
        if (!(0, organizations_1.isSlugAvailable)(slug)) {
            throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
        }
        return await (0, organizations_1.createOrganization)({
            slug,
            name,
            ownerId: user.id,
        });
    },
})
    .mutation('join', {
    input: zod_1.z.object({
        invitationId: zod_1.z.string(),
        accept: zod_1.z.boolean(),
    }),
    async resolve({ ctx: { prisma, user }, input: { accept, invitationId } }) {
        const invitation = await prisma.userOrganizationInvitation.findUnique({
            where: { id: invitationId },
        });
        if (!invitation) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (invitation.email !== user.email) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: `Sorry, this invitation is for another email address. You are logged in as ${user.email}.`,
            });
        }
        const existing = await prisma.userOrganizationAccess.findFirst({
            where: {
                userId: user.id,
                organizationId: invitation.organizationId,
            },
        });
        if (existing) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'You are already a member of this organization.',
            });
        }
        let access = null;
        if (accept) {
            access = await prisma.userOrganizationAccess.create({
                data: {
                    permissions: invitation.permissions,
                    organization: {
                        connect: {
                            id: invitation.organizationId,
                        },
                    },
                    user: {
                        connect: {
                            id: user.id,
                        },
                    },
                },
                select: {
                    id: true,
                    userId: true,
                    organization: { select: { slug: true, name: true } },
                },
            });
            await (0, user_1.processInvitationGroupIds)(invitation, access);
        }
        await prisma.userOrganizationInvitation.delete({
            where: { id: invitationId },
        });
        return access;
    },
})
    // ********** Endpoints below here require organization access **********
    .middleware(util_1.organizationMiddleware)
    .mutation('switch', {
    input: zod_1.z.object({
        organizationId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user }, input: { organizationId } }) {
        try {
            return prisma.userOrganizationAccess.update({
                where: {
                    userId_organizationId: {
                        userId: user.id,
                        organizationId,
                    },
                },
                data: {
                    lastSwitchedToAt: new Date(),
                },
            });
        }
        catch (err) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
    },
})
    .query('users', {
    input: zod_1.z
        .object({
        searchQuery: zod_1.z.string().optional(),
        limit: zod_1.z.number().optional(),
    })
        .default({}),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { searchQuery, limit }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        let userSearchFilter;
        searchQuery = searchQuery?.trim();
        // This is pretty naive and only find complete (non-fuzzy) matches
        //
        // Unfortunately, PostgreSQL full-text search isn't helpful here
        // because it requires full-token matches
        if (searchQuery) {
            const colsToSearch = ['firstName', 'lastName', 'email'];
            userSearchFilter = {
                OR: colsToSearch.flatMap(colName => [
                    {
                        [colName]: {
                            search: searchQuery,
                        },
                        [colName]: {
                            contains: searchQuery,
                        },
                    },
                ]),
            };
        }
        return prisma.userOrganizationAccess.findMany({
            where: {
                organizationId,
                user: userSearchFilter,
            },
            select: {
                id: true,
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
            orderBy: [
                // Order by first name first because that's how we display them
                {
                    user: {
                        firstName: 'asc',
                    },
                },
                {
                    user: {
                        lastName: 'asc',
                    },
                },
                {
                    user: {
                        email: 'asc',
                    },
                },
            ],
            take: limit,
        });
    },
})
    .mutation('edit', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        data: zod_1.z.object({
            slug: zod_1.z.string().optional(),
            name: zod_1.z.string().optional(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_SETTINGS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (data.slug) {
            if (!(0, organizations_1.isSlugAvailable)(data.slug, organizationId)) {
                throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
            }
        }
        const org = await prisma.organization.findFirst({
            where: {
                id,
            },
        });
        if (!org) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const organization = await prisma.organization.update({
            where: {
                id,
            },
            data,
        });
        return organization;
    },
})
    .mutation('edit.mfa', {
    input: zod_1.z.object({
        requireMfa: zod_1.z.boolean().optional(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { requireMfa }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_SETTINGS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const org = await prisma.organization.findFirst({
            where: {
                id: organizationId,
            },
        });
        if (!org) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const organization = await prisma.organization.update({
            where: {
                id: organizationId,
            },
            data: {
                requireMfa,
            },
        });
        return organization;
    },
})
    .mutation('delete', {
    async resolve({ ctx: { prisma, user, organizationId } }) {
        const org = await prisma.organization.findUnique({
            where: {
                id: organizationId,
            },
        });
        if (org?.ownerId !== user.id) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const otherOrganizations = await prisma.organization.findMany({
            where: {
                id: {
                    not: org.id,
                },
                ownerId: user.id,
            },
        });
        // Need at least one organization remaining
        if (otherOrganizations.length < 1) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return await prisma.organization.update({
            where: {
                id: org.id,
            },
            data: {
                deletedAt: new Date(),
            },
        });
    },
})
    .mutation('add-user', {
    input: zod_1.z.object({
        email: zod_1.z
            .string()
            .email()
            .transform(email => email.toLowerCase()),
        permissions: zod_1.z.array(zod_1.z.nativeEnum(client_1.UserAccessPermission)),
        groupIds: zod_1.z.array(zod_1.z.string()),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { email, permissions, groupIds }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const existingUser = await prisma.user.findFirst({
            where: { email },
        });
        if (existingUser) {
            const existingAccess = await prisma.userOrganizationAccess.findFirst({
                where: {
                    userId: existingUser.id,
                    organizationId,
                },
            });
            if (existingAccess) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'That user is already a member of this organization.',
                });
            }
        }
        const invitation = await prisma.userOrganizationInvitation.create({
            data: {
                email,
                organizationId,
                permissions,
                groupIds,
            },
            include: {
                organization: true,
            },
        });
        const didSend = await (0, emails_1.inviteNewUser)(email, {
            organizationName: invitation.organization.name,
            signupUrl: `${env_1.default.APP_URL}/accept-invitation?token=${invitation.id}`,
            preheader: `You've been invited to join ${invitation.organization.name} on Interval.`,
        });
        return { didSendInvitation: didSend?.response?.Message === 'OK' ?? false };
    },
})
    .mutation('revoke-invitation', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        try {
            await prisma.userOrganizationInvitation.delete({
                where: { id: input.id },
            });
        }
        catch (error) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return true;
    },
})
    .mutation('edit-user-access', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        data: zod_1.z.object({
            permissions: zod_1.z.array(zod_1.z.nativeEnum(client_1.UserAccessPermission)).optional(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { id, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS') ||
            // Cannot edit own access
            userOrganizationAccess.id === id) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const access = await prisma.userOrganizationAccess.findUnique({
            where: {
                id,
            },
            include: {
                organization: true,
            },
        });
        if (!access) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        // Cannot edit access of owner
        if (access.userId === access.organization.ownerId) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        try {
            const access = await prisma.userOrganizationAccess.update({
                where: {
                    id,
                },
                data: {
                    ...data,
                    updatedAt: new Date(),
                },
            });
            return access;
        }
        catch (err) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
    },
})
    .mutation('remove-user', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { id } }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_USERS') ||
            // Cannot remove self
            userOrganizationAccess.id === id) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const access = await prisma.userOrganizationAccess.findUnique({
            where: {
                id,
            },
            include: {
                organization: {
                    include: {
                        sso: true,
                    },
                },
                user: true,
            },
        });
        if (!access) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        // Cannot remove owner
        if (access.userId === access.organization.ownerId) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (access.user.idpId && access.organization.sso?.workosOrganizationId) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: `This user is managed by an external identity provider. Please remove them from your identity provider instead.`,
            });
        }
        try {
            // delete access group memberships
            await prisma.userAccessGroupMembership.deleteMany({
                where: { userOrganizationAccessId: access.id },
            });
            const deletedAccess = await prisma.userOrganizationAccess.delete({
                where: { id },
            });
            await prisma.apiKey.updateMany({
                where: {
                    userId: deletedAccess.userId,
                    organizationId: deletedAccess.organizationId,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                },
            });
            return deletedAccess;
        }
        catch (error) {
            logger_1.logger.log('Error removing user from org', {
                userOrganizationAccessId: access.id,
                userId: userOrganizationAccess.userId,
                error,
            });
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
    },
})
    .mutation('start-slack-oauth', {
    async resolve({ ctx: { prisma, userOrganizationAccess } }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_OAUTH')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (!userOrganizationAccess) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: `Please add Slack OAuth keys to your Interval instance before enabling this integration.`,
            });
        }
        const slackOauthNonce = (0, nanoid_1.nanoid)();
        await prisma.userOrganizationAccess.update({
            where: {
                id: userOrganizationAccess.id,
            },
            data: { slackOauthNonce },
        });
        const params = new URLSearchParams({
            scope: isomorphicConsts_1.SLACK_OAUTH_SCOPES,
            client_id: process.env.SLACK_CLIENT_ID,
            state: slackOauthNonce,
            redirect_uri: `${env_1.default.APP_URL}/api/auth/oauth/slack`,
        });
        const oauthUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
        return oauthUrl;
    },
});
