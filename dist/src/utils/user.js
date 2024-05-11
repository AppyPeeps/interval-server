"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStartTransactionUser = exports.permissionToCtxUserRole = exports.displayName = void 0;
const permissions_1 = require("../utils/permissions");
function displayName(user) {
    const names = [user.firstName, user.lastName];
    return names.join(' ') || user.email;
}
exports.displayName = displayName;
function permissionToCtxUserRole(p) {
    switch (p) {
        case 'ADMIN':
            return 'admin';
        case 'DEVELOPER':
            return 'developer';
        case 'ACTION_RUNNER':
            return 'member';
        // case 'READONLY_VIEWER':
        //   return 'auditor'
    }
    throw new Error(`Invalid user role permission ${p}`);
}
exports.permissionToCtxUserRole = permissionToCtxUserRole;
function getStartTransactionUser(user) {
    const orgAccess = user.userOrganizationAccess[0];
    if (!orgAccess) {
        throw new Error('No UserOrganizationAccess found');
    }
    const rolePermission = (0, permissions_1.getPrimaryRole)(orgAccess.permissions);
    if (!rolePermission) {
        throw new Error('No user role permission found');
    }
    const role = permissionToCtxUserRole(rolePermission);
    return {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role,
        teams: orgAccess.groupMemberships.map(gm => gm.group.slug),
    };
}
exports.getStartTransactionUser = getStartTransactionUser;
