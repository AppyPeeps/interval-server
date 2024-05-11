"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = __importDefault(require("../../../../env"));
const _1 = require(".");
const logger_1 = require("../../../../server/utils/logger");
async function auth(req, res) {
    if (!_1.isWorkOSEnabled || !_1.workos || !env_1.default.WORKOS_CLIENT_ID) {
        logger_1.logger.error('WorkOS credentials not found, aborting', {
            path: req.path,
        });
        return res.sendStatus(501);
    }
    const { workosOrganizationId, transactionId } = req.query;
    if (!workosOrganizationId || typeof workosOrganizationId !== 'string') {
        res.status(400).end();
        return;
    }
    const authorizationURL = _1.workos.sso.getAuthorizationURL({
        redirectURI: _1.REDIRECT_URI,
        clientID: env_1.default.WORKOS_CLIENT_ID,
        organization: workosOrganizationId,
        state: transactionId
            ? JSON.stringify({ transactionId: String(transactionId) })
            : undefined,
    });
    res.redirect(authorizationURL);
    return;
}
exports.default = auth;
