"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkNotUnreachableHttpHosts = exports.checkUnreachableHttpHosts = exports.checkHttpHosts = exports.checkHttpHost = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const prisma_1 = __importDefault(require("../prisma"));
const logger_1 = require("../../server/utils/logger");
async function checkHttpHost(httpHost) {
    let success = false;
    try {
        const response = await (0, node_fetch_1.default)(httpHost.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                httpHostId: httpHost.id,
            }),
        });
        success = response.ok;
        if (!success) {
            logger_1.logger.error('checkHttpHost received unsuccessful status code for httpHost', {
                httpHostId: httpHost.id,
                responseStatus: response.status,
            });
        }
    }
    catch (error) {
        logger_1.logger.error('checkHttpHost failed to reach url for httpHost', {
            httpHostId: httpHost.id,
            error,
        });
    }
    return await prisma_1.default.httpHost.update({
        where: {
            id: httpHost.id,
        },
        data: {
            status: success ? 'ONLINE' : 'UNREACHABLE',
        },
    });
}
exports.checkHttpHost = checkHttpHost;
async function checkHttpHosts(where) {
    try {
        const hosts = await prisma_1.default.httpHost.findMany({
            where: {
                deletedAt: null,
                ...where,
            },
        });
        await Promise.all(hosts.map(async (host) => {
            await checkHttpHost(host);
            // TODO: Notify users when their actions are unreachable
        }));
    }
    catch (error) {
        logger_1.logger.error('checkHttpHosts encountered an error', { error });
    }
}
exports.checkHttpHosts = checkHttpHosts;
async function checkUnreachableHttpHosts() {
    return await checkHttpHosts({
        status: 'UNREACHABLE',
    });
}
exports.checkUnreachableHttpHosts = checkUnreachableHttpHosts;
async function checkNotUnreachableHttpHosts() {
    return await checkHttpHosts({
        status: {
            not: 'UNREACHABLE',
        },
    });
}
exports.checkNotUnreachableHttpHosts = checkNotUnreachableHttpHosts;
