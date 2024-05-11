"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.envRootPath = exports.getOrgEnvSlug = exports.legacy_switchToEnvironment = exports.DEVELOPMENT_ORG_DEFAULT_COLOR = exports.DEVELOPMENT_ORG_ENV_NAME = exports.DEVELOPMENT_ORG_ENV_SLUG = exports.PRODUCTION_ORG_ENV_NAME = exports.PRODUCTION_ORG_ENV_SLUG = void 0;
exports.PRODUCTION_ORG_ENV_SLUG = 'production';
exports.PRODUCTION_ORG_ENV_NAME = 'Production';
exports.DEVELOPMENT_ORG_ENV_SLUG = 'development';
exports.DEVELOPMENT_ORG_ENV_NAME = 'Development';
exports.DEVELOPMENT_ORG_DEFAULT_COLOR = 'orange';
const legacy_switchToEnvironment = (orgEnvSlug, slug, options) => {
    let url = location.pathname.replace(`/dashboard/${orgEnvSlug}`, `/dashboard/${slug}`);
    if (options?.showTooltipOnSwitch) {
        url += '?show-env-switcher-tooltip';
    }
    window.location.href = url;
};
exports.legacy_switchToEnvironment = legacy_switchToEnvironment;
function getOrgEnvSlug(envSlug, orgSlug) {
    if (envSlug === exports.DEVELOPMENT_ORG_ENV_SLUG)
        return `${orgSlug}/develop`;
    return envSlug && envSlug !== exports.PRODUCTION_ORG_ENV_SLUG
        ? `${orgSlug}+${envSlug}`
        : orgSlug;
}
exports.getOrgEnvSlug = getOrgEnvSlug;
function envRootPath(path) {
    const parts = path.split('/');
    if (parts[3] === 'develop') {
        return parts.slice(0, 4).join('/');
    }
    else {
        return parts.slice(0, 3).join('/');
    }
}
exports.envRootPath = envRootPath;
