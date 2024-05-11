"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const internalRpcSchema_1 = require("@interval/sdk/dist/internalRpcSchema");
const deserialize_1 = require("@interval/sdk/dist/utils/deserialize");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../auth");
const queuedActions_1 = require("../../utils/queuedActions");
const logger_1 = require("../../server/utils/logger");
const router = express_1.default.Router();
router.post('/enqueue', async (req, res) => {
    // To ensure correct return type
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
    if (!auth) {
        return sendResponse(403, {
            type: 'error',
            message: 'Invalid API key provided.',
        });
    }
    let inputs;
    try {
        inputs = internalRpcSchema_1.ENQUEUE_ACTION.inputs.parse(req.body);
    }
    catch (err) {
        return sendResponse(400, {
            type: 'error',
            message: 'Invalid request body.',
        });
    }
    const action = await prisma_1.default.action.findFirst({
        where: {
            slug: inputs.slug,
            organizationId: auth.organization.id,
            developerId: auth.apiKey.usageEnvironment === 'DEVELOPMENT' ? auth.user.id : null,
            organizationEnvironmentId: auth.apiKey.organizationEnvironmentId,
        },
    });
    if (!action) {
        return sendResponse(404, {
            type: 'error',
            message: 'Action not found.',
        });
    }
    let assignee;
    if (inputs.assignee) {
        // TODO: Handle other assignment types
        assignee = await prisma_1.default.user.findUnique({
            where: {
                email: inputs.assignee,
            },
        });
        if (!assignee) {
            return sendResponse(404, {
                type: 'error',
                message: 'Assignee not found',
            });
        }
        if (auth.apiKey.usageEnvironment === 'DEVELOPMENT' &&
            assignee.id !== action.developerId) {
            return sendResponse(400, {
                type: 'error',
                message: 'Development actions can only be assigned to the action developer',
            });
        }
    }
    const queuedAction = await prisma_1.default.queuedAction.create({
        data: {
            action: { connect: { id: action.id } },
            params: inputs.params ? (0, deserialize_1.serializeDates)(inputs.params) : undefined,
            paramsMeta: inputs.paramsMeta || undefined,
            assignee: assignee ? { connect: { id: assignee.id } } : undefined,
        },
    });
    sendResponse(200, {
        type: 'success',
        id: queuedAction.id,
    });
});
router.post('/dequeue', async (req, res) => {
    // To ensure correct return type
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
    if (!auth) {
        return sendResponse(403, {
            type: 'error',
            message: 'Invalid API key provided.',
        });
    }
    let inputs;
    try {
        inputs = internalRpcSchema_1.DEQUEUE_ACTION.inputs.parse(req.body);
    }
    catch (err) {
        return sendResponse(400, {
            type: 'error',
            message: 'Invalid request body.',
        });
    }
    const queuedAction = await prisma_1.default.queuedAction.findUnique({
        where: {
            id: inputs.id,
        },
        include: {
            action: true,
            assignee: true,
        },
    });
    if (!queuedAction ||
        queuedAction.action.organizationId !== auth.organization.id) {
        return sendResponse(404, {
            type: 'error',
            message: 'Queued action not found',
        });
    }
    try {
        await prisma_1.default.queuedAction.delete({
            where: {
                id: queuedAction.id,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed deleting queued action', {
            queuedActionId: queuedAction.id,
            error,
        });
        return sendResponse(500, {
            type: 'error',
            message: 'Server error',
        });
    }
    sendResponse(200, {
        type: 'success',
        id: queuedAction.id,
        assignee: queuedAction.assignee?.email,
        params: (0, queuedActions_1.getQueuedActionParams)(queuedAction.params),
        paramsMeta: queuedAction.paramsMeta,
    });
});
exports.default = router;
