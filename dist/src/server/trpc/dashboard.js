"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRouter = void 0;
const zod_1 = require("zod");
const util_1 = require("./util");
const permissions_1 = require("../../utils/permissions");
const actions_1 = require("../../utils/actions");
const actions_2 = require("../utils/actions");
const apiKey_1 = require("../../server/utils/apiKey");
const env_1 = __importDefault(require("../../env"));
const auth_1 = require("../../server/auth");
exports.dashboardRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .query('global-feature-flags', {
    async resolve({ ctx }) {
        return await ctx.prisma.globalFeatureFlag.findMany({
            where: {
                enabled: true,
            },
        });
    },
})
    .query('integrations', {
    async resolve() {
        // TODO: postmark, etc
        return {
            slack: !!env_1.default.SLACK_CLIENT_ID && !!env_1.default.SLACK_CLIENT_SECRET,
            workos: auth_1.isWorkOSEnabled,
        };
    },
})
    .middleware(util_1.organizationMiddleware)
    .query('structure', {
    input: zod_1.z
        .object({
        mode: zod_1.z.enum(['live', 'console']).default('live'),
        // key is only used on the client for query key busting; has no effect
        key: zod_1.z.string().optional(),
    })
        .default({}),
    async resolve({ ctx: { user, organizationId, userOrganizationAccess, organizationEnvironmentId, prisma, }, input: { mode }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, mode === 'live' ? 'READ_PROD_ACTIONS' : 'READ_DEV_ACTIONS')) {
            return {
                actions: [],
                groups: [],
                mostUsedActions: [],
            };
        }
        const canConfigureActions = (0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS');
        const canRunActions = (0, permissions_1.hasPermission)(userOrganizationAccess, 'RUN_PROD_ACTIONS');
        const [actions, actionGroups, mostUsedActions] = await Promise.all([
            (0, actions_2.getAllActions)({
                organizationId,
                developerId: mode === 'console' ? user.id : null,
                organizationEnvironmentId,
                userId: mode === 'live' ? user.id : undefined,
            }),
            (0, actions_2.getAllActionGroups)({
                organizationId,
                developerId: mode === 'console' ? user.id : null,
                organizationEnvironmentId,
                userId: mode === 'live' ? user.id : undefined,
            }),
            canRunActions
                ? prisma.transaction.groupBy({
                    by: ['actionId'],
                    _count: {
                        actionId: true,
                    },
                    where: {
                        createdAt: {
                            gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
                        },
                    },
                    orderBy: {
                        _count: {
                            actionId: 'desc',
                        },
                    },
                    take: 3,
                })
                : [],
        ]);
        const router = (0, actions_2.reconstructActionGroups)({
            actionGroups: Array.from(actionGroups.values()),
            actions,
            canConfigureActions,
            mode,
        });
        return {
            actions: router.allActions,
            groups: router.allGroups,
            mostUsedActions,
        };
    },
})
    .query('dev-host-status', {
    async resolve({ ctx: { prisma, organizationId, userOrganizationAccess, user }, }) {
        const devApiKey = await (0, apiKey_1.getDevKey)({
            user,
            organizationId,
            userOrganizationAccess,
        });
        const devHosts = await prisma.hostInstance.findMany({
            where: {
                status: 'ONLINE',
                apiKeyId: devApiKey.id,
            },
        });
        return {
            hasOnlineDevHost: devHosts.length > 0,
            devApiKey: devApiKey.key,
        };
    },
})
    .query('home.index', {
    input: zod_1.z
        .object({
        slugPrefix: zod_1.z.string().optional(),
    })
        .default({}),
    async resolve({ ctx: { prisma, user, organizationId, userOrganizationAccess, organizationEnvironmentId, }, input: { slugPrefix }, }) {
        // Only need to show in-progress transactions if they can be acted on
        const canRunActions = (0, permissions_1.hasPermission)(userOrganizationAccess, 'RUN_PROD_ACTIONS');
        const [transactions, queuedActions, actions, actionGroups] = await Promise.all([
            canRunActions
                ? prisma.transaction.findMany({
                    where: {
                        owner: {
                            id: user.id,
                        },
                        status: {
                            in: ['PENDING', 'RUNNING', 'AWAITING_INPUT'],
                        },
                        action: {
                            developerId: null,
                            organizationEnvironmentId,
                            slug: slugPrefix
                                ? {
                                    startsWith: `${slugPrefix}/`,
                                }
                                : undefined,
                        },
                    },
                    include: {
                        action: (0, actions_2.actionMetadataWithAccesses)(user.id),
                        queuedAction: true,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                })
                : [],
            canRunActions
                ? prisma.queuedAction.findMany({
                    where: {
                        action: {
                            organizationId,
                            developerId: null,
                            organizationEnvironmentId,
                            slug: slugPrefix
                                ? {
                                    startsWith: `${slugPrefix}/`,
                                }
                                : undefined,
                        },
                        OR: [
                            {
                                action: {
                                    metadata: null,
                                },
                            },
                            {
                                action: {
                                    metadata: {
                                        archivedAt: null,
                                    },
                                },
                            },
                        ],
                        AND: [
                            {
                                OR: [
                                    {
                                        assigneeId: null,
                                    },
                                    {
                                        assigneeId: user.id,
                                    },
                                ],
                            },
                            {
                                OR: [
                                    {
                                        transactionId: null,
                                    },
                                    {
                                        transaction: {
                                            ownerId: user.id,
                                            status: {
                                                in: ['PENDING', 'RUNNING', 'AWAITING_INPUT'],
                                            },
                                            resultStatus: null,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    include: {
                        action: (0, actions_2.actionMetadataWithAccesses)(user.id),
                        transaction: true,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                })
                : [],
            (0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_PROD_ACTIONS')
                ? prisma.action.findMany({
                    where: {
                        isInline: false,
                        organizationId,
                        developerId: null,
                        organizationEnvironmentId,
                        slug: slugPrefix
                            ? {
                                startsWith: `${slugPrefix}/`,
                            }
                            : undefined,
                        OR: [
                            {
                                hostInstances: {
                                    some: {
                                        status: {
                                            in: ['ONLINE', 'UNREACHABLE'],
                                        },
                                    },
                                },
                            },
                            {
                                httpHosts: {
                                    some: {
                                        status: {
                                            in: ['ONLINE', 'UNREACHABLE'],
                                        },
                                    },
                                },
                            },
                        ],
                    },
                    include: {
                        hostInstances: {
                            where: {
                                status: {
                                    in: ['ONLINE', 'UNREACHABLE'],
                                },
                            },
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                        httpHosts: {
                            where: {
                                status: {
                                    in: ['ONLINE', 'UNREACHABLE'],
                                },
                            },
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                        schedules: {
                            where: { deletedAt: null },
                        },
                        ...(0, actions_2.actionMetadataWithAccesses)(user.id).include,
                    },
                    orderBy: {
                        slug: 'asc',
                    },
                })
                : [],
            (0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_PROD_ACTIONS')
                ? prisma.actionGroup.findMany({
                    where: {
                        organizationId,
                        organizationEnvironmentId,
                        developerId: null,
                        OR: [
                            {
                                hostInstances: {
                                    some: {
                                        status: {
                                            in: ['ONLINE', 'UNREACHABLE'],
                                        },
                                    },
                                },
                            },
                            {
                                httpHosts: {
                                    some: {
                                        status: {
                                            in: ['ONLINE', 'UNREACHABLE'],
                                        },
                                    },
                                },
                            },
                        ],
                    },
                    include: {
                        hostInstances: {
                            where: {
                                status: {
                                    in: ['ONLINE', 'UNREACHABLE'],
                                },
                            },
                            select: { status: true, isInitializing: true },
                            orderBy: { createdAt: 'desc' },
                        },
                        httpHosts: {
                            where: {
                                status: {
                                    in: ['ONLINE', 'UNREACHABLE'],
                                },
                            },
                            select: { status: true },
                            orderBy: { createdAt: 'desc' },
                        },
                        ...(0, actions_2.actionMetadataWithAccesses)(user.id).include,
                    },
                    orderBy: {
                        slug: 'asc',
                    },
                })
                : [],
        ]);
        const canConfigureActions = (0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS');
        const filteredActions = actions.filter(a => {
            if (a.metadata?.archivedAt)
                return false;
            return true;
        });
        const filteredTransactions = transactions.filter(tx => {
            return !tx.action.metadata?.archivedAt && (0, actions_1.isBackgroundable)(tx.action);
        });
        const structure = (0, actions_2.reconstructActionGroups)({
            slugPrefix,
            actionGroups,
            actions: filteredActions,
            canConfigureActions,
            mode: 'live',
        });
        return {
            ...structure,
            transactions: filteredTransactions,
            queuedActions,
            currentPage: slugPrefix
                ? structure.allGroups.find(g => g.slug === slugPrefix)
                : null,
        };
    },
})
    .query('users.index', {
    input: zod_1.z
        .object({
        groupId: zod_1.z.string().optional(),
    })
        .default({}),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { groupId }, }) {
        const [users, keys, pendingInvitations] = await Promise.all([
            (0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_USERS')
                ? prisma.userOrganizationAccess.findMany({
                    where: {
                        organization: { id: organizationId },
                        groupMemberships: groupId
                            ? {
                                some: {
                                    groupId,
                                },
                            }
                            : undefined,
                    },
                    select: {
                        id: true,
                        permissions: true,
                        createdAt: true,
                        user: {
                            select: {
                                id: true,
                                email: true,
                                firstName: true,
                                lastName: true,
                                idpId: true,
                                emailConfirmToken: {
                                    select: {
                                        email: true,
                                    },
                                },
                            },
                        },
                        groupMemberships: {
                            select: {
                                group: {
                                    select: {
                                        id: true,
                                        scimGroupId: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: [
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
                    ],
                })
                : [],
            (0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_ORG_USER_API_KEY_EXISTENCE')
                ? prisma.apiKey.findMany({
                    where: { organization: { id: organizationId } },
                    select: {
                        id: true,
                        userId: true,
                        label: true,
                        createdAt: true,
                        deletedAt: true,
                        usageEnvironment: true,
                        organizationEnvironment: true,
                        hostInstances: {
                            select: {
                                createdAt: true,
                            },
                            orderBy: {
                                createdAt: 'desc',
                            },
                            take: 1,
                        },
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                })
                : [],
            (0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_USERS')
                ? prisma.userOrganizationInvitation.findMany({
                    where: { organization: { id: organizationId } },
                    select: {
                        id: true,
                        permissions: true,
                        createdAt: true,
                        email: true,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                })
                : [],
        ]);
        return { users, keys, pendingInvitations };
    },
});
