"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizationAccess = exports.createOrganization = exports.isSlugAvailable = void 0;
const prisma_1 = __importDefault(require("../prisma"));
const routes_1 = require("../../server/utils/routes");
const validate_1 = require("../../utils/validate");
const server_1 = require("@trpc/server");
const environments_1 = require("../../utils/environments");
async function isSlugAvailable(slug, existingOrganizationId) {
    if (!(0, validate_1.isOrgSlugValid)(slug))
        return false;
    if (routes_1.dashboardL1Paths.has(slug))
        return false;
    const org = await prisma_1.default.organization.findFirst({
        where: {
            id: existingOrganizationId
                ? {
                    not: existingOrganizationId,
                }
                : undefined,
            slug,
        },
    });
    return !org;
}
exports.isSlugAvailable = isSlugAvailable;
async function createOrganization({ name, slug, ownerId, promoCode, createAccess = true, }) {
    const organizationPromoCode = promoCode
        ? { connect: { code: promoCode.code } }
        : undefined;
    const organization = await prisma_1.default.organization.create({
        data: {
            name,
            slug,
            organizationPromoCode,
            owner: { connect: { id: ownerId } },
            private: { create: {} },
            environments: {
                createMany: {
                    data: [
                        { name: environments_1.PRODUCTION_ORG_ENV_NAME, slug: environments_1.PRODUCTION_ORG_ENV_SLUG },
                        { name: environments_1.DEVELOPMENT_ORG_ENV_NAME, slug: environments_1.DEVELOPMENT_ORG_ENV_SLUG },
                    ],
                },
            },
            userOrganizationAccess: createAccess
                ? {
                    create: {
                        permissions: ['ADMIN'],
                        user: { connect: { id: ownerId } },
                    },
                }
                : undefined,
        },
    });
    return organization;
}
exports.createOrganization = createOrganization;
async function getOrganizationAccess(userId, orgSlug) {
    const access = await prisma_1.default.userOrganizationAccess.findFirst({
        where: {
            userId: userId,
            organization: { slug: orgSlug },
        },
        include: {
            organization: true,
        },
    });
    if (!access) {
        throw new server_1.TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
        });
    }
    return access;
}
exports.getOrganizationAccess = getOrganizationAccess;
