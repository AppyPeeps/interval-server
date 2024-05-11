"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelClosedTransactions = exports.getActionEnvironment = exports.cancelTransaction = exports.freeTransactionCalls = exports.startTransaction = void 0;
const ioSchema_1 = require("@interval/sdk/dist/ioSchema");
const superjson_1 = __importDefault(require("../utils/superjson"));
const prisma_1 = __importDefault(require("../server/prisma"));
const featureFlags_1 = require("../server/utils/featureFlags");
const environments_1 = require("../utils/environments");
const user_1 = require("../utils/user");
const actions_1 = require("../utils/actions");
const processVars_1 = require("./processVars");
const logger_1 = require("../server/utils/logger");
const env_1 = __importDefault(require("../env"));
async function startTransaction(transaction, runner, { params = {}, paramsMeta, } = {}) {
    if (!transaction.hostInstanceId) {
        throw new Error(`WSS startTransaction: No hostInstanceId found for transaction ${transaction.id}`);
    }
    const host = processVars_1.connectedHosts.get(transaction.hostInstanceId);
    if (!host) {
        throw new Error(`WSS startTransaction: hostInstance.id not found in connectedHosts ${transaction.hostInstanceId}`);
    }
    const shouldUseAppendUi = !!host.sdkVersion &&
        host.sdkVersion >= '0.38.0' &&
        !(await (0, featureFlags_1.isFlagEnabled)('TRANSACTION_LEGACY_NO_APPEND_UI', transaction.action.organizationId));
    const mode = transaction.action.developerId
        ? host.organization.isGhostMode
            ? 'anon-console'
            : 'console'
        : 'live';
    const envSlug = mode === 'live' ? host.organizationEnvironment?.slug ?? null : null;
    const orgEnvSlug = (0, environments_1.getOrgEnvSlug)(envSlug, host.organization.slug);
    let deserializedParams = params;
    try {
        deserializedParams = superjson_1.default.deserialize({
            json: params,
            meta: paramsMeta,
        });
    }
    catch (error) {
        logger_1.logger.error('Error from SuperJSON deserialization', {
            error,
            meta: paramsMeta,
        });
    }
    return host.rpc.send('START_TRANSACTION', {
        transactionId: transaction.id,
        displayResolvesImmediately: shouldUseAppendUi,
        actionName: transaction.action.slug,
        action: {
            slug: transaction.action.slug,
            url: (0, actions_1.getActionUrl)({
                base: env_1.default.APP_URL,
                orgEnvSlug,
                mode,
                slug: transaction.action.slug,
                absolute: true,
                params: deserializedParams,
            }),
        },
        environment: getActionEnvironment(host),
        user: (0, user_1.getStartTransactionUser)(runner),
        params,
        paramsMeta,
    });
}
exports.startTransaction = startTransaction;
function freeTransactionCalls(transaction) {
    processVars_1.transactionLoadingStates.delete(transaction.id);
    processVars_1.transactionRedirects.delete(transaction.id);
    processVars_1.pendingIOCalls.delete(transaction.id);
}
exports.freeTransactionCalls = freeTransactionCalls;
async function cancelTransaction(transaction) {
    if (!transaction.hostInstanceId) {
        throw new Error(`WSS cancelTransaction: No hostInstanceId found for transaction ${transaction.id}`);
    }
    const host = processVars_1.connectedHosts.get(transaction.hostInstanceId);
    prisma_1.default.transaction
        .update({
        where: {
            id: transaction.id,
        },
        data: {
            status: 'COMPLETED',
            resultStatus: 'CANCELED',
        },
    })
        .then(() => {
        // Just here to make sure this fires because these are lazy
    })
        .catch(error => {
        logger_1.logger.error('Failed setting transaction status to canceled', {
            transactionId: transaction.id,
            error,
        });
    });
    if (!host) {
        logger_1.logger.error('cancelTransaction: hostInstance.id not found in connectedHosts', {
            transactionId: transaction.id,
            hostInstanceId: transaction.hostInstanceId,
        });
        return;
    }
    let id = 'UNKNOWN';
    let inputGroupKey = 'UNKNOWN';
    const lastIOCall = processVars_1.pendingIOCalls.get(transaction.id);
    if (lastIOCall) {
        try {
            const parsedCall = ioSchema_1.IO_RENDER.parse(JSON.parse(lastIOCall));
            id = parsedCall.id;
            inputGroupKey = parsedCall.inputGroupKey;
        }
        catch (error) {
            logger_1.logger.error('Invalid transaction lastIOCall', { error });
        }
    }
    freeTransactionCalls(transaction);
    if (id === 'UNKNOWN') {
        logger_1.logger.error('No valid IO call ID found for transaction ID', {
            transactionId: transaction.id,
        });
    }
    const response = {
        id,
        inputGroupKey,
        transactionId: transaction.id,
        kind: 'CANCELED',
        values: [],
    };
    return host.rpc
        .send('IO_RESPONSE', {
        transactionId: transaction.id,
        value: JSON.stringify(response),
    })
        .catch(error => {
        logger_1.logger.error('Failed cancelling transaction', {
            error,
            transactionId: transaction.id,
        });
    });
}
exports.cancelTransaction = cancelTransaction;
function getActionEnvironment(host) {
    if (host.sdkVersion && host.sdkVersion >= '0.38.1') {
        return host.organizationEnvironment?.slug ?? environments_1.PRODUCTION_ORG_ENV_SLUG;
    }
    switch (host.usageEnvironment) {
        case 'PRODUCTION':
            return 'live';
        case 'DEVELOPMENT':
            return 'development';
    }
}
exports.getActionEnvironment = getActionEnvironment;
/**
 * When the client disconnects from a non-backgroundable transaction
 * its status is set to CLIENT_CONNECTION_DROPPED. After maintaining this
 * state for a period of time without being updated, we will notify the action
 * host and clean up the transaction by marking it as finally canceled.
 *
 * We do this in phases like this instead of immediately cancel in order to
 * avoid race conditions when a client disconnects immediately after completing
 * the transaction, and also to handle clients that may briefly lose connection.
 */
async function cancelClosedTransactions() {
    try {
        const tenMinutesAgo = new Date();
        tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);
        const transactions = await prisma_1.default.transaction.findMany({
            where: {
                status: 'CLIENT_CONNECTION_DROPPED',
                updatedAt: {
                    lt: tenMinutesAgo,
                },
            },
            include: {
                action: true,
            },
        });
        if (transactions.length > 0) {
            await prisma_1.default.transaction.updateMany({
                where: {
                    id: {
                        in: transactions.map(t => t.id),
                    },
                    resultStatus: null,
                },
                data: {
                    resultStatus: 'CANCELED',
                },
            });
            await prisma_1.default.transaction.updateMany({
                where: {
                    id: {
                        in: transactions.map(t => t.id),
                    },
                },
                data: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                },
            });
            await Promise.all(transactions.map(t => cancelTransaction(t)));
        }
    }
    catch (error) {
        logger_1.logger.error('Failed cancelling closed transactions', { error });
    }
}
exports.cancelClosedTransactions = cancelClosedTransactions;
