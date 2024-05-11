"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.numberWithCommas = exports.commaSeparatedList = exports.featureFlagToString = exports.slugToName = exports.actionAccessLevelToString = exports.actionAvailabilityToString = exports.userAccessPermissionToString = exports.usageEnvironmentToString = exports.statusEnumToString = exports.hostStatusToString = exports.pluralizeWithCount = exports.pluralize = exports.ucfirst = void 0;
function ucfirst(s) {
    return s.charAt(0).toUpperCase() + s.substring(1);
}
exports.ucfirst = ucfirst;
function pluralize(num, singular, plural) {
    if (!plural) {
        plural = `${singular}s`;
    }
    return num === 1 ? singular : plural;
}
exports.pluralize = pluralize;
function pluralizeWithCount(num, singular, plural, options) {
    const x = options?.commas ? numberWithCommas(num) : num;
    return `${x} ${pluralize(num, singular, plural)}`;
}
exports.pluralizeWithCount = pluralizeWithCount;
function enumToString(val) {
    const str = val.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    return str[0].toUpperCase() + str.slice(1);
}
function hostStatusToString(status) {
    return enumToString(status);
}
exports.hostStatusToString = hostStatusToString;
function statusEnumToString(status) {
    switch (status) {
        case 'HOST_CONNECTION_DROPPED':
            return 'Connection lost';
        case 'CLIENT_CONNECTION_DROPPED':
            return 'Closed';
        case 'FAILURE':
            return 'Error';
        case 'SUCCESS':
            return 'Completed';
        default:
            return enumToString(status);
    }
}
exports.statusEnumToString = statusEnumToString;
function usageEnvironmentToString(env) {
    return env.charAt(0) + env.substring(1).toLowerCase();
}
exports.usageEnvironmentToString = usageEnvironmentToString;
function userAccessPermissionToString(perm) {
    switch (perm) {
        case 'ACTION_RUNNER':
            return 'Member';
        case 'READONLY_VIEWER':
            return 'Auditor';
        default:
            return enumToString(perm).replace('api', 'API');
    }
}
exports.userAccessPermissionToString = userAccessPermissionToString;
function actionAvailabilityToString(availability) {
    switch (availability) {
        case 'GROUPS':
            return 'Teams';
        default:
            return enumToString(availability);
    }
}
exports.actionAvailabilityToString = actionAvailabilityToString;
function actionAccessLevelToString(level) {
    return enumToString(level);
}
exports.actionAccessLevelToString = actionAccessLevelToString;
function slugToName(slug) {
    if (slug.includes('/')) {
        slug = slug.substring(slug.lastIndexOf('/') + 1);
    }
    if (slug === slug.toUpperCase()) {
        slug = slug.toLowerCase();
    }
    // Don't split on multiple caps in a row like URL
    const matches = slug.match(/[A-Z][A-Z]+/g);
    if (matches && matches.length) {
        for (const match of matches) {
            const toReplace = match.substring(0, match.length - 1);
            slug = slug.replace(toReplace, ` ${toReplace.toLowerCase()} `);
        }
    }
    return ucfirst(slug
        .replace(/[-_.]+/g, ' ')
        // Split on camelCase and whitespace
        .split(/((?!^)(?=[A-Z]))|\s+/g)
        .filter(Boolean)
        .map(s => s.trim())
        .filter(s => s.length)
        .map(s => s.toLowerCase())
        .join(' '));
}
exports.slugToName = slugToName;
function featureFlagToString(flag) {
    return enumToString(flag);
}
exports.featureFlagToString = featureFlagToString;
function commaSeparatedList(items, conjunction = 'or') {
    if (!items.length)
        return '';
    if (items.length === 1) {
        return items[0];
    }
    if (items.length === 2) {
        return `${items[0]} ${conjunction} ${items[1]}`;
    }
    return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}
exports.commaSeparatedList = commaSeparatedList;
function numberWithCommas(num) {
    return num.toLocaleString('en-US');
}
exports.numberWithCommas = numberWithCommas;
