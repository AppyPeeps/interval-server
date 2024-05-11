"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOrCreateGhostOrg = void 0;
const express_1 = require("express");
const auth_1 = require("../../../../server/auth");
const featureFlags_1 = require("../../../../server/utils/featureFlags");
const environments_1 = require("../../../../utils/environments");
const prisma_1 = __importDefault(require("../../../prisma"));
const generateRandomSlug_1 = __importDefault(require("./generateRandomSlug"));
const anonRouter = (0, express_1.Router)();
async function createGhostApiKey(org) {
    const orgEnv = org.environments.find(env => env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG);
    if (!orgEnv) {
        throw new Error('Development organizationEnvironment not found');
    }
    const apiKey = await prisma_1.default.apiKey.create({
        data: {
            isGhostMode: true,
            userId: org.owner.id,
            organizationId: org.id,
            usageEnvironment: 'DEVELOPMENT',
            key: (0, auth_1.generateKey)(org.owner, 'DEVELOPMENT'),
            organizationEnvironmentId: orgEnv.id,
        },
    });
    return apiKey;
}
async function createGhostOrg(id) {
    const slug = (0, generateRandomSlug_1.default)();
    const org = await prisma_1.default.organization.create({
        data: {
            id,
            name: slug,
            isGhostMode: true,
            slug,
            owner: {
                create: {
                    isGhostMode: true,
                    email: `${slug}@example.com`,
                },
            },
            environments: {
                createMany: {
                    data: [
                        { name: environments_1.PRODUCTION_ORG_ENV_NAME, slug: environments_1.PRODUCTION_ORG_ENV_SLUG },
                        { name: environments_1.DEVELOPMENT_ORG_ENV_NAME, slug: environments_1.DEVELOPMENT_ORG_ENV_SLUG },
                    ],
                },
            },
        },
        include: {
            owner: true,
            environments: true,
        },
    });
    const apiKey = await createGhostApiKey(org);
    return { ...org, apiKey };
}
async function findOrCreateGhostOrg(id) {
    if (id) {
        const org = await prisma_1.default.organization.findUnique({
            where: { id },
            include: { owner: true, apiKeys: true, environments: true },
        });
        if (org) {
            if (!org.isGhostMode) {
                throw new Error(`The organization with id ${org.id} is not a ghost mode org`);
            }
            let apiKey = org.apiKeys[0];
            if (!apiKey) {
                apiKey = await createGhostApiKey(org);
            }
            return {
                organization: org,
                user: org.owner,
                apiKey,
            };
        }
    }
    const organization = await createGhostOrg(id);
    return {
        organization,
        user: organization.owner,
        apiKey: organization.apiKey,
    };
}
exports.findOrCreateGhostOrg = findOrCreateGhostOrg;
anonRouter.post('/create', async (req, res) => {
    const ghostModeEnabled = await (0, featureFlags_1.isFlagEnabled)('GHOST_MODE_ENABLED');
    if (!ghostModeEnabled) {
        return res.sendStatus(404);
    }
    const org = await createGhostOrg();
    const resp = {
        ghostOrgId: org.id,
    };
    return res.json(resp);
});
exports.default = anonRouter;
