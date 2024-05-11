"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseActionResult = void 0;
/**
 * Parses the JSON result of a transaction into a more structured format.
 */
function parseActionResult(res) {
    if (!res) {
        return {
            schemaVersion: 0,
            status: 'SUCCESS',
            data: null,
            meta: null,
        };
    }
    return JSON.parse(res);
}
exports.parseActionResult = parseActionResult;
