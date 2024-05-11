"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFlagEnabled = void 0;
const featureFlags_1 = require("../../utils/featureFlags");
const prisma_1 = __importDefault(require("../prisma"));
async function isFlagEnabled(flagToCheck, organizationId) {
    const globalFeatureFlags = await prisma_1.default.globalFeatureFlag.findMany({
        where: {
            enabled: true,
        },
    });
    let organization;
    if (organizationId) {
        organization = await prisma_1.default.organization.findUnique({
            where: {
                id: organizationId,
            },
            include: {
                featureFlags: true,
            },
        });
    }
    return (0, featureFlags_1.isFeatureFlagEnabled)(flagToCheck, {
        globalFeatureFlags,
        organization,
    });
}
exports.isFlagEnabled = isFlagEnabled;
