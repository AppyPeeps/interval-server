"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCollisionSafeSlug = exports.generateSlug = void 0;
const logger_1 = require("../../server/utils/logger");
function generateSlug(desiredSlug) {
    const slug = desiredSlug
        .toLowerCase()
        .trim()
        // replace " -- " with "--"
        .replace(/\s(-+)\s/g, str => str.trim())
        // strip quotes
        .replace(/['"]/g, '')
        // replace non-word characters with -
        .replace(/[^-_.a-zA-Z\d]+/g, '-');
    // Strip leading and trailing -
    const startMatch = slug.match(/-*((([^-]+)-+)*([^-]+))-*/);
    if (startMatch) {
        return startMatch[1];
    }
    else {
        logger_1.logger.warn('Failed to strip leading and trailing hyphens from slug', {
            slug,
        });
    }
    return slug;
}
exports.generateSlug = generateSlug;
function getCollisionSafeSlug(desiredSlug, existing) {
    const existingSlugs = new Set(existing);
    if (existingSlugs.size === 0 || !existingSlugs.has(desiredSlug)) {
        return desiredSlug;
    }
    let i = existingSlugs.size;
    let slug = `${desiredSlug}-${i}`;
    while (existingSlugs.has(slug)) {
        i++;
        slug = `${desiredSlug}-${i}`;
    }
    return slug;
}
exports.getCollisionSafeSlug = getCollisionSafeSlug;
