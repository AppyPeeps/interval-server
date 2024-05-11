"use strict";
/**
 * Database-level UserAccessPermissions are the base-level permissions that
 * are actually written to UserOrganizationAccess.
 *
 * Any "higher-level" role-like permissions which are made of a composition of
 * base UserAccessPermissions can be defined in UserAccessPermission, which must be
 * reduced to their base levels before being written to the database.
 *
 * This will allow us to to extract more finely-grained permissions from
 * existing permissions in a backward-compatible way, and allow us to provide
 * role-like shorthands for common groups of permissions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = exports.reducePermissions = exports.getPrimaryRole = exports.reducePermission = exports.SDK_PERMISSIONS_MIN_VERSION = exports.EXPOSED_ROLES = void 0;
const client_1 = require("@prisma/client");
/**
 * Any role-like permissions that imply others should be defined here.
 */
const ROLE_PERMISSIONS = {
    ...client_1.UserAccessPermission,
    ADMIN: [
        'RUN_DEV_ACTIONS',
        'RUN_PROD_ACTIONS',
        'READ_DEV_ACTIONS',
        'READ_PROD_ACTIONS',
        'WRITE_PROD_ACTIONS',
        'DEQUEUE_PROD_ACTIONS',
        'READ_DEV_TRANSACTIONS',
        'READ_PROD_TRANSACTIONS',
        'READ_ORG_PROD_TRANSACTIONS',
        'READ_USERS',
        'WRITE_USERS',
        'CREATE_DEV_API_KEYS',
        'CREATE_PROD_API_KEYS',
        'READ_ORG_USER_API_KEY_EXISTENCE',
        'DELETE_ORG_USER_API_KEYS',
        'WRITE_ORG_SETTINGS',
        'WRITE_ORG_OAUTH',
        'ACCESS_ORG_ENVIRONMENTS',
    ],
    DEVELOPER: [
        'READ_PROD_ACTIONS',
        'RUN_PROD_ACTIONS',
        'READ_PROD_TRANSACTIONS',
        'READ_DEV_ACTIONS',
        'RUN_DEV_ACTIONS',
        'READ_DEV_TRANSACTIONS',
        'CREATE_DEV_API_KEYS',
        'ACCESS_ORG_ENVIRONMENTS',
    ],
    ACTION_RUNNER: [
        'READ_PROD_ACTIONS',
        'RUN_PROD_ACTIONS',
        'READ_PROD_TRANSACTIONS',
        'ACCESS_ORG_ENVIRONMENTS',
    ],
    READONLY_VIEWER: [
        'READ_DEV_ACTIONS',
        'READ_PROD_ACTIONS',
        'READ_DEV_TRANSACTIONS',
        'READ_PROD_TRANSACTIONS',
        'READ_USERS',
        'READ_ORG_USER_API_KEY_EXISTENCE',
        'ACCESS_ORG_ENVIRONMENTS',
    ],
};
/**
 * These permissions/roles are available in the user interface to assign to users.
 */
exports.EXPOSED_ROLES = [
    'ADMIN',
    'DEVELOPER',
    'ACTION_RUNNER',
];
exports.SDK_PERMISSIONS_MIN_VERSION = '0.34.0';
function reducePermission(permission) {
    return ROLE_PERMISSIONS[permission];
}
exports.reducePermission = reducePermission;
function getPrimaryRole(permissions) {
    const primaryPermission = exports.EXPOSED_ROLES.find(role => permissions.includes(role));
    return primaryPermission;
}
exports.getPrimaryRole = getPrimaryRole;
function reducePermissions(permissions) {
    const perms = permissions.flatMap(p => {
        const reduced = reducePermission(p);
        if (Array.isArray(reduced)) {
            return Array.from(reducePermissions(reduced).values());
        }
        return reduced;
    });
    return new Set(perms);
}
exports.reducePermissions = reducePermissions;
function containsPermission(permissions, permission) {
    const reduced = reducePermissions(permissions);
    return reduced.has(permission);
}
function hasPermission(access, permission) {
    if (!access)
        return false;
    return containsPermission(access.permissions, permission);
}
exports.hasPermission = hasPermission;
