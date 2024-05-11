"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const internalRpcSchema_1 = require("@interval/sdk/dist/internalRpcSchema");
const auth_1 = require("../auth");
const prisma_1 = __importDefault(require("../prisma"));
const actions_1 = require("../utils/actions");
const validate_1 = require("../../utils/validate");
const sdkAlerts_1 = require("../utils/sdkAlerts");
const logger_1 = require("../../server/utils/logger");
const router = express_1.default.Router();
router.post('/declare', async (req, res) => {
    function sendResponse(statusCode, returns) {
        res.status(statusCode).send(returns);
    }
    const apiKey = req.headers.authorization?.split(' ')[1];
    if (!apiKey) {
        return sendResponse(401, {
            type: 'error',
            message: 'No API key provided.',
        });
    }
    const auth = await (0, auth_1.loginWithApiKey)(apiKey);
    // Only production actions supported for HTTP Hosts
    if (!auth || auth.apiKey.usageEnvironment !== 'PRODUCTION') {
        return sendResponse(403, {
            type: 'error',
            message: 'Invalid API key provided.',
        });
    }
    let inputs;
    try {
        inputs = internalRpcSchema_1.DECLARE_HOST.inputs.parse(req.body);
    }
    catch (err) {
        return sendResponse(400, {
            type: 'error',
            message: 'Invalid request body.',
        });
    }
    const { httpHostId, actions, groups, sdkName, sdkVersion } = inputs;
    let httpHost = await prisma_1.default.httpHost.findUnique({
        where: {
            id: httpHostId,
        },
        include: {
            actions: true,
            actionGroups: true,
        },
    });
    if (!httpHost || httpHost.organizationId !== auth.organization.id) {
        return sendResponse(404, {
            type: 'error',
            message: 'Host not found.',
        });
    }
    httpHost = await prisma_1.default.httpHost.update({
        where: {
            id: httpHost.id,
        },
        data: {
            sdkName,
            sdkVersion,
            lastConnectedAt: new Date(),
            // Disconnect existing actions, will reconnect in initializeActions below
            actions: {
                disconnect: httpHost.actions.map(action => ({ id: action.id })),
            },
            actionGroups: {
                disconnect: httpHost.actionGroups.map(group => ({ id: group.id })),
            },
        },
        include: {
            actions: true,
            actionGroups: true,
        },
    });
    const slugs = actions.map(({ slug }) => slug);
    const invalidSlugs = slugs.filter(slug => !(0, validate_1.isSlugValid)(slug));
    (0, actions_1.initializeActions)({
        hostInstance: null,
        httpHost,
        actions,
        groups,
        developerId: null,
        organizationEnvironmentId: auth.apiKey.organizationEnvironmentId,
        sdkVersion,
        sdkName,
    }).catch(error => {
        logger_1.logger.error('Failed initializing actions', {
            organizationEnvironmentId: auth?.apiKey?.organizationEnvironmentId,
            organizationId: auth?.organization?.id,
            userId: auth?.user?.id,
            error,
        });
    });
    const sdkAlert = await (0, sdkAlerts_1.getSdkAlert)(sdkName, sdkVersion);
    const warnings = [];
    const permissionsWarning = await (0, actions_1.getPermissionsWarning)({
        actions,
        groups,
        organizationId: auth.apiKey.organizationId,
    });
    if (permissionsWarning)
        warnings.push(permissionsWarning);
    sendResponse(200, {
        type: 'success',
        invalidSlugs,
        sdkAlert,
        warnings,
    });
});
exports.default = router;
