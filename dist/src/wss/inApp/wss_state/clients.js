"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@interval/sdk");
const processVars_1 = require("../../../wss/processVars");
const logger_1 = require("../../../server/utils/logger");
const prisma_1 = __importDefault(require("../../../server/prisma"));
exports.default = new sdk_1.Page({
    name: 'Clients',
    handler: async () => {
        let clientData = Array.from(processVars_1.connectedClients.values());
        let userClientData = Array.from(processVars_1.userClientIds.entries()).map(([userId, clientIds]) => {
            let user;
            const clientId = clientIds.values().next().value;
            if (clientId) {
                user = processVars_1.connectedClients.get(clientId)?.user;
            }
            return {
                userId,
                user,
                clients: clientIds.size,
            };
        });
        if (sdk_1.ctx.params.userId && typeof sdk_1.ctx.params.userId === 'string') {
            clientData = clientData.filter(h => h.user.id === sdk_1.ctx.params.userId);
            userClientData = userClientData.filter(h => h.userId === sdk_1.ctx.params.userId);
        }
        return new sdk_1.Layout({
            children: [
                sdk_1.io.display.table('Connected clients', {
                    data: clientData,
                    columns: [
                        {
                            label: 'ID',
                            renderCell: row => row.ws.id,
                        },
                        {
                            label: 'Organization',
                            renderCell: row => row.organization?.name,
                        },
                        {
                            label: 'User ID',
                            renderCell: row => row.user.id,
                        },
                        {
                            label: 'User email',
                            renderCell: row => row.user.email,
                        },
                    ],
                    rowMenuItems: row => [
                        {
                            label: 'Drop connection',
                            route: 'dump_wss_state/clients/drop_client_connection',
                            params: {
                                id: row.ws.id,
                            },
                        },
                    ],
                }),
                sdk_1.io.display.table('Connected users', {
                    data: userClientData,
                    columns: [
                        {
                            label: 'ID',
                            accessorKey: 'userId',
                        },
                        {
                            label: 'Email',
                            renderCell: row => row.user?.email,
                        },
                        {
                            label: 'Connected clients',
                            accessorKey: 'clients',
                        },
                    ],
                    rowMenuItems: row => [
                        {
                            label: 'Disable and drop connections',
                            route: 'dump_wss_state/clients/disable_user_drop_connections',
                            params: {
                                id: row.userId,
                            },
                        },
                    ],
                }),
            ],
        });
    },
    routes: {
        drop_client_connection: new sdk_1.Action({
            name: 'Drop client connection',
            unlisted: true,
            handler: async () => {
                const id = sdk_1.ctx.params.id;
                if (!id || typeof id !== 'string') {
                    throw new Error('Invalid param id');
                }
                const identityConfirmed = await sdk_1.io.confirmIdentity('Confirm you can do this');
                if (!identityConfirmed)
                    throw new Error('Unauthorized');
                const connectedClient = processVars_1.connectedClients.get(id);
                if (!connectedClient)
                    throw new Error('Not found');
                const { rpc, ws, pageKeys, ...rest } = connectedClient;
                await sdk_1.io.display.object('Connected client', {
                    data: rest,
                });
                const addToBlocklist = await sdk_1.io.input.boolean('Add client to blocklist to prevent reconnection?');
                const confirmed = await sdk_1.io.confirm('Are you sure you want to drop this connection?', {
                    helpText: addToBlocklist
                        ? 'They should not be able to reconnect, but disable user if necessary to make sure.'
                        : 'They should reconnect automatically without being added to blocklist.',
                });
                if (!confirmed)
                    return 'Unconfirmed, nothing to do.';
                console.log('Manually closing host connection for ID', id);
                if (addToBlocklist) {
                    processVars_1.blockedWsIds.add(connectedClient.ws.id);
                }
                connectedClient.ws.close(1008, 'Manually closed due to misbehavior.');
            },
        }),
        disable_user_drop_connections: new sdk_1.Action({
            name: 'Disable user account, drop connections',
            unlisted: true,
            handler: async () => {
                const id = sdk_1.ctx.params.id;
                if (!id || typeof id !== 'string') {
                    throw new Error('Invalid param id');
                }
                const identityConfirmed = await sdk_1.io.confirmIdentity('Confirm you can do this');
                if (!identityConfirmed)
                    throw new Error('Unauthorized');
                const user = await prisma_1.default.user.findUniqueOrThrow({
                    where: {
                        id,
                    },
                });
                const clientIds = processVars_1.userClientIds.get(id) ?? new Set();
                await sdk_1.io.display.object('User', {
                    data: user,
                });
                await sdk_1.io.display.metadata('', {
                    data: [{ label: 'Client connections', value: clientIds.size }],
                });
                const confirmed = await sdk_1.io.confirm('Are you sure you want to disable this user and drop all of its connections?');
                if (!confirmed)
                    return 'Unconfirmed, nothing to do.';
                await sdk_1.ctx.loading.start({
                    label: 'Disabling user',
                });
                await prisma_1.default.user.update({
                    where: {
                        id: user.id,
                    },
                    data: {
                        deletedAt: new Date(),
                    },
                });
                await prisma_1.default.userSession.deleteMany({
                    where: {
                        userId: user.id,
                    },
                });
                if (clientIds.size) {
                    await sdk_1.ctx.loading.start({
                        label: 'Dropping connections',
                        itemsInQueue: clientIds.size,
                    });
                    for (const clientId of clientIds) {
                        const client = processVars_1.connectedClients.get(clientId);
                        if (client) {
                            logger_1.logger.info('Manually closing client connection', { clientId });
                            client.ws.close(1008, 'Manually closed due to misbehavior.');
                        }
                        else {
                            await sdk_1.ctx.log(`No connected host found for ID ${clientId}`);
                        }
                        await sdk_1.ctx.loading.completeOne();
                    }
                }
            },
        }),
    },
});
