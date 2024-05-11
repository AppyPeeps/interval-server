"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const client_1 = require("@prisma/client");
const permissions_1 = require("../../utils/permissions");
const util_1 = require("./util");
const actions_1 = require("../../utils/actions");
const actions_2 = require("../../server/utils/actions");
const actionSchedule_1 = require("../../server/utils/actionSchedule");
const ghostMode_1 = require("../utils/ghostMode");
const timezones_1 = require("../../utils/timezones");
const featureFlags_1 = require("../utils/featureFlags");
const isomorphicConsts_1 = require("../../utils/isomorphicConsts");
const logger_1 = require("../../server/utils/logger");
exports.actionRouter = (0, util_1.createRouter)()
    .query('console.index', {
    input: zod_1.z
        .object({
        slugPrefix: zod_1.z.string().optional(),
    })
        .default({}),
    async resolve({ ctx, input: { slugPrefix } }) {
        const { userId, organizationId, organizationEnvironmentId } = await (0, ghostMode_1.authorizePotentialGhostRequest)(ctx, 'READ_DEV_ACTIONS');
        const [actions, actionGroups, currentPage, hasAnyActions] = await Promise.all([
            ctx.prisma.action.findMany({
                where: {
                    isInline: false,
                    organizationId,
                    developerId: userId,
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
                orderBy: {
                    slug: 'asc',
                },
                include: {
                    hostInstances: {
                        where: {
                            status: {
                                in: ['ONLINE', 'UNREACHABLE'],
                            },
                        },
                        select: { status: true },
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
                    schedules: {
                        where: { deletedAt: null },
                    },
                    ...(0, actions_2.actionMetadataWithAccesses)(userId).include,
                },
            }),
            ctx.prisma.actionGroup.findMany({
                where: {
                    organizationId,
                    developerId: userId,
                    organizationEnvironmentId,
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
                    ...(0, actions_2.actionMetadataWithAccesses)(userId).include,
                },
                orderBy: {
                    slug: 'asc',
                },
            }),
            ctx.prisma.actionGroup.findFirst({
                where: {
                    slug: slugPrefix,
                    organizationId,
                    developerId: userId,
                    organizationEnvironmentId,
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
            }),
            ctx.prisma.action
                .findFirst({
                where: {
                    isInline: false,
                    organizationId,
                    developerId: userId,
                    organizationEnvironmentId,
                },
            })
                .then(action => {
                return !!action;
            }),
        ]);
        const onlineActions = actions.filter(act => act.hostInstances.some(hi => hi.status === 'ONLINE') ||
            act.httpHosts.some(hh => hh.status === 'ONLINE'));
        const queued = await ctx.prisma.queuedAction.findMany({
            where: {
                action: {
                    id: {
                        in: onlineActions.map(a => a.id),
                    },
                },
                AND: [
                    {
                        OR: [
                            {
                                assigneeId: null,
                            },
                            {
                                assigneeId: userId,
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
                                    ownerId: userId,
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
                action: (0, actions_2.actionMetadataWithAccesses)(userId),
                transaction: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        return {
            ...(0, actions_2.reconstructActionGroups)({
                slugPrefix,
                actionGroups,
                actions: onlineActions,
                canConfigureActions: true,
                mode: 'console',
            }),
            currentPage,
            queued,
            hasAnyActions,
        };
    },
})
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('all', {
    input: zod_1.z
        .object({
        envSlug: zod_1.z.string().nullish(),
    })
        .optional(),
    async resolve({ input: { envSlug } = {}, ctx: { prisma, user, organizationId, userOrganizationAccess, organizationEnvironmentId, }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (envSlug) {
            const orgEnv = await prisma.organizationEnvironment.findFirst({
                where: {
                    organizationId,
                    slug: envSlug,
                },
            });
            if (!orgEnv) {
                throw new server_1.TRPCError({ code: 'NOT_FOUND' });
            }
            organizationEnvironmentId = orgEnv.id;
        }
        const allActions = await (0, actions_2.getAllActions)({
            organizationId,
            developerId: null,
            organizationEnvironmentId,
            userId: user.id,
        });
        const actions = allActions.filter(a => !a.metadata?.archivedAt);
        const archivedActions = allActions.filter(a => !!a.metadata?.archivedAt);
        return {
            actions,
            archivedActions,
        };
    },
})
    .query('one', {
    input: zod_1.z.object({
        slug: zod_1.z.string(),
        environment: zod_1.z.nativeEnum(client_1.UsageEnvironment).default('PRODUCTION'),
    }),
    async resolve({ ctx: { prisma, user, organizationId, userOrganizationAccess, organizationEnvironmentId, }, input: { slug, environment }, }) {
        const action = await prisma.action.findFirst({
            where: {
                isInline: false,
                slug,
                organizationId,
                developerId: environment === 'DEVELOPMENT' ? user.id : null,
                organizationEnvironmentId,
            },
            include: {
                organization: {
                    include: {
                        userOrganizationAccess: {
                            where: {
                                userId: user.id,
                            },
                        },
                    },
                },
                schedules: {
                    where: {
                        deletedAt: null,
                    },
                    include: {
                        runner: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                            },
                        },
                    },
                },
                hostInstances: {
                    where: {
                        status: {
                            in: ['ONLINE', 'UNREACHABLE'],
                        },
                    },
                    select: { sdkName: true, sdkVersion: true },
                    orderBy: { createdAt: 'desc' },
                },
                httpHosts: {
                    where: {
                        status: {
                            in: ['ONLINE', 'UNREACHABLE'],
                        },
                    },
                    select: { sdkName: true, sdkVersion: true },
                    orderBy: { createdAt: 'desc' },
                },
                transactions: {
                    where: {
                        actionScheduleId: {
                            not: null,
                        },
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                },
                ...(0, actions_2.actionMetadataWithAccesses)(user.id).include,
            },
        });
        if (!action ||
            (action.developerId && action.developerId !== user.id) ||
            !action.organization.userOrganizationAccess?.length) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const requiredPermission = action.developerId
            ? 'READ_DEV_ACTIONS'
            : 'READ_PROD_ACTIONS';
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, requiredPermission)) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const groupsMap = await (0, actions_2.getAllActionGroups)({
            organizationId,
            developerId: environment === 'DEVELOPMENT' ? user.id : null,
            organizationEnvironmentId,
        });
        const isUsingCodeBasedPermissions = [
            ...action.hostInstances,
            ...action.httpHosts,
        ].some(h => {
            return (h.sdkName === isomorphicConsts_1.NODE_SDK_NAME &&
                h.sdkVersion &&
                h.sdkVersion >= permissions_1.SDK_PERMISSIONS_MIN_VERSION);
        });
        return {
            ...action,
            ...(0, actions_1.getActionAccessLevel)({ action, groupsMap }),
            isUsingCodeBasedPermissions,
        };
    },
})
    .mutation('general.update', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
        data: zod_1.z.object({
            name: zod_1.z
                .string()
                .transform(s => s.trim())
                .nullish(),
            backgroundable: zod_1.z.boolean().nullish(),
            description: zod_1.z
                .string()
                .transform(s => s.trim())
                .nullable()
                .optional(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { actionId, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (!(0, featureFlags_1.isFlagEnabled)('ACTION_METADATA_GENERAL_CONFIG', organizationId)) {
            return;
        }
        const metadata = await prisma.actionMetadata.upsert({
            where: { actionId },
            create: {
                actionId,
                ...data,
            },
            update: data,
            include: {
                action: {
                    include: {
                        schedules: {
                            where: {
                                deletedAt: null,
                            },
                        },
                    },
                },
            },
        });
        if (!(0, actions_1.isBackgroundable)({ ...metadata.action, metadata })) {
            await (0, actionSchedule_1.syncActionSchedules)(metadata.action, []);
        }
        return metadata;
    },
})
    .mutation('notifications.update', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
        data: zod_1.z.object({
            defaultNotificationDelivery: zod_1.z
                .union([
                zod_1.z.null(),
                zod_1.z.array(zod_1.z.object({
                    method: zod_1.z.nativeEnum(client_1.NotificationMethod),
                    to: zod_1.z.string(),
                })),
            ])
                .nullable(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { actionId, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const defaultNotificationDelivery = data.defaultNotificationDelivery === null
            ? client_1.Prisma.DbNull
            : JSON.stringify(data.defaultNotificationDelivery);
        const metadata = await prisma.actionMetadata.upsert({
            where: { actionId },
            create: {
                actionId,
                defaultNotificationDelivery,
            },
            update: {
                defaultNotificationDelivery,
            },
        });
        return metadata;
    },
})
    .mutation('permissions.update', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
        data: zod_1.z.object({
            availability: zod_1.z.nativeEnum(client_1.ActionAvailability).nullable(),
            groupPermissions: zod_1.z
                .array(zod_1.z.object({
                groupId: zod_1.z.string(),
                level: zod_1.z.union([
                    zod_1.z.nativeEnum(client_1.ActionAccessLevel),
                    zod_1.z.literal('NONE'),
                ]),
            }))
                .optional(),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { actionId, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const { groupPermissions, availability } = data;
        const actionMetadata = await prisma.actionMetadata.upsert({
            where: { actionId },
            create: {
                actionId,
                availability,
            },
            update: {
                availability,
            },
        });
        await (0, actions_2.setActionPermissions)({
            actionMetadata,
            teamPermissions: groupPermissions,
        });
        return actionMetadata;
    },
})
    .mutation('schedule.update', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
        data: zod_1.z.object({
            actionScheduleInputs: zod_1.z.array(zod_1.z.object({
                id: zod_1.z.string().optional(),
                schedulePeriod: zod_1.z.enum(['hour', 'day', 'week', 'month']),
                timeZoneName: zod_1.z.enum(timezones_1.ALL_TIMEZONES).optional(),
                hours: zod_1.z.number().int().optional(),
                minutes: zod_1.z.number().int().optional(),
                dayOfWeek: zod_1.z.number().int().optional(),
                dayOfMonth: zod_1.z.number().int().optional(),
                notifyOnSuccess: zod_1.z.boolean().optional(),
                runnerId: zod_1.z.string().nullish(),
            })),
        }),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { actionId, data }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const { actionScheduleInputs } = data;
        const metadata = await prisma.actionMetadata.upsert({
            where: { actionId },
            create: {
                actionId,
            },
            update: {},
            include: {
                action: {
                    include: {
                        schedules: {
                            where: {
                                deletedAt: null,
                            },
                        },
                    },
                },
            },
        });
        const { action } = metadata;
        if (actionScheduleInputs?.some(scheduleInput => !(0, actionSchedule_1.isInputValid)(scheduleInput))) {
            logger_1.logger.error('Failed syncing action schedules', {
                actionId,
                actionScheduleInputs,
            });
            throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
        }
        try {
            await (0, actionSchedule_1.syncActionSchedules)({ ...action, metadata }, actionScheduleInputs ?? []);
        }
        catch (error) {
            logger_1.logger.error(`Failed syncing action schedules for action ${action.slug}`, {
                actionId,
                actionScheduleInputs,
                error,
            });
            throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
    },
})
    .mutation('archive', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { actionId }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const action = await prisma.action.findFirst({
            where: { id: actionId },
            include: {
                schedules: {
                    where: {
                        deletedAt: null,
                    },
                },
                metadata: true,
            },
        });
        if (!action) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        // Remove all schedules
        try {
            await (0, actionSchedule_1.syncActionSchedules)(action, []);
        }
        catch (err) {
            logger_1.logger.error(`Failed remove action schedules for action ${action.slug}`, {
                actionId: action.id,
            });
        }
        await prisma.actionMetadata.upsert({
            where: {
                actionId: action.id,
            },
            create: {
                actionId: action.id,
                archivedAt: new Date(),
            },
            update: {
                archivedAt: new Date(),
            },
        });
    },
})
    .mutation('unarchive', {
    input: zod_1.z.object({
        actionId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { actionId }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return prisma.actionMetadata.update({
            where: { actionId },
            data: {
                archivedAt: null,
            },
        });
    },
})
    .mutation('dequeue', {
    input: zod_1.z.object({
        queuedActionId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, organizationId, user, userOrganizationAccess }, input: { queuedActionId }, }) {
        const queuedAction = await prisma.queuedAction.findUnique({
            where: {
                id: queuedActionId,
            },
            include: {
                action: true,
            },
        });
        if (!queuedAction ||
            queuedAction.action.organizationId !== organizationId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (queuedAction.action.developerId !== user.id &&
            !(0, permissions_1.hasPermission)(userOrganizationAccess, 'DEQUEUE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return prisma.queuedAction.delete({
            where: { id: queuedActionId },
        });
    },
});
