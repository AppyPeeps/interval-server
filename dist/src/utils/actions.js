"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBackgroundable = exports.getActionUrl = exports.getDashboardPath = exports.usageEnvironmentToMode = exports.getBaseSlug = exports.getGroupSlug = exports.getFullActionSlug = exports.getActionGroupAccessLevel = exports.getActionAccessLevel = exports.userCanAccessActionGroup = exports.actionAccessHasLevel = exports.groupSorter = exports.getDescription = exports.getStatus = exports.hostSorter = exports.getNameFromStructure = exports.getNameFromSlug = exports.getName = exports.sortByName = exports.SLUG_VALID_TEXT = void 0;
const environments_1 = require("./environments");
exports.SLUG_VALID_TEXT = 'Action slugs must contain only letters, numbers, underscores, periods, and hyphens.';
function sortByName(actions) {
    actions.sort(nameSorter);
}
exports.sortByName = sortByName;
function getName(action) {
    return ((action.metadata && 'name' in action.metadata
        ? action.metadata?.name
        : undefined) ??
        action.name ??
        getNameFromSlug(action.slug));
}
exports.getName = getName;
function getNameFromSlug(slug) {
    return slug.split('/').slice(-1)[0];
}
exports.getNameFromSlug = getNameFromSlug;
function getNameFromStructure(slug, structure) {
    const action = structure.actions.find(a => a.slug === slug);
    if (!action)
        return null;
    return getName(action);
}
exports.getNameFromStructure = getNameFromStructure;
const STATUS_ORDERS = ['ONLINE', 'UNREACHABLE', 'OFFLINE'];
/** Assumes already sorted by createdAt in DB query */
function hostSorter(h1, h2) {
    const s1 = STATUS_ORDERS.indexOf(h1.status);
    const s2 = STATUS_ORDERS.indexOf(h2.status);
    return s1 - s2;
}
exports.hostSorter = hostSorter;
function getStatus(actionOrGroup) {
    return (actionOrGroup.hostInstances[0]?.status ?? actionOrGroup.httpHosts[0]?.status);
}
exports.getStatus = getStatus;
function getDescription(action) {
    return action.metadata?.description ?? action.description;
}
exports.getDescription = getDescription;
function nameSorter(a, b) {
    const aName = getName(a).toLowerCase();
    const bName = getName(b).toLowerCase();
    if (aName < bName)
        return -1;
    if (aName > bName)
        return 1;
    return 0;
}
function groupSorter(a, b) {
    if (b.slug.includes(a.slug))
        return -1;
    if (a.slug.includes(b.slug))
        return 1;
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName < bName)
        return -1;
    if (aName > bName)
        return 1;
    return 0;
}
exports.groupSorter = groupSorter;
function actionAccessHasLevel(access, accessLevel) {
    const { level } = access;
    switch (accessLevel) {
        case 'ADMINISTRATOR':
            return level === 'ADMINISTRATOR';
        case 'RUNNER':
            return level === 'RUNNER' || level === 'ADMINISTRATOR';
        case 'VIEWER':
            return (level === 'VIEWER' || level === 'RUNNER' || level === 'ADMINISTRATOR');
    }
}
exports.actionAccessHasLevel = actionAccessHasLevel;
/**
 * Determines whether the user can run the given action.
 * Does not check whether the user can run actions at all, do that elsewhere.
 *
 * Relies on the backend only returning their own development actions, and
 * only returning the user's own ActionAccesses.
 *
 * Returns `undefined` if availability is set to ORGANIZATION, as access
 * may be inherited by a parent group.
 */
function userCanAccessAction(action, accessLevel) {
    // Should only receive own from backend
    if (action.developerId)
        return true;
    if (action.metadata?.archivedAt)
        return false;
    switch (action.metadata?.availability) {
        case undefined:
        case null:
            return undefined;
        case 'ORGANIZATION':
            return true;
        case 'GROUPS':
            return (action.metadata.accesses.some(access => actionAccessHasLevel(access, accessLevel)) ?? false);
    }
}
/**
 * Determines whether the user can run the given action group.
 * Does not check whether the user can run actions at all, do that elsewhere.
 *
 * Relies on the backend only returning their own development actions, and
 * only returning the user's own ActionAccesses
 *
 * Returns `undefined` if availability is set to ORGANIZATION, as access
 * may be inherited by a parent group.
 */
function userCanAccessActionGroup(actionGroup, accessLevel) {
    // Should only receive own from backend
    if (actionGroup.developerId)
        return true;
    switch (actionGroup.metadata?.availability) {
        case undefined:
        case null:
            return undefined;
        case 'ORGANIZATION':
            return true;
        case 'GROUPS':
            return actionGroup.metadata.accesses.some(access => actionAccessHasLevel(access, accessLevel));
    }
}
exports.userCanAccessActionGroup = userCanAccessActionGroup;
function getInheritedAccess(groupsMap, slug, accessLevel) {
    const group = groupsMap.get(slug);
    const groupAccess = group && userCanAccessActionGroup(group, 'RUNNER');
    if (group && groupAccess !== undefined) {
        return groupAccess;
    }
    if (slug.includes('/')) {
        return getInheritedAccess(groupsMap, slug.slice(0, slug.lastIndexOf('/')), accessLevel);
    }
    return undefined;
}
function getActionAccessLevel({ action, groupsMap, }) {
    const actionRunPermission = userCanAccessAction(action, 'RUNNER');
    const actionViewPermission = userCanAccessAction(action, 'VIEWER');
    const inheritedRunPermission = getInheritedAccess(groupsMap, action.slug, 'RUNNER');
    const inheritedViewPermission = getInheritedAccess(groupsMap, action.slug, 'VIEWER');
    // action-level permissions take precedence over permissions inherited from groups
    if (actionRunPermission !== undefined) {
        return {
            canRun: actionRunPermission,
            canView: actionViewPermission ?? actionRunPermission,
        };
    }
    if (inheritedRunPermission !== undefined) {
        return {
            canRun: inheritedRunPermission,
            canView: inheritedViewPermission ?? inheritedRunPermission,
        };
    }
    // undefined all the way up the tree; assume access to be true
    return { canRun: true, canView: true };
}
exports.getActionAccessLevel = getActionAccessLevel;
function getActionGroupAccessLevel({ group, groupsMap, }) {
    const groupRunPermission = userCanAccessActionGroup(group, 'RUNNER');
    const groupViewPermission = userCanAccessActionGroup(group, 'VIEWER');
    const inheritedRunPermission = getInheritedAccess(groupsMap, group.slug, 'RUNNER');
    const inheritedViewPermission = getInheritedAccess(groupsMap, group.slug, 'VIEWER');
    if (groupRunPermission !== undefined) {
        return {
            canRun: groupRunPermission,
            canView: groupViewPermission ?? groupRunPermission,
        };
    }
    if (inheritedRunPermission !== undefined) {
        return {
            canRun: inheritedRunPermission,
            canView: inheritedViewPermission ?? inheritedRunPermission,
        };
    }
    // undefined all the way up the tree; assume access to be true
    return { canRun: true, canView: true };
}
exports.getActionGroupAccessLevel = getActionGroupAccessLevel;
function getFullActionSlug({ groupSlug, slug, }) {
    let fullSlug = [groupSlug, slug].join('/');
    if (fullSlug.startsWith('/')) {
        fullSlug = fullSlug.substring(1);
    }
    return fullSlug;
}
exports.getFullActionSlug = getFullActionSlug;
function getGroupSlug(fullSlug) {
    if (!fullSlug.includes('/')) {
        return undefined;
    }
    return fullSlug.substring(0, fullSlug.lastIndexOf('/'));
}
exports.getGroupSlug = getGroupSlug;
function getBaseSlug(fullSlug) {
    if (!fullSlug.includes('/')) {
        return fullSlug;
    }
    const baseSlug = fullSlug.substring(fullSlug.lastIndexOf('/'), fullSlug.length);
    if (baseSlug.startsWith('/')) {
        return baseSlug.substring(1);
    }
    return baseSlug;
}
exports.getBaseSlug = getBaseSlug;
function usageEnvironmentToMode(usageEnvironment) {
    switch (usageEnvironment) {
        case 'ANON_CONSOLE':
            return 'anon-console';
        case 'PRODUCTION':
            return 'live';
        case 'DEVELOPMENT':
            return 'console';
    }
}
exports.usageEnvironmentToMode = usageEnvironmentToMode;
function getDashboardPath({ mode, ...props }) {
    if ('orgEnvSlug' in props) {
        switch (mode) {
            case 'live':
                return `/dashboard/${props.orgEnvSlug}/actions`;
            case 'console':
                return `/dashboard/${props.orgEnvSlug}/develop/actions`;
            case 'anon-console':
                return `/develop/${props.orgEnvSlug}/actions`;
        }
    }
    const orgEnvSlug = (0, environments_1.getOrgEnvSlug)(props.envSlug, props.orgSlug);
    switch (mode) {
        case 'live':
        case 'console':
            return `/dashboard/${orgEnvSlug}/actions`;
        case 'anon-console':
            return `/develop/${orgEnvSlug}/actions`;
    }
}
exports.getDashboardPath = getDashboardPath;
function getActionUrl({ base, orgEnvSlug, mode, absolute = false, slug, params, }) {
    const url = new URL(base);
    url.pathname = `${getDashboardPath({ orgEnvSlug, mode })}/${slug}`;
    if (params) {
        for (const [key, val] of Object.entries(params)) {
            if (val) {
                url.searchParams.set(key, val.toString());
            }
        }
    }
    return absolute ? url.toString() : `${url.pathname}${url.search}`;
}
exports.getActionUrl = getActionUrl;
function isBackgroundable(action) {
    return action.metadata?.backgroundable ?? action.backgroundable;
}
exports.isBackgroundable = isBackgroundable;
