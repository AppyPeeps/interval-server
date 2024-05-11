"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueuedActionParams = void 0;
function getQueuedActionParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params))
        return;
    const record = {};
    for (const [key, val] of Object.entries(params)) {
        if (typeof key === 'string' && (!val || typeof val !== 'object')) {
            record[key] = val;
        }
    }
    return record;
}
exports.getQueuedActionParams = getQueuedActionParams;
