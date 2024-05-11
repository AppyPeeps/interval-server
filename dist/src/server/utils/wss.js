"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeApiCall = void 0;
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const env_1 = __importDefault(require("../../env"));
const auth_1 = require("../auth");
const consts_1 = require("../../wss/consts");
async function makeApiCall(path, body) {
    // TODO: Use correct URL if not on same server
    const url = new URL('http://localhost');
    url.port = consts_1.port.toString();
    url.pathname = path;
    return (0, cross_fetch_1.default)(`${url.toString()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(0, auth_1.encryptPassword)(env_1.default.WSS_API_SECRET)}`,
        },
        body,
    }).then(response => {
        if (!response.ok) {
            // TODO: Make this better
            throw new Error(response.status.toString());
        }
        return response;
    });
}
exports.makeApiCall = makeApiCall;
