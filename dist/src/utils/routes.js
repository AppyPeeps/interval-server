"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardL0Paths = exports.getDashboardL1Paths = void 0;
function cleanPath(path) {
    return path
        .replace(/src|.?\/pages|index|\.(tsx|mdx)$/g, '')
        .replace(/\[\.{3}.+\]/, '*')
        .replace(/\[([A-Za-z_]+)\]/g, ':$1');
}
function getDashboardL1Paths(paths) {
    return new Set(paths
        .map(route => {
        const path = cleanPath(route)
            .replace('/dashboard/:orgSlug/', '')
            .split('/')[0];
        return path;
    })
        .filter(Boolean));
}
exports.getDashboardL1Paths = getDashboardL1Paths;
function getDashboardL0Paths(paths) {
    return new Set(paths
        .filter(path => !path.includes('[orgSlug]'))
        .map(route => {
        const path = cleanPath(route).replace('/dashboard/', '').split('/')[0];
        return path;
    })
        .filter(Boolean));
}
exports.getDashboardL0Paths = getDashboardL0Paths;
