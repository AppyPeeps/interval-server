"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../../../../server/prisma"));
const env_1 = __importDefault(require("../../../../env"));
const _1 = require(".");
const auth_1 = require("../../../../server/auth");
const slugs_1 = require("../../../../server/utils/slugs");
const email_1 = require("../../../../utils/email");
const organizations_1 = require("../../../../server/utils/organizations");
const featureFlags_1 = require("../../../../server/utils/featureFlags");
const logger_1 = require("../../../../server/utils/logger");
async function callback(req, res) {
    if (!_1.isWorkOSEnabled || !_1.workos || !env_1.default.WORKOS_CLIENT_ID) {
        logger_1.logger.error('WorkOS credentials not found, aborting', {
            path: req.path,
        });
        return res.sendStatus(501);
    }
    const { code, state } = req.query;
    if (typeof code !== 'string') {
        res.status(400).end();
        return;
    }
    const { profile, access_token } = await _1.workos.sso.getProfileAndToken({
        code,
        clientID: env_1.default.WORKOS_CLIENT_ID,
    });
    const data = {
        idpId: profile.idp_id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
    };
    let invitationId = null;
    let transactionId = null;
    let intendedPlanName = null;
    try {
        if (state) {
            const parsedState = JSON.parse(String(state));
            if (parsedState.invitationId) {
                invitationId = parsedState.invitationId;
            }
            if (parsedState.transactionId) {
                transactionId = parsedState.transactionId;
            }
            if (parsedState.plan) {
                intendedPlanName = parsedState.plan;
            }
        }
    }
    catch (error) {
        /* no token in state */
    }
    if (transactionId) {
        const transaction = await prisma_1.default.transaction.findUnique({
            where: { id: transactionId },
            include: {
                owner: true,
                action: {
                    include: {
                        organizationEnvironment: true,
                        organization: true,
                    },
                },
            },
        });
        if (!transaction || transaction.owner.email !== data.email) {
            res.redirect(`/authentication-not-confirmed?confirmError=${encodeURIComponent(!transaction ? 'transaction-not-found' : 'wrong-user')}`);
            return;
        }
    }
    let isNewUser = false;
    let u = undefined;
    try {
        // Check for existing idpId first
        u = await prisma_1.default.user.update({
            where: {
                idpId: profile.idp_id,
            },
            data,
            select: {
                id: true,
                lastName: true,
                firstName: true,
                email: true,
                mfaId: true,
                deletedAt: true,
                userOrganizationAccess: {
                    select: {
                        organization: true,
                    },
                    orderBy: {
                        lastSwitchedToAt: 'desc',
                    },
                    take: 1,
                },
            },
        });
    }
    catch (err) {
        // Didn't exist
    }
    if (!u) {
        // If no idpId, check for existing email
        try {
            u = await prisma_1.default.user.update({
                where: {
                    email: profile.email,
                },
                data,
                // select redeclared inline here for static typing
                select: {
                    id: true,
                    lastName: true,
                    firstName: true,
                    email: true,
                    mfaId: true,
                    createdAt: true,
                    updatedAt: true,
                    deletedAt: true,
                    userOrganizationAccess: {
                        select: {
                            organization: true,
                        },
                        orderBy: {
                            lastSwitchedToAt: 'desc',
                        },
                        take: 1,
                    },
                },
            });
        }
        catch (err) {
            // Doesn't exist, no problem
        }
    }
    if (u && u.deletedAt) {
        logger_1.logger.info('Refusing SSO signin with disabled account', {
            userId: u.id,
            email: u.email,
            deletedAt: u.deletedAt,
        });
        return res.redirect('/signup?ACCOUNT_DISABLED');
    }
    if (!u) {
        if (!(await (0, featureFlags_1.isFlagEnabled)('USER_REGISTRATION_ENABLED'))) {
            const create = {
                email: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
            };
            await prisma_1.default.userWaitlistEntry.upsert({
                create,
                update: create,
                where: {
                    email: data.email,
                },
            });
            return res.redirect('/signup?REGISTRATION_DISABLED');
        }
        // Create if doesn't exist
        u = await prisma_1.default.user.create({
            data,
            // select redeclared inline here for static typing
            select: {
                id: true,
                lastName: true,
                firstName: true,
                email: true,
                mfaId: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                userOrganizationAccess: {
                    select: {
                        organization: true,
                    },
                    orderBy: {
                        lastSwitchedToAt: 'desc',
                    },
                    take: 1,
                },
            },
        });
        await prisma_1.default.userOutreachStatus.create({
            data: {
                user: { connect: { id: u.id } },
            },
        });
        isNewUser = true;
    }
    const { userOrganizationAccess, ...user } = u;
    let sso;
    if (profile.organization_id) {
        sso = await prisma_1.default.organizationSSO.findUnique({
            where: {
                workosOrganizationId: profile.organization_id,
            },
            include: {
                organization: true,
            },
        });
    }
    let orgSlug;
    if (sso) {
        let access = await prisma_1.default.userOrganizationAccess.findUnique({
            where: {
                userId_organizationId: {
                    userId: user.id,
                    organizationId: sso.organization.id,
                },
            },
        });
        if (!access) {
            access = await prisma_1.default.userOrganizationAccess.create({
                data: {
                    user: { connect: { id: user.id } },
                    organization: { connect: { id: sso.organization.id } },
                    permissions: sso.defaultUserPermissions,
                },
            });
        }
        orgSlug = sso.organization.slug;
    }
    else if (userOrganizationAccess.length) {
        orgSlug = userOrganizationAccess[0].organization.slug;
    }
    else {
        const domain = (0, email_1.getDomain)(user.email);
        if (!domain) {
            // Shouldn't actually happen, email format already validated
            res.status(500).end();
            return;
        }
        const sso = await prisma_1.default.organizationSSO.findFirst({
            where: {
                domain,
            },
        });
        let invitation = null;
        if (invitationId) {
            invitation = await prisma_1.default.userOrganizationInvitation.findFirst({
                where: { id: String(invitationId), email: user.email },
            });
        }
        if (sso) {
            const access = await prisma_1.default.userOrganizationAccess.create({
                data: {
                    permissions: sso.defaultUserPermissions,
                    user: { connect: { id: user.id } },
                    organization: { connect: { id: sso.organizationId } },
                },
                include: {
                    organization: true,
                },
            });
            orgSlug = access.organization.slug;
        }
        else if (invitation) {
            const access = await prisma_1.default.userOrganizationAccess.create({
                data: {
                    permissions: invitation.permissions,
                    user: { connect: { id: user.id } },
                    organization: { connect: { id: invitation.organizationId } },
                },
                include: {
                    organization: true,
                },
            });
            orgSlug = access.organization.slug;
        }
        else {
            const desiredSlug = (0, slugs_1.generateSlug)(`${user.firstName} ${user.lastName}`);
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
            await (0, organizations_1.createOrganization)({
                name: `${user.firstName}'s organization`,
                slug,
                ownerId: user.id,
                intendedPlanName,
            });
            orgSlug = slug;
        }
    }
    const session = await (0, auth_1.createUserSession)(user, {
        ssoAccessToken: access_token,
    });
    req.session.user = user;
    req.session.session = session;
    await req.session.save();
    if (user) {
        const fullUser = await prisma_1.default.user.findUnique({
            where: { email: user.email },
        });
        const requiredConfirmation = fullUser
            ? await (0, auth_1.requiredIdentityConfirmation)(fullUser)
            : null;
        const identityConfirmed = (sso && requiredConfirmation === 'SSO') ||
            (!sso && requiredConfirmation === 'LOGIN_WITH_GOOGLE');
        if (identityConfirmed) {
            try {
                const now = new Date();
                await prisma_1.default.userSession.update({
                    where: { id: session.id },
                    data: { identityConfirmedAt: now },
                });
                if (transactionId) {
                    await prisma_1.default.transactionRequirement.updateMany({
                        where: { transactionId, type: 'IDENTITY_CONFIRM' },
                        data: { satisfiedAt: now },
                    });
                }
            }
            catch (err) {
                console.log('SSO CALLBACK: Unable to confirm identity');
            }
        }
    }
    if (isNewUser) {
        res.redirect(`/confirm-signup/${orgSlug}`);
    }
    else if (transactionId) {
        res.redirect('/authentication-confirmed');
    }
    else {
        res.redirect(`/dashboard/${orgSlug}`);
    }
}
exports.default = callback;
