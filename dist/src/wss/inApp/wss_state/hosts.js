"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@interval/sdk");
const processVars_1 = require("../../../wss/processVars");
const prisma_1 = __importDefault(require("../../../server/prisma"));
const logger_1 = require("../../../server/utils/logger");
exports.default = new sdk_1.Page({
    name: 'Hosts',
    handler: async () => {
        let hostData = Array.from(processVars_1.connectedHosts.values());
        let apiKeyHostData = Array.from(processVars_1.apiKeyHostIds.entries()).map(([apiKeyId, hostIds]) => ({ apiKeyId, hosts: hostIds.size }));
        if (sdk_1.ctx.params.apiKeyId && typeof sdk_1.ctx.params.apiKeyId === 'string') {
            hostData = hostData.filter(h => h.apiKeyId === sdk_1.ctx.params.apiKeyId);
            apiKeyHostData = apiKeyHostData.filter(h => h.apiKeyId === sdk_1.ctx.params.apiKeyId);
        }
        return new sdk_1.Layout({
            children: [
                sdk_1.io.display.table('Connected hosts', {
                    data: hostData,
                    columns: [
                        {
                            label: 'ID',
                            renderCell: row => row.ws.id,
                        },
                        {
                            label: 'Organization',
                            renderCell: row => row.organization?.name,
                        },
                        'usageEnvironment',
                        {
                            label: 'API Key',
                            accessorKey: 'apiKeyId',
                        },
                    ],
                    rowMenuItems: row => [
                        {
                            label: 'Drop connection',
                            route: 'dump_wss_state/hosts/drop_host_connection',
                            params: {
                                id: row.ws.id,
                            },
                        },
                    ],
                }),
                sdk_1.io.display.table('Hosts by API Key', {
                    data: apiKeyHostData,
                    rowMenuItems: row => [
                        {
                            label: 'Disable and disconnect',
                            route: 'dump_wss_state/hosts/disable_api_key_and_disconnect',
                            params: {
                                id: row.apiKeyId,
                            },
                        },
                    ],
                }),
            ],
        });
    },
    routes: {
        drop_host_connection: new sdk_1.Action({
            name: 'Drop host connection',
            unlisted: true,
            handler: async () => {
                const id = sdk_1.ctx.params.id;
                if (!id || typeof id !== 'string') {
                    throw new Error('Invalid param id');
                }
                const identityConfirmed = await sdk_1.io.confirmIdentity('Confirm you can do this');
                if (!identityConfirmed)
                    throw new Error('Unauthorized');
                const connectedHost = processVars_1.connectedHosts.get(id);
                if (!connectedHost)
                    throw new Error('Not found');
                const { rpc, ws, pageKeys, ...rest } = connectedHost;
                await sdk_1.io.display.object('Connected host', {
                    data: rest,
                });
                const addToBlocklist = await sdk_1.io.input.boolean('Add host to blocklist to prevent reconnection?');
                const confirmed = await sdk_1.io.confirm('Are you sure you want to drop this connection?', {
                    helpText: addToBlocklist
                        ? 'They should not be able to reconnect, but disable API key if necessary to make sure.'
                        : 'They should reconnect automatically without being added to blocklist.',
                });
                if (!confirmed)
                    return 'Unconfirmed, nothing to do.';
                console.log('Manually closing host connection for ID', id);
                if (addToBlocklist) {
                    processVars_1.blockedWsIds.add(connectedHost.ws.id);
                }
                connectedHost.ws.close(1008, 'Manually closed due to misbehavior.');
            },
        }),
        disable_api_key_drop_connections: new sdk_1.Action({
            name: 'Disable API key, drop connections',
            unlisted: true,
            handler: async () => {
                const id = sdk_1.ctx.params.id;
                if (!id || typeof id !== 'string') {
                    throw new Error('Invalid param id');
                }
                const identityConfirmed = await sdk_1.io.confirmIdentity('Confirm you can do this');
                if (!identityConfirmed)
                    throw new Error('Unauthorized');
                const apiKey = await prisma_1.default.apiKey.findUniqueOrThrow({
                    where: {
                        id,
                    },
                });
                const hostIds = processVars_1.apiKeyHostIds.get(id) ?? new Set();
                await sdk_1.io.display.object('API Key', {
                    data: apiKey,
                });
                await sdk_1.io.display.metadata('', {
                    data: [{ label: 'Host connections', value: hostIds.size }],
                });
                const confirmed = await sdk_1.io.confirm('Are you sure you want to disable this API key and drop all of its connections?');
                if (!confirmed)
                    return 'Unconfirmed, nothing to do.';
                await sdk_1.ctx.loading.start({
                    label: 'Disabling key',
                });
                await prisma_1.default.apiKey.update({
                    where: {
                        id: apiKey.id,
                    },
                    data: {
                        deletedAt: new Date(),
                    },
                });
                if (hostIds.size) {
                    await sdk_1.ctx.loading.start({
                        label: 'Dropping connections',
                        itemsInQueue: hostIds.size,
                    });
                    for (const hostId of hostIds) {
                        const host = processVars_1.connectedHosts.get(hostId);
                        if (host) {
                            logger_1.logger.info('Manually closing host connection', { hostId });
                            host.ws.close(1008, 'Manually closed due to misbehavior.');
                        }
                        else {
                            await sdk_1.ctx.log(`No connected host found for ID ${hostId}`);
                        }
                        await sdk_1.ctx.loading.completeOne();
                    }
                }
            },
        }),
    },
});
