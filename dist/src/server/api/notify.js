"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const internalRpcSchema_1 = require("@interval/sdk/dist/internalRpcSchema");
const auth_1 = require("../auth");
const notify_1 = __importDefault(require("../utils/notify"));
const prisma_1 = __importDefault(require("../prisma"));
const logger_1 = require("../../server/utils/logger");
const router = express_1.default.Router();
router.post('/', async (req, res) => {
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
        inputs = internalRpcSchema_1.NOTIFY.inputs.parse(req.body);
    }
    catch (err) {
        return sendResponse(400, {
            type: 'error',
            message: 'Invalid request body.',
        });
    }
    const organization = await prisma_1.default.organization.findUnique({
        where: {
            id: auth.organization.id,
        },
        include: {
            private: true,
        },
    });
    if (!organization) {
        // This should never happen
        logger_1.logger.error('Notify: Organization not found', {
            organizationId: auth.organization.id,
        });
        return sendResponse(403, {
            type: 'error',
            message: 'Invalid API key provided.',
        });
    }
    let transaction;
    if (inputs.transactionId) {
        const foundTransaction = await prisma_1.default.transaction.findUnique({
            where: {
                id: inputs.transactionId,
            },
            include: {
                hostInstance: {
                    include: { apiKey: true },
                },
                action: {
                    include: { organization: { include: { private: true } } },
                },
                owner: true,
            },
        });
        if (!foundTransaction) {
            logger_1.logger.warn('Notify: Transaction not found for notify call with transactionId', { transactionId: inputs.transactionId });
            return sendResponse(403, {
                type: 'error',
                message: 'Transaction not found.',
            });
        }
        if (foundTransaction.action.organizationId !== auth.organization.id) {
            logger_1.logger.warn('Notify: Transaction does not belong to organization', {
                transactionId: inputs.transactionId,
                organizationId: organization.id,
            });
            return sendResponse(403, {
                type: 'error',
                message: 'Transaction not found.',
            });
        }
        transaction = foundTransaction;
    }
    await (0, notify_1.default)({
        transaction,
        message: inputs.message,
        title: inputs.title,
        environment: auth.apiKey.usageEnvironment,
        organization,
        deliveryInstructions: inputs.deliveryInstructions,
        createdAt: inputs.createdAt,
        idempotencyKey: inputs.idempotencyKey,
    });
    sendResponse(200, {
        type: 'success',
    });
});
exports.default = router;
