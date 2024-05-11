"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhook = void 0;
const express_1 = __importDefault(require("express"));
const env_1 = __importDefault(require("../../env"));
const logger_1 = require("../../server/utils/logger");
const auth_1 = require("../auth");
const user_1 = require("../user");
const prisma_1 = __importDefault(require("../../server/prisma"));
const slugs_1 = require("../../server/utils/slugs");
const router = express_1.default.Router();
function getUserEmail(user) {
    const primary = user.emails.find(e => !!e.primary);
    if (!primary)
        throw new Error('No primary email provided.');
    return primary.value;
}
async function getOrganizationSSO(workosOrganizationId) {
    if (!workosOrganizationId)
        throw new Error('No WorkOS Organization ID provided.');
    return await prisma_1.default.organizationSSO.findUniqueOrThrow({
        where: {
            workosOrganizationId,
        },
        include: {
            organization: true,
        },
    });
}
async function upsertUser(data) {
    // Create user
    const sso = await getOrganizationSSO(data.organization_id);
    const email = getUserEmail(data);
    let user = await prisma_1.default.user.findFirst({
        where: {
            OR: [{ idpId: data.idp_id }, { email }],
        },
    });
    if (user) {
        const updatedAt = new Date(data.updated_at);
        if (user.updatedAt < updatedAt || user.idpId !== data.idp_id) {
            user = await prisma_1.default.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    firstName: data.first_name,
                    lastName: data.last_name,
                    email,
                    idpId: data.idp_id,
                    updatedAt: data.updated_at,
                },
            });
        }
        await prisma_1.default.userOrganizationAccess.upsert({
            where: {
                userId_organizationId: {
                    userId: user.id,
                    organizationId: sso.organizationId,
                },
            },
            update: {},
            create: {
                userId: user.id,
                organizationId: sso.organizationId,
                permissions: sso.defaultUserPermissions,
            },
        });
    }
    else {
        (0, user_1.createUser)({
            data: {
                firstName: data.first_name,
                lastName: data.last_name,
                email,
                idpId: data.idp_id,
            },
            password: null,
            organization: {
                existing: {
                    id: sso.organizationId,
                    permissions: sso.defaultUserPermissions,
                },
            },
        });
    }
}
async function upsertGroup(data) {
    const sso = await getOrganizationSSO(data.organization_id);
    const existing = await prisma_1.default.userAccessGroup.findFirst({
        where: {
            scimGroupId: data.id,
        },
    });
    if (existing) {
        if (data.updated_at && existing.updatedAt > new Date(data.updated_at)) {
            return existing;
        }
        return prisma_1.default.userAccessGroup.update({
            where: {
                id: existing.id,
            },
            data: {
                name: data.name,
                updatedAt: data.updated_at,
            },
        });
    }
    else {
        const desiredSlug = `${(0, slugs_1.generateSlug)(data.name)}-scim`;
        const existingSlugs = await prisma_1.default.userAccessGroup.findMany({
            where: {
                organizationId: sso.organizationId,
                slug: {
                    startsWith: desiredSlug,
                },
            },
            select: { slug: true },
        });
        const slug = (0, slugs_1.getCollisionSafeSlug)(desiredSlug, existingSlugs.map(t => String(t.slug)));
        return prisma_1.default.userAccessGroup.create({
            data: {
                organization: {
                    connect: { id: sso.organizationId },
                },
                name: data.name,
                slug,
                scimGroupId: data.id,
                updatedAt: data.updated_at,
            },
        });
    }
}
async function handleWebhook(webhook) {
    switch (webhook.event) {
        case 'dsync.activated': {
            // Create OrganizationSCIMDirectory
            //
            // Existing users and groups should receive their own events:
            // https://workos.com/docs/directory-sync/launch-checklist/frequently-asked-questions
            const sso = await getOrganizationSSO(webhook.data.organization_id);
            await prisma_1.default.organizationSCIMDirectory.create({
                data: {
                    organization: { connect: { id: sso.organization.id } },
                    workosDirectoryId: webhook.data.id,
                },
            });
            break;
        }
        case 'dsync.deleted': {
            // Remove OrganizationSCIMDirectory
            if (!webhook.data.organization_id) {
                throw new Error('No WorkOS Organization ID provided.');
            }
            const org = await prisma_1.default.organization.findFirst({
                where: {
                    sso: {
                        workosOrganizationId: webhook.data.organization_id,
                    },
                    scimDirectory: {
                        workosDirectoryId: webhook.data.id,
                    },
                },
            });
            if (!org) {
                throw new Error('WorkOS Organization ID and Directory IDs do not match.');
            }
            await prisma_1.default.organizationSCIMDirectory.delete({
                where: {
                    workosDirectoryId: webhook.data.id,
                },
            });
            // Remove SCIM groups
            await prisma_1.default.$transaction([
                prisma_1.default.userAccessGroupMembership.deleteMany({
                    where: {
                        group: {
                            organizationId: org.id,
                            scimGroupId: { not: null },
                        },
                    },
                }),
                prisma_1.default.userAccessGroup.deleteMany({
                    where: {
                        organizationId: org.id,
                        scimGroupId: { not: null },
                    },
                }),
            ]);
            // We do not currently disable the users at this point
            // because SSO does not require directory sync
            break;
        }
        case 'dsync.user.created': {
            await upsertUser(webhook.data);
            break;
        }
        case 'dsync.user.updated':
            // Update user
            await prisma_1.default.user.update({
                where: {
                    idpId: webhook.data.idp_id,
                },
                data: {
                    firstName: webhook.data.first_name,
                    lastName: webhook.data.last_name,
                    email: getUserEmail(webhook.data),
                },
            });
            break;
        case 'dsync.user.deleted': {
            const user = await prisma_1.default.user.update({
                where: {
                    idpId: webhook.data.idp_id,
                },
                data: {
                    deletedAt: new Date(),
                },
            });
            await prisma_1.default.userAccessGroupMembership.deleteMany({
                where: {
                    id: user.id,
                },
            });
            break;
        }
        case 'dsync.group.created': {
            await upsertGroup(webhook.data);
            break;
        }
        case 'dsync.group.updated': {
            const sso = await getOrganizationSSO(webhook.data.organization_id);
            const group = await prisma_1.default.userAccessGroup.findFirstOrThrow({
                where: {
                    organizationId: sso.organizationId,
                    scimGroupId: webhook.data.id,
                },
            });
            if (!group) {
                throw new Error('Group not found.');
            }
            await prisma_1.default.userAccessGroup.update({
                where: {
                    id: group.id,
                },
                data: {
                    name: webhook.data.name,
                },
            });
            break;
        }
        case 'dsync.group.deleted': {
            const sso = await getOrganizationSSO(webhook.data.organization_id);
            const group = await prisma_1.default.userAccessGroup.findFirstOrThrow({
                where: {
                    organizationId: sso.organizationId,
                    scimGroupId: webhook.data.id,
                },
            });
            if (!group) {
                throw new Error('Group not found.');
            }
            await prisma_1.default.$transaction([
                prisma_1.default.userAccessGroupMembership.deleteMany({
                    where: {
                        groupId: group.id,
                    },
                }),
                prisma_1.default.userAccessGroup.delete({
                    where: {
                        id: group.id,
                    },
                }),
            ]);
            break;
        }
        case 'dsync.group.user_added': {
            // Add user to group
            const sso = await getOrganizationSSO(webhook.data.user.organization_id);
            const group = await upsertGroup({
                organization_id: webhook.data.user.organization_id,
                ...webhook.data.group,
            });
            await upsertUser(webhook.data.user);
            const user = await prisma_1.default.user.findUniqueOrThrow({
                where: {
                    idpId: webhook.data.user.idp_id,
                },
                include: {
                    userOrganizationAccess: {
                        where: {
                            organizationId: sso.organizationId,
                        },
                    },
                },
            });
            const userOrganizationAccess = user.userOrganizationAccess[0];
            if (!userOrganizationAccess)
                throw new Error('User is not a part of the organization.');
            await prisma_1.default.userAccessGroupMembership.upsert({
                where: {
                    userOrganizationAccessId_groupId: {
                        userOrganizationAccessId: userOrganizationAccess.id,
                        groupId: group.id,
                    },
                },
                update: {
                    userOrganizationAccessId: userOrganizationAccess.id,
                    groupId: group.id,
                },
                create: {
                    userOrganizationAccessId: userOrganizationAccess.id,
                    groupId: group.id,
                },
            });
            break;
        }
        case 'dsync.group.user_removed': {
            // Remove user from group
            const sso = await getOrganizationSSO(webhook.data.user.organization_id);
            const group = await prisma_1.default.userAccessGroup.findFirstOrThrow({
                where: {
                    organizationId: sso.organizationId,
                    scimGroupId: webhook.data.group.id,
                },
            });
            const user = await prisma_1.default.user.findUniqueOrThrow({
                where: {
                    idpId: webhook.data.user.idp_id,
                },
                include: {
                    userOrganizationAccess: {
                        where: {
                            organizationId: sso.organizationId,
                        },
                    },
                },
            });
            const userOrganizationAccess = user.userOrganizationAccess[0];
            if (!userOrganizationAccess)
                throw new Error('User is not a part of the organization.');
            await prisma_1.default.userAccessGroupMembership.delete({
                where: {
                    userOrganizationAccessId_groupId: {
                        userOrganizationAccessId: userOrganizationAccess.id,
                        groupId: group.id,
                    },
                },
            });
            break;
        }
        default:
            logger_1.logger.warn('Received unimplemented WorkOS webhook', {
                webhook,
            });
    }
}
exports.handleWebhook = handleWebhook;
router.post('*', async (req, res) => {
    if (!auth_1.workos || auth_1.isWorkOSEnabled || !env_1.default.WORKOS_WEBHOOK_SECRET) {
        logger_1.logger.error('WorkOS credentials not found, aborting', {
            path: req.path,
        });
        return res.sendStatus(501);
    }
    const payload = req.body;
    const sigHeader = req.header('workos-signature');
    try {
        if (!sigHeader) {
            throw new Error('Missing workos-signature header.');
        }
        const webhook = auth_1.workos.webhooks.constructEvent({
            payload,
            sigHeader,
            secret: env_1.default.WORKOS_WEBHOOK_SECRET,
        });
        res.status(200).send();
        // Be sure to keep in mind possible out of order events
        // https://workos.com/docs/webhooks/out-of-sequence-events
        try {
            logger_1.logger.http('Received WorkOS webhook', {
                webhook,
            });
            await handleWebhook(webhook);
        }
        catch (error) {
            logger_1.logger.error('Error handling WorkOS webhook', {
                error,
                webhook,
            });
        }
    }
    catch (error) {
        logger_1.logger.error('Received invalid WorkOS webhook', {
            error,
            payload,
            sigHeader,
        });
        res.status(500).send();
    }
});
exports.default = router;
