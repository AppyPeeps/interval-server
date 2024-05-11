"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizePotentialGhostRequest = void 0;
const server_1 = require("@trpc/server");
const environments_1 = require("../../utils/environments");
const permissions_1 = require("../../utils/permissions");
const prisma_1 = __importDefault(require("../prisma"));
// manually specifying the minimum required to authorize
async function authorizePotentialGhostRequest(ctx, requiredPermission) {
    const { userOrganizationAccess, user, organizationId, organizationEnvironmentId, organizationEnvironment, } = ctx;
    const userId = user?.id;
    if (userOrganizationAccess) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, requiredPermission)) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        if (userId && organizationId && organizationEnvironmentId) {
            return {
                userId,
                organizationId,
                userOrganizationAccess,
                organizationEnvironmentId,
                organizationEnvironment,
            };
        }
    }
    // As a last resort, we should see if the org is a ghost org
    if (organizationId) {
        const org = await prisma_1.default.organization.findUnique({
            where: { id: organizationId },
            include: {
                environments: true,
            },
        });
        const orgEnv = org?.environments.find(env => env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG);
        if (!org || !org.isGhostMode || !orgEnv) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return {
            organizationId: org.id,
            userId: org.ownerId,
            organizationEnvironmentId: orgEnv.id,
        };
    }
    throw new server_1.TRPCError({ code: 'UNAUTHORIZED' });
}
exports.authorizePotentialGhostRequest = authorizePotentialGhostRequest;
