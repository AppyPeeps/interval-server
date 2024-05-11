"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpHostsRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const util_1 = require("./util");
const permissions_1 = require("../../utils/permissions");
const hosts_1 = require("../utils/hosts");
const logger_1 = require("../../server/utils/logger");
exports.httpHostsRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('list', {
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId } }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const httpHosts = await prisma.httpHost.findMany({
            where: {
                organizationId,
                deletedAt: null,
            },
        });
        return httpHosts;
    },
})
    .mutation('add', {
    input: zod_1.z.object({
        url: zod_1.z.string().url(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { url }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        let created = false;
        let httpHost = await prisma.httpHost.findUnique({
            where: {
                organizationId_url: {
                    organizationId,
                    url,
                },
            },
        });
        if (httpHost) {
            if (httpHost.deletedAt) {
                httpHost = await prisma.httpHost.update({
                    where: {
                        id: httpHost.id,
                    },
                    data: {
                        deletedAt: null,
                    },
                });
            }
            else {
                throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
            }
        }
        else {
            try {
                httpHost = await prisma.httpHost.create({
                    data: {
                        status: 'OFFLINE',
                        organization: { connect: { id: organizationId } },
                        url,
                    },
                });
                created = true;
            }
            catch (error) {
                logger_1.logger.error('Failed to create HttpHost', { error });
            }
        }
        if (!httpHost) {
            console.error('Failed to create/find HttpHost??', {
                organizationId,
                url,
            });
            throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        httpHost = await (0, hosts_1.checkHttpHost)(httpHost);
        if (httpHost.status === 'UNREACHABLE') {
            // Host was unreachable/invalid, don't add it
            let deleted = false;
            if (created) {
                try {
                    // We should be able to actually delete here
                    await prisma.httpHost.delete({
                        where: {
                            id: httpHost.id,
                        },
                    });
                    deleted = true;
                }
                catch (err) {
                    console.error('Failed to delete httpHostId', httpHost.id, 'will soft delete');
                }
            }
            if (!deleted) {
                await prisma.httpHost.update({
                    where: {
                        id: httpHost.id,
                    },
                    data: {
                        deletedAt: new Date(),
                    },
                });
            }
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return httpHost;
    },
})
    .mutation('delete', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const httpHost = await prisma.httpHost.findUnique({
            where: {
                id,
            },
        });
        if (!httpHost ||
            httpHost.organizationId !== organizationId ||
            httpHost.deletedAt) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return await prisma.httpHost.update({
            where: {
                id,
            },
            data: {
                status: 'OFFLINE',
                deletedAt: new Date(),
            },
        });
    },
})
    .mutation('check', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'READ_PROD_ACTIONS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const httpHost = await prisma.httpHost.findUnique({
            where: {
                id,
            },
        });
        if (!httpHost ||
            httpHost.organizationId !== organizationId ||
            httpHost.deletedAt) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return await (0, hosts_1.checkHttpHost)(httpHost);
    },
});
