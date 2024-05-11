"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPermissionsToGroups = exports.getAllActionGroups = exports.getAllActions = exports.actionMetadataWithAccesses = exports.getLiveModeActions = exports.getActionGroups = exports.initializeActions = exports.getPermissionsWarning = exports.setActionGroupPermissions = exports.setActionPermissions = exports.reconstructActionGroups = void 0;
const prisma_1 = __importDefault(require("../../server/prisma"));
const client_1 = require("@prisma/client");
const validate_1 = require("../../utils/validate");
const actions_1 = require("../../utils/actions");
const permissions_1 = require("../../utils/permissions");
const isomorphicConsts_1 = require("../../utils/isomorphicConsts");
const logger_1 = require("../../server/utils/logger");
function reconstructActionGroups({ slugPrefix, actionGroups, actions, canConfigureActions, mode, }) {
    const actionsResponse = [];
    const allActions = [];
    const archivedActions = [];
    const groupsMap = addPermissionsToGroups({
        groups: actionGroups,
    });
    for (const group of groupsMap.values()) {
        const groupSlug = (0, actions_1.getGroupSlug)(group.slug);
        if (!groupSlug)
            continue;
        const parentGroup = groupsMap.get(groupSlug);
        if (parentGroup) {
            if (!group.unlisted &&
                (group.status === 'ONLINE' ||
                    (mode === 'live' && group.status && group.status !== 'OFFLINE'))) {
                parentGroup.groups.push(group);
            }
            group.parentSlug = parentGroup.slug;
        }
    }
    for (const action of actions) {
        if (action.isInline)
            continue;
        action.hostInstances.sort(actions_1.hostSorter);
        action.httpHosts.sort(actions_1.hostSorter);
        const status = (0, actions_1.getStatus)(action);
        const canConfigure = canConfigureActions;
        const { canRun, canView } = (0, actions_1.getActionAccessLevel)({
            action,
            groupsMap,
        });
        // skip if access is explicitly blocked
        if (canRun === false && canView === false) {
            continue;
        }
        const isArchived = !!action.metadata?.archivedAt;
        const groupSlug = (0, actions_1.getGroupSlug)(action.slug);
        allActions.push({
            id: action.id,
            slug: action.slug,
            name: action.name,
            status,
            description: action.description,
            unlisted: action.unlisted,
            isArchived,
            canView,
            canRun,
            canConfigure,
            parentSlug: groupSlug,
        });
        if (!status || status === 'OFFLINE') {
            continue;
        }
        if (mode === 'console' && status === 'UNREACHABLE') {
            continue;
        }
        if (action.unlisted) {
            continue;
        }
        const actionWithPermissions = {
            ...action,
            status,
            canRun,
            canView,
            canConfigure,
        };
        if (isArchived) {
            archivedActions.push(actionWithPermissions);
            continue;
        }
        if (groupSlug) {
            if (slugPrefix && groupSlug === slugPrefix) {
                actionsResponse.push(actionWithPermissions);
            }
            else {
                const group = groupsMap.get(groupSlug);
                if (group) {
                    group.actions.push(actionWithPermissions);
                    actionWithPermissions.parentSlug = group.slug;
                }
            }
        }
        else {
            actionsResponse.push(actionWithPermissions);
        }
    }
    const groupBreadcrumbs = slugPrefix
        ? actionGroups.filter(group => slugPrefix === group.slug || slugPrefix.startsWith(`${group.slug}/`))
        : [];
    groupBreadcrumbs.sort(actions_1.groupSorter);
    const allGroups = Array.from(groupsMap.values()).filter(group => {
        const status = (0, actions_1.getStatus)(group);
        // excludes groups marked as UNREACHABLE in dev mode
        if (mode === 'console') {
            return status && status === 'ONLINE';
        }
        if (!canAccessEntityInTree(groupsMap, group.slug)) {
            return false;
        }
        // includes groups marked as UNREACHABLE in live mode
        return status && status !== 'OFFLINE';
    });
    const groups = allGroups.filter(group => {
        const groupSlug = (0, actions_1.getGroupSlug)(group.slug);
        if (group.unlisted)
            return false;
        if (group.slug === slugPrefix)
            return false;
        if (!group.canRun && !group.canView && group.actions.length === 0) {
            return false;
        }
        return groupSlug === slugPrefix || (!groupSlug && !slugPrefix);
    });
    groups.sort(actions_1.groupSorter);
    (0, actions_1.sortByName)(actionsResponse);
    (0, actions_1.sortByName)(allActions);
    return {
        actions: actionsResponse,
        allActions,
        archivedActions,
        groups,
        allGroups,
        groupBreadcrumbs,
    };
}
exports.reconstructActionGroups = reconstructActionGroups;
async function setActionPermissions({ actionMetadata, teamPermissions, }) {
    // remove existing granular permissions and reconstruct permissions below
    await prisma_1.default.actionAccess.deleteMany({
        where: {
            actionMetadataId: actionMetadata.id,
        },
    });
    if (actionMetadata.availability === 'GROUPS') {
        for (const access of teamPermissions ?? []) {
            if (access.level === 'NONE')
                continue;
            try {
                await prisma_1.default.actionAccess.create({
                    data: {
                        level: access.level,
                        actionMetadata: { connect: { id: actionMetadata.id } },
                        userAccessGroup: { connect: { id: access.groupId } },
                    },
                });
            }
            catch (error) {
                logger_1.logger.error('Failed adding actionAccess', {
                    actionMetadataId: actionMetadata.id,
                    access,
                    error,
                });
            }
        }
    }
}
exports.setActionPermissions = setActionPermissions;
async function setActionGroupPermissions({ actionGroupMetadata, teamPermissions, }) {
    // remove existing granular permissions and reconstruct permissions below
    await prisma_1.default.actionGroupAccess.deleteMany({
        where: {
            actionGroupMetadataId: actionGroupMetadata.id,
        },
    });
    if (actionGroupMetadata.availability === 'GROUPS') {
        for (const access of teamPermissions ?? []) {
            if (access.level === 'NONE')
                continue;
            try {
                await prisma_1.default.actionGroupAccess.create({
                    data: {
                        level: access.level,
                        actionGroupMetadata: { connect: { id: actionGroupMetadata.id } },
                        userAccessGroup: { connect: { id: access.groupId } },
                    },
                });
            }
            catch (error) {
                logger_1.logger.error('Failed adding actionGroupAccess', {
                    actionGroupMetadataId: actionGroupMetadata.id,
                    access,
                    error,
                });
            }
        }
    }
}
exports.setActionGroupPermissions = setActionGroupPermissions;
function getTeamsFromDefinition(def) {
    const slugs = [];
    if (!def.access || typeof def.access === 'string')
        return [];
    if (!def.access.teams)
        return [];
    slugs.push(...def.access.teams);
    return slugs;
}
async function getPermissionsWarning({ groups, actions, organizationId, }) {
    const slugs = [];
    const validSlugs = (await prisma_1.default.userAccessGroup.findMany({
        where: { organizationId },
    })).map(group => group.slug);
    for (const group of groups ?? []) {
        const slugsInDef = getTeamsFromDefinition(group);
        for (const slug of slugsInDef) {
            if (!validSlugs.includes(slug)) {
                slugs.push(` - Page: ${group.slug} - team '${slug}' does not exist`);
            }
        }
    }
    for (const action of actions ?? []) {
        const slugsInDef = getTeamsFromDefinition(action);
        for (const slug of slugsInDef) {
            if (!validSlugs.includes(slug)) {
                slugs.push(` - Action: ${action.slug} - team '${slug}' does not exist`);
            }
        }
    }
    if (slugs.length > 0) {
        return [
            `One or more invalid team slugs were found in your config:`,
            slugs.join('\n'),
            `Use teams' slugs when granting access to actions and pages.\nLearn more: https://interval.com/docs/writing-actions/authentication#defining-permissions-in-code\n`,
        ].join('\n\n');
    }
    return null;
}
exports.getPermissionsWarning = getPermissionsWarning;
async function initializeActions({ hostInstance, httpHost, actions, groups, developerId, organizationEnvironmentId, sdkName, sdkVersion, }) {
    if (!hostInstance && !httpHost) {
        throw new Error('Must specify either HostInstance or HttpHost');
    }
    const organizationId = (hostInstance?.organizationId ??
        httpHost?.organizationId);
    const initializedActions = [];
    const initializedActionGroups = [];
    const isUsingPermissionsCapableSDK = sdkName === isomorphicConsts_1.NODE_SDK_NAME && sdkVersion >= permissions_1.SDK_PERMISSIONS_MIN_VERSION;
    if (groups) {
        for (const { slug, name, description, unlisted = false, hasHandler, hasIndex, access, } of groups) {
            if (!(0, validate_1.isGroupSlugValid)(slug)) {
                continue;
            }
            let group = await prisma_1.default.actionGroup.findFirst({
                where: {
                    organizationId,
                    organizationEnvironmentId,
                    developerId,
                    slug,
                },
            });
            const { availability, teamPermissions } = await permissionsCodeToConfig({
                access,
                organizationId,
            });
            if (group) {
                group = await prisma_1.default.actionGroup.update({
                    where: {
                        id: group.id,
                    },
                    data: {
                        name,
                        description,
                        unlisted,
                        hasHandler: hasHandler ?? hasIndex ?? false,
                        hostInstances: hostInstance
                            ? {
                                connect: { id: hostInstance.id },
                            }
                            : undefined,
                        httpHosts: httpHost
                            ? {
                                connect: { id: httpHost.id },
                            }
                            : undefined,
                    },
                });
            }
            else {
                group = await prisma_1.default.actionGroup.create({
                    data: {
                        slug,
                        organizationId,
                        developerId,
                        organizationEnvironmentId,
                        name,
                        description,
                        unlisted,
                        hasHandler: hasHandler ?? hasIndex ?? false,
                        hostInstances: hostInstance
                            ? {
                                connect: { id: hostInstance.id },
                            }
                            : undefined,
                        httpHosts: httpHost
                            ? {
                                connect: { id: httpHost.id },
                            }
                            : undefined,
                    },
                });
            }
            initializedActionGroups.push(group);
            if (isUsingPermissionsCapableSDK && developerId === null) {
                const actionGroupMetadata = await prisma_1.default.actionGroupMetadata.upsert({
                    where: { actionGroupId: group.id },
                    create: {
                        actionGroupId: group.id,
                        availability: availability ?? null,
                    },
                    update: {
                        availability: availability ?? null,
                    },
                });
                await setActionGroupPermissions({
                    actionGroupMetadata,
                    teamPermissions,
                });
            }
        }
    }
    for (const { groupSlug, slug, name, description, backgroundable = false, unlisted = false, warnOnClose = true, access, } of actions) {
        if (!(0, validate_1.isGroupSlugValid)(groupSlug) || !(0, validate_1.isSlugValid)(slug)) {
            continue;
        }
        const fullSlug = (0, actions_1.getFullActionSlug)({ groupSlug, slug });
        // Need to do this upsert manually because unique constraints
        // are unenforced for rows with null `developerId`
        let action = await prisma_1.default.action.findFirst({
            where: {
                organizationId,
                developerId,
                organizationEnvironmentId,
                slug: fullSlug,
            },
            include: {
                metadata: true,
            },
        });
        const { availability, teamPermissions } = await permissionsCodeToConfig({
            access,
            organizationId,
        });
        if (action) {
            action = await prisma_1.default.action.update({
                where: {
                    id: action.id,
                },
                data: {
                    name,
                    description,
                    backgroundable,
                    warnOnClose,
                    unlisted,
                    hostInstances: hostInstance
                        ? {
                            connect: { id: hostInstance.id },
                        }
                        : undefined,
                    httpHosts: httpHost
                        ? {
                            connect: { id: httpHost.id },
                        }
                        : undefined,
                },
                include: {
                    metadata: true,
                },
            });
        }
        else {
            action = await prisma_1.default.action.create({
                data: {
                    slug: fullSlug,
                    name,
                    description,
                    backgroundable,
                    warnOnClose,
                    unlisted,
                    organizationId,
                    hostInstances: hostInstance
                        ? {
                            connect: { id: hostInstance.id },
                        }
                        : undefined,
                    httpHosts: httpHost
                        ? {
                            connect: { id: httpHost.id },
                        }
                        : undefined,
                    developerId,
                    organizationEnvironmentId,
                },
                include: {
                    metadata: true,
                },
            });
        }
        initializedActions.push(action);
        if (isUsingPermissionsCapableSDK && developerId === null) {
            const actionMetadata = await prisma_1.default.actionMetadata.upsert({
                where: { actionId: action.id },
                create: {
                    actionId: action.id,
                    availability: availability ?? null,
                },
                update: {
                    availability: availability ?? null,
                },
            });
            await setActionPermissions({
                actionMetadata,
                teamPermissions,
            });
        }
    }
    return { initializedActions, initializedActionGroups };
}
exports.initializeActions = initializeActions;
const getActionGroups = (userId) => client_1.Prisma.validator()({
    include: {
        hostInstances: {
            where: { status: { not: 'OFFLINE' } },
            select: { status: true, isInitializing: true },
            orderBy: { createdAt: 'desc' },
        },
        httpHosts: {
            where: { status: { not: 'OFFLINE' } },
            select: { status: true },
            orderBy: { createdAt: 'desc' },
        },
        metadata: {
            include: {
                accesses: userId
                    ? (0, exports.actionMetadataWithAccesses)(userId).include.metadata.include
                        .accesses
                    : true,
            },
        },
    },
});
exports.getActionGroups = getActionGroups;
const getLiveModeActions = (userId) => client_1.Prisma.validator()({
    include: {
        hostInstances: {
            where: { status: { not: 'OFFLINE' } },
            select: { status: true },
            orderBy: { createdAt: 'desc' },
        },
        httpHosts: {
            where: { status: { not: 'OFFLINE' } },
            select: { status: true },
            orderBy: { createdAt: 'desc' },
        },
        schedules: {
            where: { deletedAt: null },
        },
        metadata: {
            include: {
                accesses: userId
                    ? (0, exports.actionMetadataWithAccesses)(userId).include.metadata.include
                        .accesses
                    : true,
            },
        },
    },
});
exports.getLiveModeActions = getLiveModeActions;
const actionMetadataWithAccesses = (userId) => client_1.Prisma.validator()({
    include: {
        metadata: {
            include: {
                accesses: {
                    where: {
                        userAccessGroup: {
                            memberships: {
                                some: {
                                    userOrganizationAccess: {
                                        userId,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
});
exports.actionMetadataWithAccesses = actionMetadataWithAccesses;
async function getAllActions({ organizationId, developerId, organizationEnvironmentId, userId, }) {
    return prisma_1.default.action.findMany({
        where: {
            organizationId,
            developerId,
            organizationEnvironmentId,
        },
        include: (0, exports.getLiveModeActions)(userId).include,
        orderBy: {
            slug: 'asc',
        },
    });
}
exports.getAllActions = getAllActions;
async function getAllActionGroups({ organizationId, developerId, organizationEnvironmentId, userId, }) {
    const groups = await prisma_1.default.actionGroup.findMany({
        where: {
            organizationId,
            developerId,
            organizationEnvironmentId,
        },
        include: (0, exports.getActionGroups)(userId).include,
        orderBy: {
            slug: 'asc',
        },
    });
    const groupsMap = new Map(groups.map(group => [group.slug, group]));
    return groupsMap;
}
exports.getAllActionGroups = getAllActionGroups;
/**
 * Converts code-based permissions into values for writing to the database.
 */
async function permissionsCodeToConfig({ access, organizationId, }) {
    const warnings = [];
    if (!access) {
        return { availability: undefined, teamPermissions: undefined, warnings };
    }
    let availability;
    let teamPermissions = [];
    if (access === 'entire-organization') {
        availability = 'ORGANIZATION';
    }
    else {
        availability = 'GROUPS';
        if ('teams' in access && access.teams) {
            const groups = await prisma_1.default.userAccessGroup.findMany({
                where: {
                    organizationId,
                    slug: {
                        in: access.teams,
                    },
                },
            });
            const validSlugs = groups.map(group => group.slug);
            const invalidSlugs = access.teams.filter(slug => !validSlugs.includes(slug));
            for (const slug in invalidSlugs) {
                warnings.push('Invalid team slug: ' + slug);
            }
            // RUNNER only supported via code config
            teamPermissions = groups.map(group => ({
                groupId: group.id,
                level: 'RUNNER',
            }));
        }
    }
    return {
        availability,
        teamPermissions,
        warnings,
    };
}
/**
 * Creates a map of ActionGroups that includes inherited permissions.
 */
function addPermissionsToGroups({ groups }) {
    const groupsMap = new Map(groups.map(group => [group.slug, group]));
    const groupsWithPermissions = new Map(Array.from(groupsMap.values()).map(group => {
        const { canRun, canView } = (0, actions_1.getActionGroupAccessLevel)({
            group,
            groupsMap,
        });
        return [
            group.slug,
            {
                ...group,
                status: (0, actions_1.getStatus)(group),
                canRun,
                canView,
                actions: [],
                groups: [],
            },
        ];
    }));
    return groupsWithPermissions;
}
exports.addPermissionsToGroups = addPermissionsToGroups;
/**
 * Determines whether the user can access a group, actions in that group,
 * or any groups & their actions nested within the `groupSlug`.
 */
function canAccessEntityInTree(groupsMap, groupSlug) {
    const group = groupsMap.get(groupSlug);
    if (group && group.canRun)
        return true;
    if (group && group.actions.length > 0)
        return true;
    const nestedGroups = Array.from(groupsMap.keys()).filter(slug => slug.startsWith(`${groupSlug}/`));
    for (const nestedSlug of nestedGroups) {
        const canAccessChildren = canAccessEntityInTree(groupsMap, nestedSlug);
        if (canAccessChildren)
            return true;
    }
    return false;
}
