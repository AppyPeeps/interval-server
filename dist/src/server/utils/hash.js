"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shaHash = void 0;
const node_crypto_1 = require("node:crypto");
/**
 * Should go without saying, but don't use this for anything security related.
 */
function shaHash(input, encoding = 'hex') {
    return (0, node_crypto_1.createHash)('sha256').update(input).digest(encoding);
}
exports.shaHash = shaHash;
