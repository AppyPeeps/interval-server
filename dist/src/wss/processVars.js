"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReadonlyWssState = exports.cloneSocket = exports.transactionRedirects = exports.transactionLoadingStates = exports.pendingIOCalls = exports.pageSockets = exports.userClientIds = exports.connectedClients = exports.apiKeyHostIds = exports.connectedHosts = exports.blockedWsIds = void 0;
exports.blockedWsIds = new Set();
exports.connectedHosts = new Map();
exports.apiKeyHostIds = new Map();
exports.connectedClients = new Map();
exports.userClientIds = new Map();
exports.pageSockets = new Map();
exports.pendingIOCalls = new Map();
exports.transactionLoadingStates = new Map();
exports.transactionRedirects = new Map();
function cloneSocket(socket) {
    return {
        id: socket.ws.id,
        user: socket.user,
        organization: socket.organization,
        usageEnvironment: socket.usageEnvironment,
    };
}
exports.cloneSocket = cloneSocket;
function getReadonlyWssState() {
    const ioCalls = {};
    const loadingStates = {};
    for (const [id, ioCall] of exports.pendingIOCalls.entries()) {
        ioCalls[id] = ioCall;
    }
    for (const [id, loadingState] of exports.transactionLoadingStates.entries()) {
        loadingStates[id] = loadingState;
    }
    return {
        connectedHosts: Array.from(exports.connectedHosts.values()).map(cloneSocket),
        connectedClients: Array.from(exports.connectedClients.values()).map(cloneSocket),
        pendingIOCalls: ioCalls,
        transactionLoadingStates: loadingStates,
    };
}
exports.getReadonlyWssState = getReadonlyWssState;
