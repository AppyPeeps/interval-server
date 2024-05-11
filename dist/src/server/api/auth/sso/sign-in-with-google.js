"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = __importDefault(require("../../../../env"));
const _1 = require(".");
const logger_1 = require("../../../../server/utils/logger");
async function signInWithGoogle(req, res) {
    if (!env_1.default.WORKOS_CLIENT_ID || !_1.workos || !_1.isWorkOSEnabled) {
        logger_1.logger.error('WorkOS credentials not found, aborting', {
            path: req.path,
        });
        return res.sendStatus(501);
    }
    const { token, plan, transactionId } = req.query;
    const state = {};
    if (token) {
        state['invitationId'] = String(token);
    }
    if (plan) {
        state['plan'] = String(plan);
    }
    if (transactionId) {
        state['transactionId'] = String(transactionId);
    }
    const authorizationURL = _1.workos.sso.getAuthorizationURL({
        redirectURI: _1.REDIRECT_URI,
        clientID: env_1.default.WORKOS_CLIENT_ID,
        provider: 'GoogleOAuth',
        state: Object.keys(state).length > 0 ? JSON.stringify(state) : undefined,
    });
    res.redirect(authorizationURL);
    return;
}
exports.default = signInWithGoogle;
