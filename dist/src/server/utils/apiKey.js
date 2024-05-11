"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevKey = void 0;
const server_1 = require("@trpc/server");
const permissions_1 = require("../../utils/permissions");
const auth_1 = require("../../server/auth");
const prisma_1 = __importDefault(require("../../server/prisma"));
const environments_1 = require("../../utils/environments");
const logger_1 = require("../../server/utils/logger");
async function getDevKey({ user, organizationId, userOrganizationAccess, }) {
    let key = await prisma_1.default.apiKey.findFirst({
        where: {
            userId: user.id,
            organizationId,
            usageEnvironment: 'DEVELOPMENT',
            organizationEnvironment: { slug: environments_1.DEVELOPMENT_ORG_ENV_SLUG },
            deletedAt: null,
        },
    });
    if (!key) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'CREATE_DEV_API_KEYS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const orgEnv = await prisma_1.default.organizationEnvironment.findFirst({
            where: { slug: environments_1.DEVELOPMENT_ORG_ENV_SLUG, organizationId },
        });
        if (!orgEnv) {
            logger_1.logger.error('Development organization environment not found', {
                organizationId,
            });
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        key = await prisma_1.default.apiKey.create({
            data: {
                key: (0, auth_1.generateKey)(user, 'DEVELOPMENT'),
                userId: user.id,
                organizationId: organizationId,
                usageEnvironment: 'DEVELOPMENT',
                organizationEnvironmentId: orgEnv.id,
            },
        });
    }
    return key;
}
exports.getDevKey = getDevKey;
