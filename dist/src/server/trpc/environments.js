"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.environmentsRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const util_1 = require("./util");
const permissions_1 = require("../../utils/permissions");
const slugs_1 = require("../../server/utils/slugs");
const environments_1 = require("../../utils/environments");
async function validateEnvironment({ id, prisma, organizationId, name, }) {
    const desiredSlug = (0, slugs_1.generateSlug)(name);
    const [existingName, existingSlug] = await Promise.all([
        prisma.organizationEnvironment.findFirst({
            where: {
                id: id ? { not: id } : undefined,
                organizationId,
                name: {
                    equals: name,
                    mode: 'insensitive',
                },
                deletedAt: null,
            },
        }),
        prisma.organizationEnvironment.findMany({
            where: {
                id: id ? { not: id } : undefined,
                slug: {
                    startsWith: desiredSlug,
                },
                organizationId,
                deletedAt: null,
            },
            select: {
                slug: true,
            },
        }),
    ]);
    if (existingName ||
        name.toLowerCase() === environments_1.PRODUCTION_ORG_ENV_NAME.toLowerCase() ||
        name.toLowerCase() === environments_1.DEVELOPMENT_ORG_ENV_NAME.toLowerCase()) {
        throw new server_1.TRPCError({
            code: 'BAD_REQUEST',
            message: 'An environment with that name already exists.',
        });
    }
    const existingSlugs = existingSlug.filter(org => !!org.slug).map(org => org.slug).concat([environments_1.PRODUCTION_ORG_ENV_SLUG, environments_1.DEVELOPMENT_ORG_ENV_SLUG]);
    return {
        slug: (0, slugs_1.getCollisionSafeSlug)(desiredSlug, existingSlugs),
    };
}
exports.environmentsRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('single', {
    input: zod_1.z.object({
        slug: zod_1.z.string().optional().default(environments_1.PRODUCTION_ORG_ENV_SLUG),
    }),
    async resolve({ ctx: { prisma, organizationId, userOrganizationAccess }, input: { slug }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'ACCESS_ORG_ENVIRONMENTS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        let orgEnv = await prisma.organizationEnvironment.findFirst({
            where: { organizationId, slug, deletedAt: null },
        });
        if (!orgEnv) {
            if (slug === environments_1.PRODUCTION_ORG_ENV_SLUG) {
                orgEnv = await prisma.organizationEnvironment.create({
                    data: {
                        organizationId,
                        slug,
                        name: environments_1.PRODUCTION_ORG_ENV_NAME,
                    },
                });
            }
            else if (slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG) {
                orgEnv = await prisma.organizationEnvironment.create({
                    data: {
                        organizationId,
                        slug,
                        name: environments_1.DEVELOPMENT_ORG_ENV_NAME,
                        color: environments_1.DEVELOPMENT_ORG_DEFAULT_COLOR,
                    },
                });
            }
            else {
                throw new server_1.TRPCError({ code: 'NOT_FOUND' });
            }
        }
        return orgEnv;
    },
})
    .mutation('create', {
    input: zod_1.z.object({
        name: zod_1.z.string(),
        color: zod_1.z.string().nullish().default(null),
    }),
    async resolve({ ctx: { prisma, organizationId, userOrganizationAccess }, input: { name, color }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'ACCESS_ORG_ENVIRONMENTS') ||
            !(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_SETTINGS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const org = await prisma.organization.findFirst({
            where: { id: organizationId },
            include: {
                environments: true,
            },
        });
        if (!org) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        const prodEnv = org.environments.find(env => env.name === environments_1.PRODUCTION_ORG_ENV_NAME &&
            env.slug === environments_1.PRODUCTION_ORG_ENV_SLUG);
        if (!prodEnv) {
            await prisma.organizationEnvironment.create({
                data: {
                    name: environments_1.PRODUCTION_ORG_ENV_NAME,
                    slug: environments_1.PRODUCTION_ORG_ENV_SLUG,
                    organization: { connect: { id: organizationId } },
                },
            });
        }
        const devEnv = org.environments.find(env => env.name === environments_1.DEVELOPMENT_ORG_ENV_NAME &&
            env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG);
        if (!devEnv) {
            await prisma.organizationEnvironment.create({
                data: {
                    name: environments_1.DEVELOPMENT_ORG_ENV_NAME,
                    slug: environments_1.DEVELOPMENT_ORG_ENV_SLUG,
                    organization: { connect: { id: organizationId } },
                    color: environments_1.DEVELOPMENT_ORG_DEFAULT_COLOR,
                },
            });
        }
        const { slug } = await validateEnvironment({
            prisma,
            name,
            organizationId,
        });
        return prisma.organizationEnvironment.create({
            data: {
                name,
                slug,
                color: color === 'none' ? null : color,
                organization: { connect: { id: organizationId } },
            },
        });
    },
})
    .mutation('update', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
        name: zod_1.z.string().optional(),
        color: zod_1.z.string().nullish().default(null),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess, organizationId }, input: { id, name, color }, }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'ACCESS_ORG_ENVIRONMENTS') ||
            !(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_SETTINGS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const env = await prisma.organizationEnvironment.findFirst({
            where: { id },
        });
        if (!env) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        let slug;
        if (env.slug === environments_1.PRODUCTION_ORG_ENV_SLUG ||
            env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG) {
            name = undefined;
        }
        else if (name) {
            slug = (await validateEnvironment({
                id,
                prisma,
                name,
                organizationId,
            })).slug;
        }
        return prisma.organizationEnvironment.update({
            where: { id },
            data: {
                name,
                slug,
                color: color === 'none' ? null : color,
            },
        });
    },
})
    .mutation('delete', {
    input: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    async resolve({ ctx: { prisma, userOrganizationAccess }, input: { id } }) {
        if (!(0, permissions_1.hasPermission)(userOrganizationAccess, 'ACCESS_ORG_ENVIRONMENTS') ||
            !(0, permissions_1.hasPermission)(userOrganizationAccess, 'WRITE_ORG_SETTINGS')) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        const env = await prisma.organizationEnvironment.findFirst({
            where: { id },
        });
        if (!env) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        if (env.slug === environments_1.PRODUCTION_ORG_ENV_SLUG) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'You cannot delete the production environment',
            });
        }
        if (env.slug === environments_1.DEVELOPMENT_ORG_ENV_SLUG) {
            throw new server_1.TRPCError({
                code: 'BAD_REQUEST',
                message: 'You cannot delete the development environment',
            });
        }
        await prisma.apiKey.updateMany({
            where: {
                organizationEnvironmentId: env.id,
            },
            data: {
                deletedAt: new Date(),
            },
        });
        return await prisma.organizationEnvironment.update({
            where: { id },
            data: {
                deletedAt: new Date(),
            },
        });
    },
});
