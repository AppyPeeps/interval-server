"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocketServer = void 0;
const prisma_1 = __importDefault(require("../server/prisma"));
const request_ip_1 = require("request-ip");
const ISocket_1 = __importDefault(require("@interval/sdk/dist/classes/ISocket"));
const DuplexRPCClient_1 = require("@interval/sdk/dist/classes/DuplexRPCClient");
const internalRpcSchema_1 = require("@interval/sdk/dist/internalRpcSchema");
const client_1 = require("@prisma/client");
const notify_1 = require("../utils/notify");
// I don't think this is true anymore ⬇
// Imports must be relative and not use aliases for server code
const isomorphicConsts_1 = require("../utils/isomorphicConsts");
const auth_1 = require("../server/auth");
const env_1 = __importDefault(require("../env"));
const actions_1 = require("../utils/actions");
const queuedActions_1 = require("../utils/queuedActions");
const parseActionResult_1 = require("../utils/parseActionResult");
const actions_2 = require("../utils/actions");
const validate_1 = require("../utils/validate");
const logger_1 = require("../server/utils/logger");
const transactions_1 = require("./transactions");
const transactions_2 = require("../server/utils/transactions");
const user_1 = require("../utils/user");
const notify_2 = __importDefault(require("../server/utils/notify"));
const hash_1 = require("../server/utils/hash");
const ghost_1 = require("../server/api/auth/ghost");
const hosts_1 = require("../server/utils/hosts");
const featureFlags_1 = require("../server/utils/featureFlags");
const sdkAlerts_1 = require("../server/utils/sdkAlerts");
const actionSchedule_1 = require("./actionSchedule");
const uploads_1 = require("../server/utils/uploads");
const actions_3 = require("../server/utils/actions");
const sleep_1 = __importDefault(require("../server/utils/sleep"));
const processVars_1 = require("./processVars");
const environments_1 = require("../utils/environments");
const RATE_LIMIT_HISTORY_SIZE = 10;
const RATE_LIMIT_HISTORY_THRESHOLD_LIMIT = 5;
const RATE_LIMIT_MAX_MESSAGES_PER_SECOND = 1024;
const RATE_LIMIT_ALERT_THRESHOLD = 256;
const RATE_LIMIT_CLIENT_MAX_MESSAGES_PER_SECOND = 50;
const RATE_LIMIT_CLIENT_ALERT_THRESHOLD = 25;
const RECENTLY_OPENED_LIVE_PAGES_INTERVAL_MS = 500;
/* A copy of the state enum in ws to avoid an unnecessary import */
var WebSocketState;
(function (WebSocketState) {
    WebSocketState[WebSocketState["CONNECTING"] = 0] = "CONNECTING";
    WebSocketState[WebSocketState["OPEN"] = 1] = "OPEN";
    WebSocketState[WebSocketState["CLOSING"] = 2] = "CLOSING";
    WebSocketState[WebSocketState["CLOSED"] = 3] = "CLOSED";
})(WebSocketState || (WebSocketState = {}));
function setupWebSocketServer(wss) {
    wss.on('listening', () => {
        // Schedule all existing scheduled actions
        (0, actionSchedule_1.scheduleAllExisting)();
    });
    // Check for unreachable hosts on startup and again every minute
    checkForUnreachableHosts();
    setInterval(checkForUnreachableHosts, 60_000);
    // Check for exited transactions to cancel on startup and again every 5 minutes
    (0, transactions_1.cancelClosedTransactions)();
    setInterval(transactions_1.cancelClosedTransactions, 300_000);
    // Check all HTTP host endpoints on startup
    (0, hosts_1.checkHttpHosts)();
    // Check unreachable HTTP host endpoints every 30s
    setInterval(hosts_1.checkUnreachableHttpHosts, 30_000);
    // Check other (not unreachable) HTTP host endpoints every 5 minutes
    setInterval(hosts_1.checkNotUnreachableHttpHosts, 300_000);
    let shuttingDown = false;
    function closeAllConnections() {
        shuttingDown = true;
        logger_1.logger.info('Beginning shutdown');
        wss.on('close', () => {
            logger_1.logger.info('Shutdown complete');
            process.exit(0);
        });
        for (const host of processVars_1.connectedHosts.values()) {
            host.ws.close(1012, 'Closing briefly for scheduled server restart.');
        }
        for (const client of processVars_1.connectedClients.values()) {
            client.ws.close(1012, 'Closing briefly for scheduled server restart.');
        }
        wss.close(error => {
            if (error) {
                logger_1.logger.error('Error closing WebSocket server', {
                    error,
                });
                process.exit(1);
            }
            else {
                process.exit(0);
            }
        });
        setTimeout(() => {
            logger_1.logger.info('WebSocket server did not close fast enough, exiting process');
            process.exit(1);
        }, 1000);
    }
    process.on('SIGINT', closeAllConnections);
    process.on('SIGTERM', closeAllConnections);
    // Clean up connected host statuses on shutdown
    process.on('exit', async () => {
        const connectedHostIds = Array.from(processVars_1.connectedHosts.keys());
        try {
            // Mark all host instances connected to this server as offline
            await prisma_1.default.hostInstance.updateMany({
                where: {
                    id: { in: connectedHostIds },
                },
                data: { status: 'OFFLINE' },
            });
        }
        catch (error) {
            logger_1.logger.error('Failed marking host instances as offline on shutdown', {
                error,
            });
        }
    });
    function getCookies(targetName, cookies) {
        const parsed = cookies.split(';').map(v => v.trim().split('='));
        const targetCookies = [];
        for (const [name, val] of parsed) {
            if (name === targetName) {
                targetCookies.push(val);
            }
        }
        return targetCookies;
    }
    function getHeaderValue(header) {
        if (typeof header !== 'string')
            return;
        return header;
    }
    async function loginWithCookie(cookie) {
        const session = await (0, auth_1.unsealSessionCookie)(cookie);
        if (!session?.session?.id)
            return null;
        try {
            const { user } = await (0, auth_1.validateSession)(session.session.id);
            const organization = session.currentOrganizationId
                ? (await prisma_1.default.organization
                    .findUnique({
                    where: {
                        id: session.currentOrganizationId,
                    },
                })
                    .catch(() => undefined)) ?? undefined
                : undefined;
            return { user, organization };
        }
        catch (error) {
            logger_1.logger.info('Invalid session', { error });
            return null;
        }
    }
    function getRequestURL(urlStr, host) {
        if (host && urlStr) {
            return new URL(urlStr, `ws://${host}`);
        }
    }
    wss.on('connection', async (rawSocket, req) => {
        if (shuttingDown) {
            rawSocket.close(1012, 'Closing briefly for scheduled server restart.');
            return;
        }
        const serverInstanceId = getHeaderValue(req.headers['x-instance-id']);
        const apiKey = getHeaderValue(req.headers['x-api-key']);
        const ghostOrgId = getHeaderValue(req.headers['x-ghost-org-id']);
        const url = getRequestURL(req.url, req.headers.host);
        const clientId = url?.searchParams?.get(isomorphicConsts_1.CLIENT_ISOCKET_ID_SEARCH_PARAM_KEY);
        const instanceId = serverInstanceId ?? clientId ?? undefined;
        logger_1.logger.verbose('New websocket connection request', {
            ipAddress: (0, request_ip_1.getClientIp)(req),
            instanceId,
        });
        if (instanceId) {
            const existingHost = processVars_1.connectedHosts.get(instanceId);
            if (existingHost) {
                logger_1.logger.verbose('New connection received for existing host connection ', {
                    instanceId,
                });
                logger_1.logger.verbose(`Closing previous connection for client instance... `, {
                    instanceId,
                });
                existingHost.ws.close(1008, 'New connection established for same ID, closing previous connection.');
            }
            const existingClient = processVars_1.connectedClients.get(instanceId);
            if (existingClient) {
                logger_1.logger.verbose('New connection received for existing client connection ', {
                    instanceId,
                });
                logger_1.logger.verbose(`Closing previous connection for client instance... `, {
                    instanceId,
                });
                existingClient.ws.close(1008, 'New connection established for same ID, closing previous connection.');
            }
        }
        if (instanceId && processVars_1.blockedWsIds.has(instanceId)) {
            rawSocket.close(1008, 'Reconnection blocked due to misbehavior.');
            logger_1.logger.info('Connection ID is blocklisted, refusing connection', {
                instanceId,
            });
            return;
        }
        const ws = new ISocket_1.default(rawSocket, { id: instanceId });
        const recentlyOpenedLivePages = new Set();
        let messageRateLimitCountIndex = 0;
        const messageRateLimitCountHistory = Array(RATE_LIMIT_HISTORY_SIZE);
        let messageRateLimitCount = 0;
        const messageRateLimitTypeCounts = new Map();
        let heartbeatInterval;
        let messageRateLimitInterval;
        let recentlyOpenedLivePagesInterval;
        let closed = false;
        ws.onClose.attach(handleClose);
        ws.onError.attach(error => {
            logger_1.logger.error('Error in ws', {
                instanceId: ws.id,
                error,
            });
        });
        try {
            const ghostModeEnabled = await (0, featureFlags_1.isFlagEnabled)('GHOST_MODE_ENABLED');
            let auth = null;
            const rateLimitAlertThreshold = apiKey
                ? RATE_LIMIT_ALERT_THRESHOLD
                : RATE_LIMIT_CLIENT_ALERT_THRESHOLD;
            const rateLimitMaxThreshold = apiKey
                ? RATE_LIMIT_MAX_MESSAGES_PER_SECOND
                : RATE_LIMIT_CLIENT_MAX_MESSAGES_PER_SECOND;
            messageRateLimitInterval = setInterval(() => {
                if (messageRateLimitCount > rateLimitAlertThreshold) {
                    logger_1.logger.warn('Approaching rate limit', {
                        instanceId: ws.id,
                        organizationEnvironmentId: auth?.organizationEnvironment?.id,
                        apiKeyId: auth?.apiKey?.id,
                        organizationId: auth?.organization?.id,
                        count: messageRateLimitCount,
                        typeCounts: Object.fromEntries(messageRateLimitTypeCounts.entries()),
                    });
                }
                messageRateLimitCountHistory[messageRateLimitCountIndex] =
                    messageRateLimitCount;
                messageRateLimitCount = 0;
                messageRateLimitCountIndex =
                    (messageRateLimitCountIndex + 1) % RATE_LIMIT_HISTORY_SIZE;
                messageRateLimitTypeCounts.clear();
                const alertsExceededInHistory = messageRateLimitCountHistory.reduce((acc, val) => (val >= rateLimitAlertThreshold ? acc + 1 : acc), 0);
                if (alertsExceededInHistory > RATE_LIMIT_HISTORY_THRESHOLD_LIMIT) {
                    logger_1.logger.info('Rate limit history count exceeded for connection, closing connection...', {
                        id: ws.id,
                        organizationEnvironmentId: auth?.organizationEnvironment?.id,
                        apiKeyId: auth?.apiKey?.id,
                        organizationId: auth?.organization?.id,
                        alertsExceededInHistory,
                    });
                    ws.close(1008, 'Rate limit exceeded. Please contact us with questions (help@interval.com).');
                }
            }, 1000);
            recentlyOpenedLivePagesInterval = setInterval(() => {
                recentlyOpenedLivePages.clear();
            }, RECENTLY_OPENED_LIVE_PAGES_INTERVAL_MS);
            ws.onMessage.attach(() => {
                if (messageRateLimitCount++ > rateLimitMaxThreshold) {
                    logger_1.logger.info('Rate limit exceeded for connection, closing connection...', {
                        id: ws.id,
                        organizationEnvironmentId: auth?.organizationEnvironment?.id,
                        apiKeyId: auth?.apiKey?.id,
                        organizationId: auth?.organization?.id,
                        count: messageRateLimitCount,
                        typeCounts: Object.fromEntries(messageRateLimitTypeCounts.entries()),
                    });
                    ws.close(1008, 'Rate limit exceeded. Please contact us with questions (help@interval.com).');
                }
            });
            if (apiKey) {
                auth = await (0, auth_1.loginWithApiKey)(apiKey);
            }
            else if (req.headers.cookie) {
                const { origin, cookie: cookies } = req.headers;
                if (origin !== env_1.default.APP_URL) {
                    logger_1.logger.info('Invalid origin header for cookie authentication, closing connection', { id: ws.id });
                    ws.close(1008, 'Invalid origin');
                    return;
                }
                const authCookies = Array.isArray(cookies)
                    ? cookies.flatMap(cookies => getCookies(isomorphicConsts_1.AUTH_COOKIE_NAME, cookies))
                    : getCookies(isomorphicConsts_1.AUTH_COOKIE_NAME, cookies);
                for (const cookie of authCookies) {
                    try {
                        auth = await loginWithCookie(cookie);
                        // use first successfully authenticated cookie if multiple
                        break;
                    }
                    catch (error) {
                        logger_1.logger.error('Invalid auth cookie', { error });
                    }
                }
            }
            else if (ghostOrgId && ghostModeEnabled) {
                try {
                    auth = await (0, ghost_1.findOrCreateGhostOrg)(ghostOrgId);
                }
                catch (error) {
                    logger_1.logger.error(`Error logging into Ghost Org`, { error });
                }
            }
            // TODO: Ghost mode client access ?
            if (!auth) {
                const reason = req.headers['x-api-key']
                    ? 'Invalid API key'
                    : 'Missing API key';
                // remove if we totally remove ghost mode
                // if (ghostOrgId) {
                //   if (!ghostModeEnabled) {
                //     reason = `Ghost mode not currently enabled, please try again later`
                //   } else {
                //     reason = `Invalid ghost org ID ${ghostOrgId}`
                //   }
                // }
                logger_1.logger.info(`Auth failed, closing session...`, {
                    reason,
                    apiKey: req.headers['x-api-key'],
                });
                const KEYS_DASHBOARD_PAGE = `${env_1.default.APP_URL}/dashboard/develop/keys`;
                ws.close(1008, `${reason}, please check the apiKey property. Get an API key at ${KEYS_DASHBOARD_PAGE}.`);
                return;
            }
            logger_1.logger.verbose('Websocket connection authenticated', {
                instanceId: ws.id,
                userId: auth.user?.id,
                organizationId: auth.organization?.id,
                apiKeyId: auth.apiKey?.id,
            });
            // We should never await the result of this!
            // As soon as the user is authenticated, we must synchronously create the RPC client
            ws.confirmAuthentication().catch(error => {
                logger_1.logger.error('Failed confirming authentication, closing connection...', {
                    error,
                });
                ws.close(1008, 'Failed confirming authentication.');
            });
            let initializingHost = false;
            const pendingInitializationTimestamps = new Set();
            const rpc = new DuplexRPCClient_1.DuplexRPCClient({
                communicator: ws,
                canCall: { ...internalRpcSchema_1.clientSchema, ...internalRpcSchema_1.hostSchema },
                canRespondTo: internalRpcSchema_1.wsServerSchema,
                handlers: {
                    INITIALIZE_CLIENT: async () => {
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('INITIALIZE_CLIENT: Missing auth for instance id', {
                                instanceId: ws.id,
                            });
                            return false;
                        }
                        processVars_1.connectedClients.set(ws.id, {
                            ws,
                            rpc,
                            user: auth.user,
                            organization: auth.organization,
                            organizationEnvironment: auth.organizationEnvironment,
                            pageKeys: new Set(),
                        });
                        {
                            let ids = processVars_1.userClientIds.get(auth.user.id);
                            if (!ids) {
                                ids = new Set();
                                processVars_1.userClientIds.set(auth.user.id, ids);
                            }
                            ids.add(ws.id);
                        }
                        logger_1.logger.verbose('Clients count', {
                            instanceId: ws.id,
                            clients: processVars_1.connectedClients.size,
                        });
                        return true;
                    },
                    INITIALIZE_HOST: async (inputs) => {
                        const { sdkName, sdkVersion, requestId } = inputs;
                        /**
                         * Returns an error response if the SDK supports it, or null otherwise indicating a general failure supported by all SDKs.
                         */
                        function initializationFailure(message, sdkAlert) {
                            if (!sdkName || !sdkVersion)
                                return null;
                            if (sdkName === isomorphicConsts_1.NODE_SDK_NAME && sdkVersion >= '0.18.0') {
                                return {
                                    type: 'error',
                                    message,
                                    sdkAlert,
                                };
                            }
                            return null;
                        }
                        if (!auth || !auth.organization || !auth.apiKey) {
                            logger_1.logger.info('INITIALIZE_HOST: Missing auth for instance', {
                                instanceId: ws.id,
                            });
                            return initializationFailure('The provided API key is not valid');
                        }
                        if (!sdkName || !sdkVersion) {
                            return initializationFailure('Unsupported SDK version');
                        }
                        const sdkAlert = await (0, sdkAlerts_1.getSdkAlert)(sdkName, sdkVersion);
                        if (sdkAlert?.severity === 'ERROR') {
                            return initializationFailure('Unsupported SDK version', sdkAlert);
                        }
                        const pollIntervalMs = 500;
                        const waitForPreviousInitializationTimeoutMs = 60_000;
                        let numPollsRemaining = waitForPreviousInitializationTimeoutMs / pollIntervalMs;
                        // Order pending initializations for this host by timestamp
                        // If timestamp not provided by the host, use the order we received them in
                        const timestamp = inputs.timestamp ?? new Date().valueOf();
                        pendingInitializationTimestamps.add(timestamp);
                        const isNextInLine = () => {
                            const ordered = Array.from(pendingInitializationTimestamps.values());
                            ordered.sort();
                            return ordered[0] === timestamp;
                        };
                        while (initializingHost || !isNextInLine()) {
                            if (numPollsRemaining === 0) {
                                pendingInitializationTimestamps.delete(timestamp);
                                return initializationFailure('Initialization request timed out. Please try again.');
                            }
                            // If we're in the middle of an initialization, or not next in line, wait for a bit and check again
                            await (0, sleep_1.default)(pollIntervalMs);
                            numPollsRemaining -= 1;
                        }
                        try {
                            pendingInitializationTimestamps.delete(timestamp);
                            initializingHost = true;
                            const hostInstance = await prisma_1.default.hostInstance.upsert({
                                where: { id: ws.id },
                                create: {
                                    id: ws.id,
                                    organizationId: auth.organization.id,
                                    apiKeyId: auth.apiKey.id,
                                    status: client_1.HostInstanceStatus.ONLINE,
                                    sdkName,
                                    sdkVersion,
                                    requestId,
                                },
                                update: {
                                    organizationId: auth.organization.id,
                                    apiKeyId: auth.apiKey.id,
                                    status: client_1.HostInstanceStatus.ONLINE,
                                    isInitializing: true,
                                    sdkName,
                                    sdkVersion,
                                    requestId,
                                },
                                include: {
                                    actions: {
                                        select: {
                                            id: true,
                                        },
                                    },
                                    actionGroups: {
                                        select: {
                                            id: true,
                                        },
                                    },
                                },
                            });
                            const actions = 'actions' in inputs
                                ? inputs.actions
                                : inputs.callableActionNames.map(slug => ({
                                    prefix: undefined,
                                    slug,
                                }));
                            const invalidSlugs = actions
                                .filter(({ prefix, slug }) => !(0, validate_1.isGroupSlugValid)(prefix) || !(0, validate_1.isSlugValid)(slug))
                                .map(def => (0, actions_2.getFullActionSlug)(def));
                            if (inputs.requestId) {
                                const httpHostRequest = await prisma_1.default.httpHostRequest.findUnique({
                                    where: {
                                        id: inputs.requestId,
                                    },
                                    include: {
                                        hostInstance: {
                                            include: {
                                                transactions: true,
                                            },
                                        },
                                        action: true,
                                        actionGroup: true,
                                    },
                                });
                                const oneMinuteAgo = new Date();
                                oneMinuteAgo.setMinutes(oneMinuteAgo.getMinutes() - 1);
                                if (!httpHostRequest ||
                                    (httpHostRequest.action?.organizationId !==
                                        auth.organization.id &&
                                        httpHostRequest.actionGroup?.organizationId !==
                                            auth.organization.id) ||
                                    httpHostRequest.invalidAt ||
                                    httpHostRequest.createdAt < oneMinuteAgo) {
                                    return initializationFailure('Invalid action request');
                                }
                            }
                            else {
                                (0, actions_3.initializeActions)({
                                    hostInstance,
                                    httpHost: null,
                                    actions,
                                    groups: 'groups' in inputs ? inputs.groups : undefined,
                                    developerId: auth.apiKey.usageEnvironment === 'DEVELOPMENT'
                                        ? auth.user.id
                                        : null,
                                    organizationEnvironmentId: auth.apiKey.organizationEnvironmentId,
                                    sdkVersion,
                                    sdkName,
                                })
                                    .then(async ({ initializedActions, initializedActionGroups }) => {
                                    const initializedActionMap = new Map(initializedActions.map(action => [action.id, action]));
                                    const initializedActionGroupMap = new Map(initializedActionGroups.map(group => [group.id, group]));
                                    await prisma_1.default.hostInstance.update({
                                        where: {
                                            id: hostInstance.id,
                                        },
                                        data: {
                                            isInitializing: false,
                                            actions: {
                                                disconnect: hostInstance.actions
                                                    .filter(action => !initializedActionMap.has(action.id))
                                                    .map(action => ({
                                                    id: action.id,
                                                })),
                                            },
                                            actionGroups: {
                                                disconnect: hostInstance.actionGroups
                                                    .filter(group => !initializedActionGroupMap.has(group.id))
                                                    .map(group => ({
                                                    id: group.id,
                                                })),
                                            },
                                        },
                                    });
                                })
                                    .catch(async (error) => {
                                    logger_1.logger.error('Failed initializing actions', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        error,
                                    });
                                    try {
                                        await prisma_1.default.hostInstance.update({
                                            where: {
                                                id: hostInstance.id,
                                            },
                                            data: {
                                                isInitializing: false,
                                            },
                                        });
                                    }
                                    catch (error) {
                                        logger_1.logger.error(`Failed marking host instance ${hostInstance.id} as not initializing`, {
                                            instanceId: ws.id,
                                            organizationId: auth?.organization?.id,
                                            error,
                                        });
                                    }
                                })
                                    .finally(() => {
                                    initializingHost = false;
                                })
                                    .catch(() => {
                                    // Just here to appease linter
                                });
                            }
                            const host = {
                                apiKeyId: auth.apiKey.id,
                                usageEnvironment: auth.apiKey.usageEnvironment,
                                organizationEnvironment: auth.organizationEnvironment,
                                user: auth.user,
                                organization: auth.organization,
                                rpc,
                                ws,
                                pageKeys: new Set(),
                                sdkName,
                                sdkVersion,
                            };
                            processVars_1.connectedHosts.set(ws.id, host);
                            {
                                let keyIds = processVars_1.apiKeyHostIds.get(auth.apiKey.id);
                                if (!keyIds) {
                                    keyIds = new Set();
                                    processVars_1.apiKeyHostIds.set(auth.apiKey.id, keyIds);
                                }
                                keyIds.add(ws.id);
                            }
                            logger_1.logger.verbose('Host connected', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                hostsCount: processVars_1.connectedHosts.size,
                            });
                            const warnings = [];
                            const permissionsWarning = await (0, actions_3.getPermissionsWarning)({
                                actions,
                                groups: 'groups' in inputs ? inputs.groups : undefined,
                                organizationId: auth.apiKey.organizationId,
                            });
                            if (permissionsWarning)
                                warnings.push(permissionsWarning);
                            const { name, slug } = auth.organization;
                            return {
                                type: 'success',
                                environment: (0, transactions_1.getActionEnvironment)(host),
                                invalidSlugs,
                                organization: { name, slug },
                                dashboardUrl: (0, transactions_2.getDashboardUrl)({
                                    orgSlug: slug,
                                    envSlug: auth.organizationEnvironment?.slug,
                                    environment: auth.apiKey.usageEnvironment,
                                }),
                                sdkAlert,
                                warnings,
                            };
                        }
                        catch (error) {
                            logger_1.logger.error('Failed handling INITIALIZE_HOST:', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                error,
                            });
                            return initializationFailure('Internal Server Error');
                        }
                    },
                    BEGIN_HOST_SHUTDOWN: async () => {
                        logger_1.logger.debug('BEGIN_HOST_SHUTDOWN', { instanceId: ws.id });
                        try {
                            await prisma_1.default.hostInstance.update({
                                where: {
                                    id: ws.id,
                                },
                                data: {
                                    status: 'SHUTTING_DOWN',
                                },
                            });
                            return { type: 'success' };
                        }
                        catch (error) {
                            logger_1.logger.error('BEGIN_HOST_SHUTDOWN: Failed to update host instance', { instanceId: ws.id, error });
                            return {
                                type: 'error',
                                message: error instanceof Error ? error.message : undefined,
                            };
                        }
                    },
                    CONNECT_TO_TRANSACTION_AS_CLIENT: async (inputs) => {
                        if (!auth) {
                            logger_1.logger.info('CONNECT_TO_TRANSACTION_AS_CLIENT: No auth');
                            return false;
                        }
                        const t = await prisma_1.default.transaction.findUnique({
                            where: { id: inputs.transactionId },
                            include: {
                                action: {
                                    include: {
                                        organizationEnvironment: true,
                                    },
                                },
                                queuedAction: true,
                                hostInstance: {
                                    include: {
                                        apiKey: true,
                                        organization: {
                                            include: {
                                                userOrganizationAccess: {
                                                    where: {
                                                        userId: auth.user.id,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        });
                        if (!t) {
                            // Likely means this is a development transaction that was already cleaned up
                            logger_1.logger.warn('CONNECT_TO_TRANSACTION_AS_CLIENT: Transaction does not exist for id', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: inputs.transactionId,
                            });
                            return false;
                        }
                        if (!t.hostInstance) {
                            const level = t.action.organizationEnvironment.slug ===
                                environments_1.DEVELOPMENT_ORG_ENV_SLUG
                                ? 'warn'
                                : 'error';
                            logger_1.logger.log(level, 'CONNECT_TO_TRANSACTION_AS_CLIENT: No host instance found for transaction', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: inputs.transactionId,
                            });
                            return false;
                        }
                        if (!t.hostInstance.organization.userOrganizationAccess.length &&
                            t?.hostInstance.organization.isGhostMode !== true) {
                            logger_1.logger.info('CONNECT_TO_TRANSACTION_AS_CLIENT: Forbidden');
                            return false;
                        }
                        const isResume = t.currentClientId === ws.id;
                        if (!t.hostInstance.id) {
                            return false;
                        }
                        if (t.status === 'PENDING' || isResume) {
                            logger_1.logger.verbose('Starting new transaction', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: t.id,
                                hostInstanceId: t.hostInstance.id,
                            });
                            const host = processVars_1.connectedHosts.get(t.hostInstance.id);
                            if (!host) {
                                logger_1.logger.info('Failed connecting to transaction: No host found', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return false;
                            }
                            if (t.status === 'COMPLETED') {
                                logger_1.logger.info('Failed connecting to transaction: transaction has already finished', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return false;
                            }
                            // ORDER MATTERS HERE
                            // If the client isn't in the db when start transaction is called, the first render call maybe happen too late
                            await prisma_1.default.transaction.update({
                                where: { id: t.id },
                                data: {
                                    // status: t.status === 'PENDING' ? 'RUNNING' : undefined,
                                    currentClientId: ws.id,
                                },
                            });
                            // Do this separately so we can update status asynchronously
                            prisma_1.default.transaction
                                .updateMany({
                                where: { id: t.id, status: 'PENDING' },
                                data: {
                                    status: 'RUNNING',
                                },
                            })
                                .catch(error => {
                                logger_1.logger.error('Failed updating transaction status', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    error,
                                });
                            });
                            if (!isResume) {
                                const params = {
                                    ...((0, queuedActions_1.getQueuedActionParams)(t.queuedAction?.params) ?? {}),
                                    ...(inputs.params ?? {}),
                                };
                                const runner = await prisma_1.default.user.findUnique({
                                    where: {
                                        id: auth.user.id,
                                    },
                                    select: {
                                        id: true,
                                        email: true,
                                        firstName: true,
                                        lastName: true,
                                        userOrganizationAccess: {
                                            select: {
                                                permissions: true,
                                                groupMemberships: {
                                                    select: {
                                                        group: {
                                                            select: {
                                                                id: true,
                                                                slug: true,
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                });
                                if (!runner) {
                                    logger_1.logger.error('Failed to find action runner', {
                                        instanceId: ws.id,
                                        userId: auth.user.id,
                                    });
                                    return false;
                                }
                                (0, transactions_1.startTransaction)(t, runner, {
                                    params,
                                    paramsMeta: t.queuedAction?.paramsMeta ?? undefined,
                                })
                                    .then(startResult => {
                                    logger_1.logger.verbose('Transaction started', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: t.id,
                                        startResult,
                                    });
                                })
                                    .catch(error => {
                                    logger_1.logger.error('Failed starting transaction for host', {
                                        transactionId: t.id,
                                        hostWsId: host.ws.id,
                                        error,
                                    });
                                });
                            }
                        }
                        if (t.status !== 'COMPLETED') {
                            logger_1.logger.verbose('Taking over transaction', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: t.id,
                                hostInstanceId: t.hostInstance.id,
                                clientId: ws.id,
                            });
                            // takeover as the current client
                            await prisma_1.default.transaction.update({
                                where: { id: t.id },
                                data: { currentClientId: ws.id },
                            });
                            if (t.currentClientId && t.currentClientId !== ws.id) {
                                // let the existing connected client know they've been booted
                                const previouslyConnected = processVars_1.connectedClients.get(t.currentClientId);
                                if (previouslyConnected) {
                                    logger_1.logger.verbose('Sending CLIENT_USURPED', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: t.id,
                                        previouslyConnectedId: previouslyConnected.ws.id,
                                        clientId: ws.id,
                                    });
                                    previouslyConnected.rpc
                                        .send('CLIENT_USURPED', {
                                        transactionId: t.id,
                                    })
                                        .catch(error => {
                                        logger_1.logger.warn('Failed sending CLIENT_USURPED message to client', {
                                            error,
                                        });
                                    });
                                }
                            }
                            // if there's a pending UI interaction, render it now
                            const toRender = processVars_1.pendingIOCalls.get(t.id);
                            if (toRender) {
                                rpc
                                    .send('RENDER', {
                                    transactionId: t.id,
                                    toRender,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending pending render call', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: t.id,
                                        error,
                                    });
                                });
                            }
                            const loadingState = processVars_1.transactionLoadingStates.get(t.id);
                            if (loadingState) {
                                rpc
                                    .send('LOADING_STATE', {
                                    transactionId: t.id,
                                    ...loadingState,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending pending loading state call', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: t.id,
                                        error,
                                    });
                                });
                            }
                            const redirect = processVars_1.transactionRedirects.get(t.id);
                            if (redirect) {
                                rpc
                                    .send('REDIRECT', {
                                    ...redirect,
                                    transactionId: t.id,
                                })
                                    .then(() => {
                                    // To allow redirecting back afterward, like in an OAuth flow
                                    //
                                    // This basically means that redirects only happen once;
                                    // as soon as the redirect happens to a single client,
                                    // any subsequent clients that might visit the in-progress
                                    // transaction will not receive the same redirect call
                                    processVars_1.transactionRedirects.delete(t.id);
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending pending redirect call', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: t.id,
                                        error,
                                    });
                                });
                            }
                            logger_1.logger.verbose('Took over transaction', {
                                transactionId: t.id,
                                hostInstanceId: t.hostInstance.id,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                        }
                        return true;
                    },
                    __TEST_ONLY_REQUEST_DROP_CONNECTION: async () => {
                        if (process.env.NODE_ENV === 'production')
                            return false;
                        setTimeout(() => {
                            ws.close();
                        }, 100);
                        return true;
                    },
                    LEAVE_TRANSACTION: async ({ transactionId }) => {
                        if (!auth || !auth.organization)
                            return false;
                        const transaction = await prisma_1.default.transaction.findUnique({
                            where: {
                                id: transactionId,
                            },
                            include: {
                                action: true,
                                hostInstance: true,
                            },
                        });
                        if (!transaction || transaction.currentClientId !== ws.id) {
                            return false;
                        }
                        try {
                            await prisma_1.default.transaction.update({
                                where: {
                                    id: transactionId,
                                },
                                data: {
                                    currentClientId: null,
                                },
                            });
                        }
                        catch (error) {
                            logger_1.logger.warn('LEAVE_TRANSACTION: Failed removing currentClientId', {
                                transactionId,
                                error,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                        }
                        if (transaction.action.backgroundable &&
                            transaction.status !== 'COMPLETED') {
                            return true;
                        }
                        // Not backgroundable, should be canceled
                        if (transaction.status !== 'COMPLETED') {
                            await (0, transactions_1.cancelTransaction)(transaction);
                        }
                        if (!transaction.hostInstanceId) {
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(transaction.hostInstanceId);
                        if (!host) {
                            return false;
                        }
                        if (transaction.hostInstance?.sdkVersion &&
                            transaction.hostInstance.sdkVersion >= '0.38.0') {
                            try {
                                await host.rpc.send('CLOSE_TRANSACTION', {
                                    transactionId,
                                });
                            }
                            catch (error) {
                                const level = host.usageEnvironment === 'PRODUCTION' ? 'error' : 'warn';
                                logger_1.logger.log(level, 'LEAVE_TRANSACTION: Failed closing transaction', {
                                    transactionId,
                                    error,
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return false;
                            }
                        }
                        return true;
                    },
                    MARK_TRANSACTION_COMPLETE: async (inputs) => {
                        if (!auth || !auth.organization)
                            return false;
                        const t = await prisma_1.default.transaction.findUnique({
                            where: {
                                id: inputs.transactionId,
                            },
                            include: {
                                action: true,
                            },
                        });
                        if (!t) {
                            logger_1.logger.warn('MARK_TRANSACTION_COMPLETE: No transaction found', {
                                transactionId: inputs.transactionId,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(ws.id);
                        if (!host ||
                            host.user.id !== auth.user.id ||
                            host.organization.id !== auth.organization.id ||
                            ws.id !== t.hostInstanceId ||
                            host.organization.id !== t.action.organizationId) {
                            logger_1.logger.info('MARK_TRANSACTION_COMPLETE: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const result = (0, parseActionResult_1.parseActionResult)(inputs.result);
                        // Important: Don't overwrite existing status (eg CANCELED)
                        const resultStatus = t.resultStatus ?? result.status;
                        const transaction = await prisma_1.default.transaction.update({
                            where: { id: inputs.transactionId },
                            data: {
                                status: 'COMPLETED',
                                resultStatus,
                                resultSchemaVersion: result.schemaVersion,
                                resultData: result.data ?? undefined,
                                resultDataMeta: result.meta ?? undefined,
                                completedAt: new Date(),
                            },
                            include: {
                                hostInstance: {
                                    include: { apiKey: true },
                                },
                                action: {
                                    include: {
                                        organization: { include: { private: true } },
                                        metadata: true,
                                    },
                                },
                                actionSchedule: true,
                                owner: true,
                            },
                        });
                        (0, uploads_1.deleteTransactionUploads)(transaction.id).catch(error => {
                            logger_1.logger.error('Failed deleting transaction uploads', {
                                transactionId: transaction.id,
                                error,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                        });
                        (0, transactions_1.freeTransactionCalls)(transaction);
                        if (!inputs.skipClientCall && transaction.currentClientId) {
                            const client = processVars_1.connectedClients.get(transaction.currentClientId);
                            if (client) {
                                client.rpc
                                    .send('TRANSACTION_COMPLETED', {
                                    transactionId: t.id,
                                    resultStatus,
                                    result: inputs.result,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending TRANSACTION_COMPLETED message to client', { transactionId: t.id, clientId: client.ws.id, error });
                                });
                            }
                        }
                        else if (transaction.action.metadata &&
                            (0, actions_1.isBackgroundable)({
                                ...transaction.action,
                                metadata: transaction.action.metadata,
                            })) {
                            if (transaction.actionSchedule &&
                                !transaction.actionSchedule.notifyOnSuccess &&
                                resultStatus === 'SUCCESS') {
                                logger_1.logger.verbose('Scheduled action completed successfully, skipping notification due to opt out', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    transactionId: t.id,
                                });
                            }
                            else if (!transaction.action.developerId) {
                                logger_1.logger.verbose('No client to send transaction completed call to, sending notification to runner', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    transactionId: t.id,
                                    to: transaction.owner.email,
                                });
                                await (0, notify_2.default)({
                                    title: (0, notify_1.completionTitle)(resultStatus),
                                    message: (0, notify_1.completionMessage)(resultStatus, (0, actions_2.getName)(transaction.action)),
                                    transaction: transaction,
                                    environment: 'PRODUCTION',
                                    organization: transaction.action.organization,
                                    deliveryInstructions: [{ to: transaction.owner.email }],
                                    createdAt: new Date().toISOString(),
                                    idempotencyKey: `${transaction.id}_COMPLETE`,
                                });
                            }
                        }
                        return true;
                    },
                    RESPOND_TO_IO_CALL: async (inputs) => {
                        if (!auth) {
                            logger_1.logger.info('RESPOND_TO_IO_CALL: No auth', {
                                instanceId: ws.id,
                            });
                            return false;
                        }
                        const client = processVars_1.connectedClients.get(ws.id);
                        if (!client || client.user.id !== auth.user.id) {
                            logger_1.logger.info('RESPOND_TO_IO_CALL: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const transaction = await prisma_1.default.transaction.findUnique({
                            where: { id: inputs.transactionId },
                            include: {
                                requirements: {
                                    where: { satisfiedAt: null, canceledAt: null },
                                },
                                hostInstance: {
                                    include: {
                                        organization: {
                                            include: {
                                                userOrganizationAccess: {
                                                    where: {
                                                        userId: auth.user.id,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        });
                        let hostInstanceId;
                        if (transaction?.hostInstance) {
                            if (!transaction.hostInstance.organization.userOrganizationAccess
                                .length &&
                                !transaction.hostInstance.organization.isGhostMode) {
                                logger_1.logger.info('RESPOND_TO_IO_CALL: Forbidden', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return false;
                            }
                            hostInstanceId = transaction.hostInstance.id;
                        }
                        else {
                            const sockets = processVars_1.pageSockets.get(inputs.transactionId);
                            if (!sockets) {
                                logger_1.logger.info('RESPOND_TO_IO_CALL: Not found', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return false;
                            }
                            hostInstanceId = sockets.hostId;
                        }
                        const host = processVars_1.connectedHosts.get(hostInstanceId);
                        if (!host) {
                            logger_1.logger.info('RESPOND_TO_IO_CALL: Host instance not found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                hostInstanceId,
                            });
                            return false;
                        }
                        if (transaction && transaction.requirements.length > 0) {
                            try {
                                const parsed = JSON.parse(inputs.ioResponse);
                                const ioCallId = parsed ? parsed.id : null;
                                const cancellingRequirement = (r) => {
                                    return (r.ioCallId === ioCallId &&
                                        parsed?.values.length === 1 &&
                                        parsed.values[0] === false);
                                };
                                if (transaction.requirements.some(r => !cancellingRequirement(r))) {
                                    logger_1.logger.verbose('RESPOND_TO_IO_CALL: Transaction needs identity confirmation', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: transaction.id,
                                    });
                                    return false;
                                }
                                else {
                                    await prisma_1.default.transactionRequirement.updateMany({
                                        where: {
                                            transactionId: transaction.id,
                                            ioCallId,
                                        },
                                        data: {
                                            canceledAt: new Date(),
                                        },
                                    });
                                }
                            }
                            catch (error) {
                                logger_1.logger.error('Failed parsing IO response', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    transactionId: transaction.id,
                                    error,
                                });
                            }
                        }
                        try {
                            await host.rpc.send('IO_RESPONSE', {
                                value: inputs.ioResponse,
                                transactionId: inputs.transactionId,
                            });
                            if (transaction &&
                                transaction.status !== 'RUNNING' &&
                                transaction.status !== 'COMPLETED') {
                                await prisma_1.default.transaction.update({
                                    where: { id: transaction.id },
                                    data: { status: 'RUNNING' },
                                });
                            }
                            return true;
                        }
                        catch (error) {
                            logger_1.logger.error('Failed sending IO_RESPONSE to host', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                hostId: host.ws.id,
                                error,
                            });
                            return false;
                        }
                    },
                    REQUEST_PAGE: async (inputs) => {
                        logger_1.logger.debug('REQUEST_PAGE', { inputs });
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('REQUEST_PAGE: No auth', {
                                instanceId: ws.id,
                            });
                            return { type: 'ERROR', message: 'Unauthenticated' };
                        }
                        if (inputs.actionMode === 'live') {
                            const key = `${inputs.pageSlug}-${auth.organization.id}-${inputs.organizationEnvironmentId}`;
                            if (recentlyOpenedLivePages.has(key)) {
                                logger_1.logger.warn(`Client connection requested same page live twice in same ${RECENTLY_OPENED_LIVE_PAGES_INTERVAL_MS} ms period, swallowing request`, {
                                    instanceId: ws.id,
                                    slug: inputs.pageSlug,
                                    organizationId: auth.organization.id,
                                    developerId: inputs.actionMode === 'live' ? null : auth.user.id,
                                    organizationEnvironmentId: inputs.organizationEnvironmentId,
                                });
                                return {
                                    type: 'ERROR',
                                    message: 'Same page requested too recently, please wait a moment.',
                                };
                            }
                            recentlyOpenedLivePages.add(key);
                        }
                        const group = await prisma_1.default.actionGroup.findFirst({
                            where: {
                                slug: inputs.pageSlug,
                                organizationId: auth.organization.id,
                                developerId: inputs.actionMode === 'live' ? null : auth.user.id,
                                organizationEnvironmentId: inputs.organizationEnvironmentId,
                                hasHandler: true,
                            },
                            include: {
                                hostInstances: {
                                    orderBy: {
                                        createdAt: 'desc',
                                    },
                                },
                                httpHosts: {
                                    orderBy: {
                                        createdAt: 'desc',
                                    },
                                },
                            },
                        });
                        if (!group) {
                            logger_1.logger.info('REQUEST_PAGE: Not found', {
                                slug: inputs.pageSlug,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return { type: 'ERROR', message: 'App not found' };
                        }
                        const client = processVars_1.connectedClients.get(ws.id);
                        let host;
                        if (!client) {
                            return { type: 'ERROR', MESSAGE: 'Client not found' };
                        }
                        const pageKey = inputs.pageKey;
                        try {
                            const hostInstance = await (0, transactions_2.getCurrentHostInstance)(group);
                            host = processVars_1.connectedHosts.get(hostInstance.id);
                            if (!host) {
                                logger_1.logger.warn('REQUEST_PAGE: No host found', {
                                    pageKey,
                                    hostInstanceId: hostInstance.id,
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                return { type: 'ERROR', message: 'Host not found' };
                            }
                            processVars_1.pageSockets.set(pageKey, {
                                clientId: client.ws.id,
                                hostId: host.ws.id,
                            });
                            host.pageKeys.add(pageKey);
                            client.pageKeys.add(pageKey);
                            const runner = await prisma_1.default.user.findUnique({
                                where: {
                                    id: auth.user.id,
                                },
                                select: {
                                    id: true,
                                    email: true,
                                    firstName: true,
                                    lastName: true,
                                    userOrganizationAccess: {
                                        select: {
                                            permissions: true,
                                            groupMemberships: {
                                                select: {
                                                    group: {
                                                        select: {
                                                            id: true,
                                                            slug: true,
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            });
                            if (!runner) {
                                logger_1.logger.error('Failed to find action runner', {
                                    instanceId: ws.id,
                                    userId: auth.user.id,
                                });
                                throw new Error('Failed to find action runner');
                            }
                            return await host.rpc.send('OPEN_PAGE', {
                                pageKey,
                                page: {
                                    slug: group.slug,
                                },
                                environment: (0, transactions_1.getActionEnvironment)(host),
                                user: (0, user_1.getStartTransactionUser)(runner),
                                params: inputs.params ?? {},
                            });
                        }
                        catch (error) {
                            const level = host?.usageEnvironment === 'PRODUCTION' ? 'error' : 'warn';
                            logger_1.logger.log(level, 'Error sending OPEN_PAGE to host', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                groupId: group.id,
                                error,
                            });
                            logger_1.logger.verbose('Deleting cached sockets for page key', {
                                pageKey,
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            processVars_1.pageSockets.delete(pageKey);
                            client.pageKeys.delete(pageKey);
                            if (host) {
                                host.pageKeys.delete(pageKey);
                            }
                            return { type: 'ERROR' };
                        }
                    },
                    LEAVE_PAGE: async (inputs) => {
                        const sockets = processVars_1.pageSockets.get(inputs.pageKey);
                        if (!sockets) {
                            logger_1.logger.info('No sockets found for page key', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                pageKey: inputs.pageKey,
                            });
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(sockets.hostId);
                        if (!host) {
                            logger_1.logger.info('No connected host found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                host: sockets.hostId,
                                pageKey: inputs.pageKey,
                            });
                            return false;
                        }
                        await host.rpc
                            .send('CLOSE_PAGE', {
                            pageKey: inputs.pageKey,
                        })
                            .then(() => {
                            host.pageKeys.delete(inputs.pageKey);
                            const client = processVars_1.connectedClients.get(sockets.clientId);
                            client?.pageKeys.delete(inputs.pageKey);
                            processVars_1.pageSockets.delete(inputs.pageKey);
                        })
                            .catch(error => {
                            const level = host.usageEnvironment === 'PRODUCTION' ? 'error' : 'warn';
                            logger_1.logger.log(level, 'Failed sending CLOSE_PAGE call to host', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                host: sockets.hostId,
                                pageKey: inputs.pageKey,
                                error,
                            });
                        });
                        return true;
                    },
                    SEND_PAGE: async (inputs) => {
                        const sockets = processVars_1.pageSockets.get(inputs.pageKey);
                        if (!sockets) {
                            logger_1.logger.info('No sockets found for page key', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                pageKey: inputs.pageKey,
                            });
                            return false;
                        }
                        const client = processVars_1.connectedClients.get(sockets.clientId);
                        if (!client) {
                            logger_1.logger.info('No connected client found for ID', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                clientId: sockets.clientId,
                            });
                            return false;
                        }
                        await client.rpc
                            .send('RENDER_PAGE', {
                            pageKey: inputs.pageKey,
                            page: inputs.page,
                            hostInstanceId: ws.id,
                        })
                            .catch(error => {
                            logger_1.logger.warn('Failed sending RENDER_PAGE call to client', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                pageKey: inputs.pageKey,
                                error,
                            });
                        });
                        return true;
                    },
                    SEND_IO_CALL: async (inputs) => {
                        const host = processVars_1.connectedHosts.get(ws.id);
                        function sendIOCallFailure(message) {
                            if (host?.sdkVersion && host.sdkVersion >= '1.4.0') {
                                return {
                                    type: 'ERROR',
                                    message,
                                };
                            }
                            else {
                                return false;
                            }
                        }
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('SEND_IO_CALL: No auth', {
                                instanceId: ws.id,
                            });
                            return sendIOCallFailure('Unauthorized.');
                        }
                        if (!host ||
                            host.user.id !== auth.user.id ||
                            host.organization.id !== auth.organization.id) {
                            logger_1.logger.info('SEND_IO_CALL: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return sendIOCallFailure('Unauthorized.');
                        }
                        let parsed = null;
                        let requireIdentityConfirm = false;
                        let ioCallId = null;
                        let gracePeriodMs = null;
                        try {
                            // we just parse as JSON instead of using zod because it's much faster,
                            // if zod adds a fast performance mode we will use that here instead
                            parsed = JSON.parse(inputs.ioCall);
                            ioCallId = parsed ? parsed.id : null;
                            const confirmMethod = parsed?.toRender?.find(component => component.methodName === 'CONFIRM_IDENTITY');
                            requireIdentityConfirm = !!confirmMethod;
                            gracePeriodMs = confirmMethod?.props.gracePeriodMs ?? null;
                            // TODO: Remove when support is added, possibly behind a flag
                            if (parsed?.toRender?.find(component => component.methodName === 'CREDENTIALS')) {
                                return sendIOCallFailure('IO method io.experimental.credentials is not currently supported.');
                            }
                        }
                        catch (error) {
                            logger_1.logger.error('Failed parsing IO call', {
                                instanceId: ws.id,
                                transactionId: inputs.transactionId,
                                organizationId: auth?.organization?.id,
                                error,
                            });
                        }
                        let transaction;
                        // `parsed` should nearly always be present
                        const callKey = parsed?.inputGroupKey ?? (0, hash_1.shaHash)(inputs.ioCall);
                        try {
                            const inputTransaction = await prisma_1.default.transaction.findUnique({
                                where: { id: inputs.transactionId },
                            });
                            if (!inputTransaction) {
                                logger_1.logger.info('SEND_IO_CALL: Transaction not found for ID', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    transactionId: inputs.transactionId,
                                });
                                return sendIOCallFailure('Transaction not found.');
                            }
                            let status;
                            let requirements;
                            if (inputTransaction.status !== 'COMPLETED' &&
                                parsed?.toRender.some(ioCall => !ioCall.methodName.startsWith('DISPLAY_'))) {
                                status = 'AWAITING_INPUT';
                                if (requireIdentityConfirm) {
                                    requirements = {
                                        create: {
                                            ioCallId,
                                            type: 'IDENTITY_CONFIRM',
                                            gracePeriodMs,
                                        },
                                    };
                                }
                            }
                            transaction = await prisma_1.default.transaction.update({
                                where: {
                                    id: inputs.transactionId,
                                },
                                data: {
                                    status,
                                    requirements,
                                },
                                include: {
                                    owner: true,
                                    hostInstance: {
                                        include: { apiKey: true },
                                    },
                                    action: {
                                        include: {
                                            organization: { include: { private: true } },
                                            metadata: true,
                                        },
                                    },
                                },
                            });
                        }
                        catch {
                            logger_1.logger.info('SEND_IO_CALL: Failed updating transaction', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: inputs.transactionId,
                            });
                            return sendIOCallFailure('Failed updating transaction.');
                        }
                        processVars_1.pendingIOCalls.set(transaction.id, inputs.ioCall);
                        processVars_1.transactionLoadingStates.delete(transaction.id);
                        processVars_1.transactionRedirects.delete(transaction.id);
                        const isNewCallForTransaction = callKey !== transaction.lastInputGroupKey;
                        if (isNewCallForTransaction) {
                            try {
                                await prisma_1.default.transaction.update({
                                    where: {
                                        id: transaction.id,
                                    },
                                    data: {
                                        lastInputGroupKey: callKey,
                                    },
                                });
                            }
                            catch (error) {
                                logger_1.logger.error('Failed updating lastInputGroupKey for transaction', {
                                    error,
                                    transactionId: transaction.id,
                                    callKey,
                                });
                            }
                        }
                        if (!inputs.skipClientCall) {
                            new Promise(resolve => {
                                if (!transaction.currentClientId) {
                                    resolve(false);
                                    return;
                                }
                                const client = processVars_1.connectedClients.get(transaction.currentClientId);
                                if (!client) {
                                    resolve(false);
                                    return;
                                }
                                client.rpc
                                    .send('RENDER', {
                                    transactionId: transaction.id,
                                    toRender: inputs.ioCall,
                                })
                                    .then(() => {
                                    resolve(true);
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending render call to client', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: transaction.id,
                                        error,
                                    });
                                    resolve(false);
                                });
                            })
                                .then(renderSentToClient => {
                                if (isNewCallForTransaction &&
                                    !renderSentToClient &&
                                    (0, actions_1.isBackgroundable)(transaction.action) &&
                                    !transaction.action.developerId) {
                                    logger_1.logger.verbose('No client to send IO call to, notifying action runner', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                    });
                                    return (0, notify_2.default)({
                                        message: `${transaction.action.metadata?.name ?? 'An action'} requires your input before it can continue.`,
                                        title: 'Input required',
                                        transaction: transaction,
                                        environment: 'PRODUCTION',
                                        organization: transaction.action.organization,
                                        deliveryInstructions: [{ to: transaction.owner.email }],
                                        createdAt: new Date().toISOString(),
                                        idempotencyKey: `${transaction.id}_AWAITING_INPUT_${callKey}`,
                                    }).catch(error => {
                                        logger_1.logger.error('Failed sending notification to action runner', {
                                            transactionId: transaction.id,
                                            to: transaction.owner.email,
                                            error,
                                            instanceId: ws.id,
                                            organizationId: auth?.organization?.id,
                                        });
                                    });
                                }
                            })
                                .catch(error => {
                                logger_1.logger.error('Failed render call to client', {
                                    transactionId: transaction.id,
                                    error,
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                            });
                        }
                        return true;
                    },
                    SEND_LOADING_CALL: async (inputs) => {
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('SEND_LOADING_CALL: No auth', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(ws.id);
                        if (!host ||
                            host.user.id !== auth.user.id ||
                            host.organization.id !== auth.organization.id) {
                            logger_1.logger.info('SEND_LOADING_CALL: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const transaction = await prisma_1.default.transaction.findUnique({
                            where: { id: inputs.transactionId },
                            include: {
                                hostInstance: true,
                            },
                        });
                        const sockets = processVars_1.pageSockets.get(inputs.transactionId);
                        if (!sockets && !transaction) {
                            logger_1.logger.info('SEND_LOADING_CALL: Not found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const clientId = transaction?.currentClientId ?? sockets?.clientId;
                        if (transaction &&
                            (transaction.status === 'COMPLETED' ||
                                transaction.status === 'HOST_CONNECTION_DROPPED')) {
                            logger_1.logger.info('SEND_LOADING_CALL: Received loading call for completed transaction, dropping', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: transaction.id,
                            });
                            return false;
                        }
                        if (inputs.title !== undefined && inputs.label === undefined) {
                            inputs.label = inputs.title;
                        }
                        processVars_1.transactionLoadingStates.set(inputs.transactionId, inputs);
                        if (!inputs.skipClientCall && clientId) {
                            const client = processVars_1.connectedClients.get(clientId);
                            if (client) {
                                client.rpc.send('LOADING_STATE', inputs).catch(error => {
                                    logger_1.logger.warn('Failed sending LOADING_STATE call to client', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        clientId,
                                        transactionId: inputs.transactionId,
                                        error,
                                    });
                                });
                            }
                        }
                        else {
                            logger_1.logger.verbose('No client to send LOADING call to', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: inputs.transactionId,
                            });
                        }
                        return true;
                    },
                    SEND_LOG: async (inputs) => {
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('SEND_LOG: No auth', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(ws.id);
                        if (!host ||
                            host.user.id !== auth.user.id ||
                            host.organization.id !== auth.organization.id) {
                            logger_1.logger.info('SEND_LOG: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const transaction = await prisma_1.default.transaction.findUnique({
                            where: { id: inputs.transactionId },
                            include: {
                                logs: true,
                            },
                        });
                        if (!transaction) {
                            logger_1.logger.info('SEND_LOG: Not found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const log = await prisma_1.default.transactionLog.create({
                            data: {
                                transactionId: transaction.id,
                                data: inputs.data,
                                createdAt: inputs.timestamp
                                    ? new Date(inputs.timestamp)
                                    : undefined,
                                index: inputs.index ?? transaction.logs.length,
                            },
                        });
                        if (!inputs.skipClientCall && transaction.currentClientId) {
                            const client = processVars_1.connectedClients.get(transaction.currentClientId);
                            if (client) {
                                client.rpc
                                    .send('LOG', {
                                    transactionId: transaction.id,
                                    data: log.data,
                                    timestamp: log.createdAt.valueOf(),
                                    index: log.index,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending LOG call to client', {
                                        instanceId: ws.id,
                                        organizationId: auth?.organization?.id,
                                        transactionId: transaction.id,
                                        currentClientId: transaction.currentClientId,
                                        error,
                                    });
                                });
                            }
                        }
                        else {
                            logger_1.logger.verbose('No client to send LOG call to', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                transactionId: transaction.id,
                            });
                        }
                        return true;
                    },
                    NOTIFY: async (inputs) => {
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('NOTIFY: No auth', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const client = processVars_1.connectedClients.get(ws.id);
                        const host = processVars_1.connectedHosts.get(ws.id);
                        const validHost = auth.apiKey &&
                            host &&
                            host.user.id === auth.user.id &&
                            host.organization.id === auth.organization.id;
                        const validClient = !auth.apiKey && client && client.user.id === auth.user.id;
                        if (!validHost && !validClient) {
                            logger_1.logger.info('NOTIFY: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const transaction = await prisma_1.default.transaction.findUnique({
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
                        if (!transaction) {
                            logger_1.logger.info('NOTIFY: Transaction not found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        if (transaction.action.organizationId !== auth.organization.id) {
                            logger_1.logger.info('NOTIFY: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const environment = transaction.action.developerId
                            ? 'DEVELOPMENT'
                            : 'PRODUCTION';
                        await (0, notify_2.default)({
                            message: inputs.message,
                            title: inputs.title,
                            transaction: transaction,
                            environment,
                            organization: transaction.action.organization,
                            deliveryInstructions: inputs.deliveryInstructions,
                            createdAt: inputs.createdAt,
                        });
                        return true;
                    },
                    SEND_REDIRECT: async (inputs) => {
                        if (!auth || !auth.organization) {
                            logger_1.logger.info('SEND_REDIRECT: No auth', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        const host = processVars_1.connectedHosts.get(ws.id);
                        if (!host ||
                            host.user.id !== auth.user.id ||
                            host.organization.id !== auth.organization.id) {
                            logger_1.logger.info('SEND_REDIRECT: Forbidden', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            return false;
                        }
                        if ('action' in inputs && !('route' in inputs)) {
                            const { action, params, ...rest } = inputs;
                            inputs = { ...rest, route: action, params };
                        }
                        try {
                            const transaction = await prisma_1.default.transaction.update({
                                where: { id: inputs.transactionId },
                                data: {
                                    resultStatus: 'REDIRECTED',
                                },
                                include: {
                                    hostInstance: true,
                                },
                            });
                            if (inputs.skipClientCall)
                                return true;
                            processVars_1.transactionRedirects.set(transaction.id, inputs);
                            if (transaction.currentClientId) {
                                const client = processVars_1.connectedClients.get(transaction.currentClientId);
                                if (client) {
                                    client.rpc
                                        .send('REDIRECT', inputs)
                                        .then(() => {
                                        // To allow redirecting back afterward, like in an OAuth flow
                                        //
                                        // This basically means that redirects only happen once;
                                        // as soon as the redirect happens to a single client,
                                        // any subsequent clients that might visit the in-progress
                                        // transaction will not receive the same redirect call
                                        processVars_1.transactionRedirects.delete(transaction.id);
                                    })
                                        .catch(error => {
                                        logger_1.logger.warn('Failed sending REDIRECT call to client', {
                                            instanceId: ws.id,
                                            organizationId: auth?.organization?.id,
                                            transactionId: transaction.id,
                                            currentClientId: transaction.currentClientId,
                                            error,
                                        });
                                    });
                                }
                            }
                            else {
                                logger_1.logger.verbose('No client to send REDIRECT call to', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    transactionId: transaction.id,
                                });
                            }
                            return true;
                        }
                        catch (error) {
                            // Transaction doesn't exist
                            const sockets = processVars_1.pageSockets.get(inputs.transactionId);
                            if (sockets) {
                                const client = processVars_1.connectedClients.get(sockets.clientId);
                                if (inputs.skipClientCall)
                                    return true;
                                processVars_1.transactionRedirects.set(inputs.transactionId, inputs);
                                if (client) {
                                    client.rpc
                                        .send('REDIRECT', inputs)
                                        .then(() => {
                                        // To allow redirecting back afterward, like in an OAuth flow
                                        //
                                        // This basically means that redirects only happen once;
                                        // as soon as the redirect happens to a single client,
                                        // any subsequent clients that might visit the in-progress
                                        // transaction will not receive the same redirect call
                                        processVars_1.transactionRedirects.delete(inputs.transactionId);
                                    })
                                        .catch(error => {
                                        logger_1.logger.warn('Failed sending REDIRECT call to client', {
                                            instanceId: ws.id,
                                            organizationId: auth?.organization?.id,
                                            error,
                                        });
                                    });
                                }
                                return true;
                            }
                            const level = host.usageEnvironment === 'PRODUCTION' ? 'error' : 'warn';
                            logger_1.logger.log(level, 'SEND_REDIRECT: Not found', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                error,
                            });
                            return false;
                        }
                    },
                },
            });
            rpc.onMessageReceived.attach(message => {
                // Don't count RESPONSEs toward a client's rate limit
                if (message.kind === 'RESPONSE') {
                    messageRateLimitCount--;
                    return;
                }
                const key = message.methodName;
                messageRateLimitTypeCounts.set(key, (messageRateLimitTypeCounts.get(key) ?? 0) + 1);
            });
            let lastSuccessfulPing = new Date();
            // Heartbeat ping every 30 seconds
            heartbeatInterval = setInterval(async () => {
                try {
                    await ws.ping();
                    lastSuccessfulPing = new Date();
                    if (processVars_1.connectedHosts.has(ws.id)) {
                        try {
                            // doing these statuses separately to avoid changing status
                            await prisma_1.default.hostInstance.updateMany({
                                where: {
                                    id: ws.id,
                                    status: {
                                        not: 'SHUTTING_DOWN',
                                    },
                                },
                                data: {
                                    status: 'ONLINE',
                                },
                            });
                            await prisma_1.default.hostInstance.updateMany({
                                where: {
                                    id: ws.id,
                                    status: 'SHUTTING_DOWN',
                                },
                                data: {
                                    status: 'SHUTTING_DOWN',
                                },
                            });
                        }
                        catch (error) {
                            logger_1.logger.error('Failed touching host instance', {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                error,
                            });
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.warn('Pong not received in time', {
                        instanceId: ws.id,
                        organizationId: auth?.organization?.id,
                        error,
                    });
                    if (ws.readyState === WebSocketState.CLOSED) {
                        handleClose();
                    }
                    if (processVars_1.connectedHosts.has(ws.id)) {
                        try {
                            const hostInstance = await prisma_1.default.hostInstance.findUnique({
                                where: { id: ws.id },
                            });
                            const sixHoursAgo = new Date();
                            sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
                            if (!hostInstance) {
                                logger_1.logger.info('No host instance found for ID, closing connection', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                });
                                ws.close();
                            }
                            else if (hostInstance.updatedAt < sixHoursAgo) {
                                logger_1.logger.info('Host unreachable for longer than 6h, closing connection', {
                                    instanceId: ws.id,
                                    organizationId: auth?.organization?.id,
                                    updatedAt: hostInstance.updatedAt,
                                });
                                ws.close();
                            }
                        }
                        catch (error) {
                            logger_1.logger.error(`Failed closing connection`, {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                                error,
                            });
                            await handleClose();
                        }
                    }
                    else if (processVars_1.connectedClients.has(ws.id)) {
                        logger_1.logger.debug('Failed ping to client', {
                            instanceId: ws.id,
                            organizationId: auth?.organization?.id,
                        });
                        const now = new Date();
                        const closeAfterNoPingMs = 60_000;
                        // no successful ping in last minute
                        if (now.valueOf() - lastSuccessfulPing.valueOf() >
                            closeAfterNoPingMs) {
                            logger_1.logger.info(`No successful ping to client in last ${closeAfterNoPingMs / 1000}s, closing connection to client`, {
                                instanceId: ws.id,
                                organizationId: auth?.organization?.id,
                            });
                            ws.close();
                        }
                    }
                }
            }, 30_000);
        }
        catch (error) {
            logger_1.logger.error('Error in websocket connection handler, closing connection...', {
                instanceId: ws.id,
                error,
            });
            try {
                ws.close();
            }
            catch (error) {
                logger_1.logger.error('Failed closing connection', {
                    instanceId: ws.id,
                    error,
                });
            }
        }
        async function handleClose(data) {
            if (closed)
                return;
            closed = true;
            const client = processVars_1.connectedClients.get(ws.id);
            const host = processVars_1.connectedHosts.get(ws.id);
            const logProps = {
                instanceId: ws.id,
                code: data?.[0],
                reason: data?.[1],
            };
            if (host) {
                logProps.connectionType = 'host';
                logProps.sdkName = host.sdkName;
                logProps.sdkVersion = host.sdkVersion;
                logProps.environment = host.usageEnvironment;
                logProps.organizationEnvironmentId = host.organizationEnvironment?.id;
                logProps.apiKeyId = host.apiKeyId;
                logProps.organizationId = host.organization.id;
            }
            else if (client) {
                logProps.connectionType = 'client';
                logProps.organizationId = client.organization.id;
                logProps.userId = client.user.id;
                logProps.organizationEnvironmentId = client.organizationEnvironment?.id;
            }
            logger_1.logger.info('🧹 Cleaning up on close...', logProps);
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = undefined;
            }
            if (messageRateLimitInterval) {
                clearInterval(messageRateLimitInterval);
                messageRateLimitInterval = undefined;
            }
            if (recentlyOpenedLivePagesInterval) {
                clearInterval(recentlyOpenedLivePagesInterval);
                recentlyOpenedLivePagesInterval = undefined;
            }
            try {
                if (client) {
                    for (const pageKey of client.pageKeys.values()) {
                        const sockets = processVars_1.pageSockets.get(pageKey);
                        if (sockets) {
                            const host = processVars_1.connectedHosts.get(sockets.hostId);
                            if (host) {
                                host.rpc
                                    .send('CLOSE_PAGE', {
                                    pageKey,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending CLOSE_PAGE to host', {
                                        instanceId: ws.id,
                                        pageKey,
                                        error,
                                        usageEnvironment: host.usageEnvironment,
                                    });
                                });
                            }
                            else {
                                logger_1.logger.info('Connected host not found for pageKey', {
                                    instanceId: ws.id,
                                    pageKey,
                                });
                            }
                            processVars_1.pageSockets.delete(pageKey);
                        }
                        else {
                            logger_1.logger.info('No connected sockets found for pageKey', {
                                instanceId: ws.id,
                                pageKey,
                            });
                        }
                    }
                    processVars_1.connectedClients.delete(ws.id);
                    processVars_1.userClientIds.get(client.user.id)?.delete(ws.id);
                    const transactions = await prisma_1.default.transaction.findMany({
                        where: {
                            currentClientId: ws.id,
                            status: {
                                in: ['RUNNING', 'PENDING', 'AWAITING_INPUT'],
                            },
                            resultStatus: null,
                        },
                        include: {
                            action: {
                                include: {
                                    metadata: true,
                                },
                            },
                        },
                    });
                    if (transactions.length > 0) {
                        // Close non-backgroundable transactions
                        const nonBackgroundable = [];
                        for (const transaction of transactions) {
                            const { action } = transaction;
                            if (!(0, actions_1.isBackgroundable)(action)) {
                                nonBackgroundable.push(transaction);
                            }
                        }
                        await prisma_1.default.transaction.updateMany({
                            where: {
                                id: {
                                    in: nonBackgroundable.map(t => t.id),
                                },
                            },
                            data: {
                                status: 'CLIENT_CONNECTION_DROPPED',
                            },
                        });
                    }
                    await prisma_1.default.transaction.updateMany({
                        where: { currentClientId: ws.id },
                        data: { currentClientId: null },
                    });
                }
                else if (host) {
                    processVars_1.connectedHosts.delete(ws.id);
                    processVars_1.apiKeyHostIds.get(host.apiKeyId)?.delete(ws.id);
                    let inProgressTransactions;
                    if (host.usageEnvironment === 'DEVELOPMENT') {
                        inProgressTransactions = await prisma_1.default.transaction.findMany({
                            where: {
                                hostInstance: { id: ws.id },
                            },
                        });
                        // delete existing development transactions
                        await prisma_1.default.transaction.deleteMany({
                            where: {
                                id: { in: inProgressTransactions.map(t => t.id) },
                            },
                        });
                        // delete existing development queued actions
                        await prisma_1.default.queuedAction.deleteMany({
                            where: {
                                action: {
                                    hostInstances: {
                                        some: {
                                            id: ws.id,
                                        },
                                    },
                                },
                            },
                        });
                        // delete development host instance
                        await prisma_1.default.hostInstance.delete({
                            where: {
                                id: ws.id,
                            },
                        });
                    }
                    else {
                        inProgressTransactions = await prisma_1.default.transaction.findMany({
                            where: {
                                hostInstance: { id: ws.id },
                                status: { in: ['PENDING', 'RUNNING', 'AWAITING_INPUT'] },
                            },
                        });
                        // mark all transactions as dropped
                        await prisma_1.default.transaction.updateMany({
                            where: {
                                id: { in: inProgressTransactions.map(t => t.id) },
                            },
                            data: { status: 'HOST_CONNECTION_DROPPED' },
                        });
                        try {
                            await prisma_1.default.hostInstance.delete({
                                where: { id: ws.id },
                            });
                        }
                        catch (error) {
                            // swallow these in development to allow for cleaning up test data
                            if (process.env.NODE_ENV === 'production') {
                                throw error;
                            }
                        }
                    }
                    for (const t of inProgressTransactions) {
                        (0, transactions_1.freeTransactionCalls)(t);
                        if (t.currentClientId) {
                            const client = processVars_1.connectedClients.get(t.currentClientId);
                            if (client) {
                                client.rpc
                                    .send('HOST_CLOSED_UNEXPECTEDLY', {
                                    transactionId: t.id,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending closed message to client', {
                                        instanceId: ws.id,
                                        error,
                                    });
                                });
                            }
                        }
                    }
                    for (const pageKey of host.pageKeys.values()) {
                        const sockets = processVars_1.pageSockets.get(pageKey);
                        if (sockets) {
                            const client = processVars_1.connectedClients.get(sockets.clientId);
                            if (client) {
                                client.rpc
                                    .send('HOST_CLOSED_UNEXPECTEDLY', {
                                    transactionId: pageKey,
                                })
                                    .catch(error => {
                                    logger_1.logger.warn('Failed sending closed message to client', {
                                        instanceId: ws.id,
                                        error,
                                    });
                                });
                            }
                        }
                    }
                }
            }
            catch (error) {
                logger_1.logger.error('Failed cleaning up on websocket connection close', {
                    instanceId: ws.id,
                    error,
                });
            }
        }
    });
}
exports.setupWebSocketServer = setupWebSocketServer;
/**
 * Set all hosts as UNREACHABLE if they haven't been touched
 * in the last minute. The periodic heartbeat will bump
 * this while the host is connected.
 */
async function checkForUnreachableHosts() {
    try {
        // Do this with a raw query in order to use database time
        // instead of server time.
        await prisma_1.default.$queryRaw `
    update "HostInstance"
    set status = 'UNREACHABLE'
    where status = 'ONLINE'
    and "updatedAt" < (now() - '00:01:00'::interval)
    `;
        await prisma_1.default.$queryRaw `
    delete from "HostInstance"
    where status in ('UNREACHABLE', 'OFFLINE')
    and "updatedAt" < (now() - '06:00:00'::interval)
    `;
    }
    catch (error) {
        logger_1.logger.error('Failed checking for unreachable hosts', {
            error,
        });
    }
}
