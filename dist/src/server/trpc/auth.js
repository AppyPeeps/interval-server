"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const iron_session_1 = require("iron-session");
const util_1 = require("./util");
const auth_1 = require("../../server/auth");
const user_1 = require("../../server/user");
const emails_1 = require("../../emails");
const email_1 = require("../../utils/email");
const organizations_1 = require("../utils/organizations");
const permissions_1 = require("../../utils/permissions");
const auth_2 = require("../../utils/auth");
const referralSchema_1 = require("../../utils/referralSchema");
const logger_1 = require("../../server/utils/logger");
exports.authRouter = (0, util_1.createRouter)()
    .query('session.user', {
    async resolve({ ctx: { req } }) {
        if (req?.session.user) {
            return {
                email: req?.session.user?.email,
                meId: req?.session.user?.id,
                orgId: req?.session.currentOrganizationId,
                orgEnvId: req?.session.currentOrganizaitonEnvironmentId,
            };
        }
    },
})
    .query('session.session', {
    async resolve({ ctx: { req } }) {
        if (req?.session.session) {
            return {
                hasMfa: auth_1.isWorkOSEnabled && !!req.session.session.mfaChallengeId,
                hasSso: auth_1.isWorkOSEnabled && !!req.session.session.ssoAccessToken,
            };
        }
    },
})
    .query('check', {
    input: zod_1.z.object({
        email: zod_1.z.string().email(),
        transactionId: zod_1.z.string().optional(),
    }),
    async resolve({ ctx: { prisma, session }, input: { email, transactionId }, }) {
        const domain = (0, email_1.getDomain)(email);
        if (!domain) {
            throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
        }
        const user = await prisma.user.findUnique({
            where: {
                email,
            },
        });
        const needsMfa = !!user?.mfaId;
        const sso = (await prisma.organizationSSO.findFirst({
            where: {
                domain,
                workosOrganizationId: {
                    not: null,
                },
            },
        }));
        let gracePeriod = auth_1.defaultIdentityConfirmGracePeriod;
        if (transactionId) {
            const transaction = await prisma.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    requirements: {
                        where: { satisfiedAt: null, canceledAt: null },
                    },
                },
            });
            if (!transaction) {
                throw new server_1.TRPCError({ code: 'NOT_FOUND' });
            }
            if (transaction.requirements.length > 0 &&
                transaction.requirements[0].gracePeriodMs != null) {
                gracePeriod = transaction.requirements[0].gracePeriodMs;
            }
        }
        return {
            isWorkOSEnabled: auth_1.isWorkOSEnabled,
            sso,
            needsMfa,
            identityConfirmed: session?.identityConfirmedAt &&
                new Date().valueOf() -
                    new Date(session?.identityConfirmedAt).valueOf() <
                    gracePeriod,
        };
    },
})
    .mutation('mfa.challenge', {
    async resolve({ ctx: { req } }) {
        // We use req.session.user instead of ctx.user because
        // the session won't be valid before the MFA verification
        const user = req?.session?.user;
        if (!user) {
            throw new server_1.TRPCError({ code: 'UNAUTHORIZED' });
        }
        const { mfaId } = user;
        if (!mfaId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const challenge = await (0, auth_1.challengeMfa)(mfaId);
        return challenge.id;
    },
})
    .mutation('mfa.verify', {
    input: zod_1.z.object({
        challengeId: zod_1.z.string(),
        code: zod_1.z.string(),
        transactionId: zod_1.z.string().optional(),
    }),
    async resolve({ ctx: { req, prisma, user, session: dbSession }, input: { challengeId, code, transactionId }, }) {
        // We use req.session.session instead of ctx.session because
        // the session won't be valid before the MFA verification
        const session = req?.session?.session;
        if (!session) {
            throw new server_1.TRPCError({ code: 'UNAUTHORIZED' });
        }
        try {
            await (0, auth_1.verifyMfa)(challengeId, code, session);
            if (user) {
                const fullUser = await prisma.user.findUnique({
                    where: { email: user.email },
                });
                const requiredConfirmation = fullUser
                    ? await (0, auth_1.requiredIdentityConfirmation)(fullUser)
                    : null;
                if (requiredConfirmation === 'MFA') {
                    try {
                        const now = new Date();
                        if (dbSession) {
                            await prisma.userSession.update({
                                where: { id: dbSession.id },
                                data: { identityConfirmedAt: now },
                            });
                        }
                        if (transactionId) {
                            await prisma.transactionRequirement.updateMany({
                                where: { transactionId, type: 'IDENTITY_CONFIRM' },
                                data: { satisfiedAt: now },
                            });
                        }
                    }
                    catch (err) {
                        // Transaction doesn't exist
                        throw new server_1.TRPCError({
                            code: 'BAD_REQUEST',
                            cause: err,
                        });
                    }
                }
            }
            return true;
        }
        catch (err) {
            throw new server_1.TRPCError({ code: 'BAD_REQUEST', cause: err });
        }
    },
})
    .mutation('identity.confirm', {
    input: zod_1.z.object({
        transactionId: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, session }, input: { transactionId } }) {
        if (!session) {
            throw new server_1.TRPCError({ code: 'UNAUTHORIZED' });
        }
        try {
            const transaction = await prisma.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    requirements: {
                        where: { satisfiedAt: null, canceledAt: null },
                    },
                },
            });
            if (!transaction) {
                throw new server_1.TRPCError({ code: 'NOT_FOUND' });
            }
            const gracePeriod = transaction.requirements.length > 0 &&
                transaction.requirements[0].gracePeriodMs != null
                ? transaction.requirements[0].gracePeriodMs
                : auth_1.defaultIdentityConfirmGracePeriod;
            if (session.identityConfirmedAt &&
                new Date().valueOf() -
                    new Date(session.identityConfirmedAt).valueOf() <
                    gracePeriod) {
                const now = new Date();
                await prisma.transactionRequirement.updateMany({
                    where: { transactionId, type: 'IDENTITY_CONFIRM' },
                    data: { satisfiedAt: now },
                });
                return true;
            }
            else {
                return false;
            }
        }
        catch (err) {
            throw new server_1.TRPCError({ code: 'BAD_REQUEST', cause: err });
        }
    },
})
    .query('signup.check', {
    input: zod_1.z.object({
        invitationId: zod_1.z.string().nullish(),
    }),
    async resolve({ ctx: { prisma, user }, input: { invitationId } }) {
        let isLoginRequired = false;
        let isSignupRequired = false;
        let invitation = null;
        if (invitationId) {
            invitation = await prisma.userOrganizationInvitation.findUnique({
                where: { id: invitationId },
                select: {
                    id: true,
                    organizationId: true,
                    email: true,
                    organization: {
                        select: { name: true },
                    },
                },
            });
            if (!invitation) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Invalid invitation link.',
                });
            }
            if (user && invitation.email !== user.email) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Sorry, this invitation is for another email address. You are logged in as ${user.email}.`,
                });
            }
            // if not logged in and invitation is intended for an existing user
            if (!user) {
                const existingUser = await prisma.user.findUnique({
                    where: { email: invitation.email },
                    select: { id: true },
                });
                if (existingUser) {
                    isLoginRequired = true;
                }
                else {
                    isSignupRequired = true;
                }
            }
        }
        return {
            invitation,
            isLoginRequired,
            isSignupRequired,
        };
    },
})
    .mutation('signup.check-email', {
    input: zod_1.z.object({
        email: zod_1.z.string().email(),
    }),
    async resolve({ ctx: { prisma }, input: { email } }) {
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'An account already exists with that email.',
            });
        }
        return { email };
    },
})
    .mutation('signup', {
    input: zod_1.z.object({
        email: zod_1.z.string().email(),
        firstName: zod_1.z.string().optional(),
        lastName: zod_1.z.string().optional(),
        password: zod_1.z.string(),
        organizationName: zod_1.z.string().optional(),
        organizationPromoCode: zod_1.z.string().optional(),
        invitationId: zod_1.z.string().nullish(),
        timeZoneName: zod_1.z.string().optional(),
        onboardingExampleSlug: zod_1.z.string().optional(),
        intendedPlanName: zod_1.z.string().optional(),
        referralInfo: referralSchema_1.referralInfoSchema,
    }),
    async resolve({ ctx: { prisma }, input }) {
        const { password, invitationId, organizationName, organizationPromoCode, onboardingExampleSlug, referralInfo, intendedPlanName, ...data } = input;
        const invitation = invitationId
            ? await prisma.userOrganizationInvitation.findUnique({
                where: { id: invitationId },
            })
            : null;
        if (invitationId && !invitation) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'Invalid invitation link',
            });
        }
        if (invitation && invitation.email !== input.email) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: `Sorry, this invitation is for another email address. You entered ${input.email}.`,
            });
        }
        let promoCode = null;
        if (organizationPromoCode) {
            promoCode = await prisma.organizationPromoCode.findFirst({
                where: {
                    code: {
                        equals: organizationPromoCode,
                        mode: 'insensitive',
                    },
                },
            });
            if (!promoCode) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Invalid promo code',
                });
            }
        }
        let organization;
        if (invitation) {
            organization = {
                existing: {
                    id: invitation.organizationId,
                    permissions: invitation.permissions,
                },
            };
        }
        else {
            const domain = (0, email_1.getDomain)(data.email);
            if (!domain) {
                // Shouldn't actually happen, email format already validated
                throw new server_1.TRPCError({ code: 'BAD_REQUEST' });
            }
            const sso = await prisma.organizationSSO.findFirst({
                where: {
                    domain,
                },
            });
            if (sso) {
                organization = {
                    existing: {
                        id: sso.organizationId,
                        permissions: sso.defaultUserPermissions,
                    },
                };
            }
            else if (organizationName || organizationPromoCode) {
                organization = {
                    new: {
                        name: organizationName,
                        promoCode,
                    },
                };
            }
        }
        const user = await (0, user_1.createUser)({
            data,
            password,
            organization,
            onboardingExampleSlug,
            referralInfo,
            intendedPlanName,
            invitation,
        });
        if (!invitation) {
            await (0, auth_1.requestEmailConfirmation)(user);
        }
        return user;
    },
})
    .mutation('forgot-password', {
    input: zod_1.z.object({
        email: zod_1.z.string().email(),
    }),
    async resolve({ ctx: { prisma }, input: { email } }) {
        const user = await prisma.user.findUnique({
            where: {
                email,
            },
        });
        if (!user) {
            // We don't want to leak information about which email
            // addresses exist, so no error here
            return;
        }
        if (auth_1.isWorkOSEnabled && user.idpId) {
            // FIXME: May not need to leak this?
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'User created via SSO',
            });
        }
        await prisma.userPasswordResetToken.deleteMany({
            where: {
                userId: user.id,
            },
        });
        const resetToken = await prisma.userPasswordResetToken.create({
            data: {
                user: { connect: { id: user.id } },
            },
        });
        const resetUrl = await (0, auth_1.createResetUrl)(resetToken.id);
        (0, emails_1.forgotPassword)(user.email, { resetUrl });
    },
})
    // ********** Endpoints below here require authentication **********
    .middleware(util_1.authenticatedMiddleware)
    .mutation('mfa.enroll.start', {
    async resolve({ ctx: { user } }) {
        try {
            const enrollResponse = await (0, auth_1.enrollMfa)(user);
            const challenge = await (0, auth_1.challengeMfa)(enrollResponse.id);
            return {
                mfaId: enrollResponse.id,
                challengeId: challenge.id,
                qrCode: enrollResponse.totp.qr_code,
                secret: enrollResponse.totp.secret,
            };
        }
        catch (err) {
            logger_1.logger.error('Failed enrolling MFA', { error: err });
            throw new server_1.TRPCError({ code: 'BAD_REQUEST', cause: err });
        }
    },
})
    .mutation('mfa.enroll.complete', {
    input: zod_1.z.object({
        challengeId: zod_1.z.string(),
        code: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user, session }, input: { challengeId, code }, }) {
        try {
            const challenge = await (0, auth_1.verifyMfa)(challengeId, code, session);
            await prisma.user.update({
                where: { id: user.id },
                data: { mfaId: challenge.mfaId },
            });
        }
        catch (err) {
            logger_1.logger.error('Failed completing MFA enrollment', { error: err });
            throw new server_1.TRPCError({ code: 'BAD_REQUEST', cause: err });
        }
    },
})
    .mutation('mfa.delete', {
    input: zod_1.z.object({
        challengeId: zod_1.z.string(),
        code: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, user, session }, input: { challengeId, code }, }) {
        if (!user.mfaId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        try {
            await (0, auth_1.verifyMfa)(challengeId, code, session);
            await Promise.all([
                prisma.user.update({
                    where: { id: user.id },
                    data: { mfaId: null },
                }),
                prisma.userSession.update({
                    where: { id: session.id },
                    data: { mfaChallenge: { delete: true } },
                }),
            ]);
        }
        catch (err) {
            const code = err instanceof auth_2.AuthenticationError
                ? 'UNAUTHORIZED'
                : 'INTERNAL_SERVER_ERROR';
            throw new server_1.TRPCError({ code, cause: err });
        }
    },
})
    .query('mfa.has', {
    async resolve({ ctx: { prisma, ...ctx } }) {
        const user = await prisma.user.findUnique({
            where: { id: ctx.user.id },
        });
        if (!user) {
            // this should never happen
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return auth_1.isWorkOSEnabled && !!user?.mfaId;
    },
})
    .query('password.has', {
    async resolve({ ctx: { user, prisma } }) {
        const userWithPassword = await prisma.user.findFirst({
            where: {
                id: user.id,
                password: {
                    not: null,
                },
            },
            select: {
                id: true,
            },
        });
        return userWithPassword != null;
    },
})
    .mutation('password.edit', {
    input: zod_1.z.object({
        data: zod_1.z.object({
            newPassword: zod_1.z.string(),
            newPasswordConfirm: zod_1.z.string(),
        }),
    }),
    async resolve({ ctx: { user, prisma }, input: { data } }) {
        if (data.newPassword !== data.newPasswordConfirm) {
            throw new Error('New passwords do not match');
        }
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { password: (0, auth_1.encryptPassword)(data.newPassword) },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
            },
        });
        return updatedUser;
    },
})
    .query('confirm-email', {
    input: zod_1.z.object({
        token: zod_1.z.string().nullish(),
    }),
    async resolve({ ctx: { user, prisma }, input: { token } }) {
        if (token) {
            const unsealed = await (0, iron_session_1.unsealData)(token, {
                password: auth_1.ironSessionOptions.password,
            });
            const pendingToken = await prisma.userEmailConfirmToken.findUnique({
                where: { id: unsealed.confirmTokenId },
            });
            if (!pendingToken) {
                throw new server_1.TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Sorry, this link has expired. Please log in again to request a new link.',
                });
            }
            if (pendingToken.userId !== user.id) {
                throw new server_1.TRPCError({
                    code: 'FORBIDDEN',
                    message: 'Sorry, this link is for a different account than the one you are logged into.',
                });
            }
            if (pendingToken.expiresAt < new Date()) {
                // automatically generate a new confirmation
                await (0, auth_1.requestEmailConfirmation)(user);
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Sorry, this link has expired. We sent a new link to your email address, please check your email and try again.',
                });
            }
            if (pendingToken.email) {
                await prisma.user.update({
                    where: { id: pendingToken.userId },
                    data: { email: pendingToken.email },
                });
            }
            await prisma.userEmailConfirmToken.delete({
                where: { id: unsealed.confirmTokenId },
            });
            return { isConfirmRequired: false };
        }
        const pendingToken = await prisma.userEmailConfirmToken.findUnique({
            where: { userId: user.id },
        });
        if (pendingToken && pendingToken.expiresAt < new Date()) {
            // token has expired; generate a new one
            // (this is so users don't land on the page that says "we sent an email" and we don't actually send an email)
            await (0, auth_1.requestEmailConfirmation)(user);
        }
        return { isConfirmRequired: !!pendingToken };
    },
})
    .mutation('confirm-email.refresh', {
    async resolve({ ctx: { user, prisma } }) {
        await prisma.userEmailConfirmToken.deleteMany({
            where: { userId: user.id },
        });
        await (0, auth_1.requestEmailConfirmation)(user);
        return {};
    },
})
    .query('confirm-sso.check', {
    input: zod_1.z.object({
        orgSlug: zod_1.z.string(),
    }),
    async resolve({ ctx: { user }, input }) {
        const access = await (0, organizations_1.getOrganizationAccess)(user.id, input.orgSlug);
        // only offer to rename if user is owner + name has not already been changed from the default
        const canRenameOrg = (0, permissions_1.hasPermission)(access, 'WRITE_ORG_SETTINGS') &&
            access.organization.name.endsWith("'s organization") &&
            access.organization.ownerId === user.id;
        return {
            canRenameOrg,
            firstName: user.firstName,
            lastName: user.lastName,
            orgName: access.organization.name,
            orgId: access.organization.id,
        };
    },
})
    .mutation('confirm-sso', {
    input: zod_1.z.object({
        firstName: zod_1.z.string(),
        lastName: zod_1.z.string(),
        orgId: zod_1.z.string(),
        orgSlug: zod_1.z.string(),
        orgName: zod_1.z.string().optional(),
        organizationPromoCode: zod_1.z.string().optional(),
        referralInfo: referralSchema_1.referralInfoSchema,
    }),
    async resolve({ ctx: { user, prisma }, input }) {
        const { firstName, lastName, orgName, orgSlug, orgId, organizationPromoCode, referralInfo, } = input;
        const access = await prisma.userOrganizationAccess.findUnique({
            where: {
                userId_organizationId: {
                    userId: user.id,
                    organizationId: orgId,
                },
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
        let promoCode = null;
        if (organizationPromoCode) {
            promoCode = await prisma.organizationPromoCode.findFirst({
                where: {
                    code: {
                        equals: organizationPromoCode,
                        mode: 'insensitive',
                    },
                },
            });
            if (!promoCode) {
                throw new server_1.TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Invalid promo code',
                });
            }
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { firstName, lastName },
        });
        if (referralInfo &&
            Object.values(referralInfo).some(val => val != null)) {
            await prisma.userReferralInfo.create({
                data: {
                    user: { connect: { id: user.id } },
                    ...referralInfo,
                },
            });
        }
        if ((0, permissions_1.hasPermission)(access, 'WRITE_ORG_SETTINGS') && (orgName || orgSlug)) {
            await prisma.organization.update({
                where: {
                    id: access.organization.id,
                },
                data: {
                    name: orgName,
                    slug: orgSlug,
                    organizationPromoCode: promoCode
                        ? // reference db row to prevent case sensitivity mismatch
                            { connect: { code: promoCode.code } }
                        : undefined,
                },
            });
        }
    },
});
