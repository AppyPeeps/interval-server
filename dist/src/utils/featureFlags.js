"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFeatureFlagEnabled = exports.isFeatureFlagEnabledForOrganization = exports.isGlobalFeatureFlagEnabled = exports.UX_FEATURE_FLAGS = exports.FEATURE_FLAG_DEFAULTS = void 0;
exports.FEATURE_FLAG_DEFAULTS = {
    // Global behavior flags
    GHOST_MODE_ENABLED: false,
    USER_REGISTRATION_ENABLED: true,
    // User experience flags, can be enabled globally as well
    TRANSACTION_LEGACY_NO_APPEND_UI: false,
    ACTION_METADATA_GENERAL_CONFIG: false,
    TABLE_TRUNCATION_DISABLED: false,
};
/**
 * Affects individual/organization user experience, can be toggled independently.
 */
exports.UX_FEATURE_FLAGS = [
    'TRANSACTION_LEGACY_NO_APPEND_UI',
    'ACTION_METADATA_GENERAL_CONFIG',
    'TABLE_TRUNCATION_DISABLED',
];
function isGlobalFeatureFlagEnabled(flag, globalFlags) {
    return globalFlags.find(f => f.flag === flag)?.enabled;
}
exports.isGlobalFeatureFlagEnabled = isGlobalFeatureFlagEnabled;
function isFeatureFlagEnabledForOrganization(flag, 
// Only specifying the min required type since this function is isomorphic
organization) {
    return organization.featureFlags.find(f => f.flag === flag)?.enabled;
}
exports.isFeatureFlagEnabledForOrganization = isFeatureFlagEnabledForOrganization;
function isFeatureFlagEnabled(flag, { globalFeatureFlags, organization, }) {
    const globalFlagEnabled = globalFeatureFlags
        ? isGlobalFeatureFlagEnabled(flag, globalFeatureFlags)
        : undefined;
    const orgFlagEnabled = organization
        ? isFeatureFlagEnabledForOrganization(flag, organization)
        : undefined;
    if (globalFlagEnabled) {
        return globalFlagEnabled;
    }
    if (orgFlagEnabled) {
        return orgFlagEnabled;
    }
    return exports.FEATURE_FLAG_DEFAULTS[flag] ?? false;
}
exports.isFeatureFlagEnabled = isFeatureFlagEnabled;
