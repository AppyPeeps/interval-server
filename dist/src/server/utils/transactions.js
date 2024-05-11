"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelTransaction = exports.startTransaction = exports.getDashboardUrl = exports.getCurrentHostInstance = void 0;
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const prisma_1 = __importDefault(require("../../server/prisma"));
const sleep_1 = __importDefault(require("./sleep"));
const actions_1 = require("../../utils/actions");
const env_1 = __importDefault(require("../../env"));
const logger_1 = require("../../server/utils/logger");
const wss_1 = require("./wss");
async function getCurrentHostInstance(actionOrGroup) {
    const hostInstance = actionOrGroup.hostInstances.find(hi => hi.status === 'ONLINE');
    if (hostInstance)
        return hostInstance;
    // Try "ONLINE" HTTP hosts first
    let httpHost = actionOrGroup.httpHosts.find(hh => hh.status === 'ONLINE');
    if (!httpHost) {
        // Fall back to "UNREACHABLE" hosts if none found
        httpHost = actionOrGroup.httpHosts.find(hh => hh.status === 'UNREACHABLE');
    }
    if (httpHost) {
        try {
            let timedOut = false;
            const httpInitializationTimeoutMs = 60_000;
            let timeoutTimeout = setTimeout(() => {
                timedOut = true;
            }, httpInitializationTimeoutMs);
            const httpHostRequest = await prisma_1.default.httpHostRequest.create({
                data: {
                    httpHostId: httpHost.id,
                    actionId: 'backgroundable' in actionOrGroup ? actionOrGroup.id : null,
                    actionGroupId: 'hasHandler' in actionOrGroup ? actionOrGroup.id : null,
                },
            });
            (0, cross_fetch_1.default)(httpHost.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requestId: httpHostRequest.id,
                }),
            })
                .then(async (response) => {
                if (!response.ok)
                    throw new Error(`Received ${response.status} from initialization request`);
            })
                .catch(error => {
                logger_1.logger.error('Error receiving HTTP response from request host', {
                    httpHostRequestId: httpHostRequest.id,
                    url: httpHost?.url,
                    error,
                });
            });
            // Poll for HostInstance connection
            while (!timedOut) {
                const hostInstance = await prisma_1.default.hostInstance.findFirst({
                    where: {
                        httpHostRequest: {
                            id: httpHostRequest.id,
                        },
                    },
                });
                if (hostInstance) {
                    clearTimeout(timeoutTimeout);
                    timeoutTimeout = null;
                    return hostInstance;
                }
                await (0, sleep_1.default)(500);
            }
            // Did not respond within timeout
            await prisma_1.default.httpHostRequest.update({
                where: {
                    id: httpHostRequest.id,
                },
                data: {
                    invalidAt: new Date(),
                },
            });
        }
        catch (error) {
            logger_1.logger.error('Failed initializing HTTP Host', {
                httpHostId: httpHost.id,
                error,
            });
            throw error;
        }
    }
    throw new Error(`HostInstance and HttpHostInstance both undefined for action or group with ID ${actionOrGroup.id}`);
}
exports.getCurrentHostInstance = getCurrentHostInstance;
function getDashboardUrl({ orgSlug, envSlug, environment, }) {
    const mode = (0, actions_1.usageEnvironmentToMode)(environment);
    const path = (0, actions_1.getDashboardPath)({
        envSlug,
        orgSlug,
        mode,
    });
    return `${env_1.default.APP_URL}${path}`;
}
exports.getDashboardUrl = getDashboardUrl;
async function startTransaction(transaction, runner, { clientId, params = {}, paramsMeta, } = {}) {
    return (0, wss_1.makeApiCall)('/api/transactions/start', JSON.stringify({
        transactionId: transaction.id,
        runnerId: runner.id,
        clientId,
        params,
        paramsMeta,
    }));
}
exports.startTransaction = startTransaction;
async function cancelTransaction(transaction) {
    return (0, wss_1.makeApiCall)('/api/transactions/cancel', JSON.stringify({
        transactionId: transaction.id,
    }));
}
exports.cancelTransaction = cancelTransaction;
