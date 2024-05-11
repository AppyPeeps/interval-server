"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotificationToConnectedClient = void 0;
const logger_1 = require("../server/utils/logger");
const processVars_1 = require("./processVars");
/**
 * This will only work as expected if called from the same server
 * that's hosting the websocket connection for the transaction and client.
 * Be careful when calling if performing horizontal server scaling.
 */
async function sendNotificationToConnectedClient(transaction, notification) {
    if (transaction.currentClientId) {
        const client = processVars_1.connectedClients.get(transaction.currentClientId);
        if (client) {
            client.rpc
                .send('NOTIFY', {
                transactionId: transaction.id,
                message: notification.message,
                title: notification.title ?? undefined,
                deliveries: notification.notificationDeliveries.map(delivery => ({
                    to: delivery.to ?? undefined,
                    method: delivery.method ?? undefined,
                })),
            })
                .catch(error => {
                logger_1.logger.error('Failed sending notify call to client', {
                    transactionId: transaction.id,
                    error,
                });
            });
            return;
        }
    }
    logger_1.logger.warn('No client to send notify call to', {
        transactionId: transaction.id,
    });
}
exports.sendNotificationToConnectedClient = sendNotificationToConnectedClient;
