"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInvitationGroupIds = exports.createUser = void 0;
const server_1 = require("@trpc/server");
const auth_1 = require("./auth");
const featureFlags_1 = require("./utils/featureFlags");
const organizations_1 = require("./utils/organizations");
const prisma_1 = __importDefault(require("./prisma"));
const examples_1 = require("../utils/examples");
const slugs_1 = require("./utils/slugs");
const logger_1 = require("../server/utils/logger");
const availableTemplates = examples_1.examples.map(item => item.id);
async function createUser({ data, password, organization, onboardingExampleSlug, referralInfo, intendedPlanName, invitation, }) {
    if (!(await (0, featureFlags_1.isFlagEnabled)('USER_REGISTRATION_ENABLED'))) {
        const create = {
            ...data,
            organizationName: organization?.new?.name,
        };
        await prisma_1.default.userWaitlistEntry.upsert({
            create,
            update: create,
            where: {
                email: data.email,
            },
        });
        throw new server_1.TRPCError({
            code: 'FORBIDDEN',
            message: 'New user registration is currently disabled.',
        });
    }
    let user;
    try {
        user = await prisma_1.default.user.create({
            data: {
                ...data,
                password: password ? (0, auth_1.encryptPassword)(password) : null,
            },
            select: {
                id: true,
                lastName: true,
                firstName: true,
                email: true,
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Failed creating account', { email: data.email, error: err });
        throw new server_1.TRPCError({
            code: 'BAD_REQUEST',
            message: 'An account already exists with that email.',
        });
    }
    let userOrganizationAccess;
    if (organization?.existing) {
        userOrganizationAccess = {
            organization: { connect: { id: organization.existing.id } },
            permissions: organization.existing.permissions,
        };
    }
    else {
        let slugBasis;
        let orgName;
        if (organization?.new?.name) {
            slugBasis = organization?.new?.name;
            orgName = organization?.new?.name;
        }
        else if (data.firstName || data.lastName) {
            slugBasis = `${data.firstName} ${data.lastName}`.trim();
            orgName = `${data.firstName}'s organization`;
        }
        else {
            // _very_ unlikely (you must provide one of the above to sign up).
            // throwing an error at this point would be tricky (user is already created).
            // in the event you somehow get here, assign a random 9-digit number as your org slug.
            slugBasis = Math.floor(100000000 + Math.random() * 900000000).toString();
            orgName = 'My organization';
        }
        const desiredSlug = (0, slugs_1.generateSlug)(slugBasis);
        const existingSlugs = (await prisma_1.default.organization.findMany({
            where: {
                slug: {
                    startsWith: desiredSlug,
                },
            },
            select: {
                slug: true,
            },
        })).map(org => org.slug);
        const slug = (0, slugs_1.getCollisionSafeSlug)(desiredSlug, existingSlugs);
        const newOrg = await (0, organizations_1.createOrganization)({
            name: orgName,
            promoCode: organization?.new?.promoCode || undefined,
            slug,
            ownerId: user.id,
            // We create it separately below
            createAccess: false,
            intendedPlanName,
        });
        userOrganizationAccess = {
            organization: { connect: { id: newOrg.id } },
            onboardingExampleSlug: onboardingExampleSlug &&
                availableTemplates.includes(onboardingExampleSlug)
                ? onboardingExampleSlug
                : undefined,
            permissions: ['ADMIN'],
        };
    }
    const access = await prisma_1.default.userOrganizationAccess.create({
        data: {
            ...userOrganizationAccess,
            user: { connect: { id: user.id } },
        },
        include: {
            organization: true,
            user: {
                select: {
                    id: true,
                    lastName: true,
                    firstName: true,
                    email: true,
                    mfaId: true,
                    organizations: {
                        include: {
                            environments: true,
                        },
                    },
                },
            },
        },
    });
    if (invitation) {
        await processInvitationGroupIds(invitation, access);
    }
    await prisma_1.default.userOutreachStatus.create({
        data: {
            user: { connect: { id: user.id } },
        },
    });
    // delete any open invitations for this user x organization
    await prisma_1.default.userOrganizationInvitation.deleteMany({
        where: {
            email: user.email,
            organizationId: access.organizationId,
        },
    });
    if (referralInfo && Object.values(referralInfo).some(val => val != null)) {
        await prisma_1.default.userReferralInfo.create({
            data: {
                user: { connect: { id: user.id } },
                ...referralInfo,
            },
        });
    }
    return access.user;
}
exports.createUser = createUser;
async function processInvitationGroupIds(invitation, access) {
    if (Array.isArray(invitation.groupIds)) {
        for (const groupId of invitation.groupIds) {
            try {
                await prisma_1.default.userAccessGroupMembership.create({
                    data: {
                        userOrganizationAccess: { connect: { id: access.id } },
                        group: { connect: { id: String(groupId) } },
                    },
                });
            }
            catch (error) {
                logger_1.logger.error('Failed to add invited user to group', {
                    userId: access.userId,
                    groupId,
                });
            }
        }
    }
}
exports.processInvitationGroupIds = processInvitationGroupIds;
