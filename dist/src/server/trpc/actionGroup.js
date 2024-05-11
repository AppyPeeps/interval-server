"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionGroupRouter = void 0;
const zod_1 = require("zod");
const util_1 = require("./util");
const server_1 = require("@trpc/server");
exports.actionGroupRouter = (0, util_1.createRouter)()
    .middleware(util_1.authenticatedMiddleware)
    .middleware(util_1.organizationMiddleware)
    .query('one', {
    input: zod_1.z.object({
        groupSlug: zod_1.z.string(),
        mode: zod_1.z.enum(['live', 'console']).default('live'),
    }),
    async resolve({ ctx: { prisma, user, organizationId, organizationEnvironmentId }, input: { groupSlug, mode }, }) {
        const app = await prisma.actionGroup.findFirst({
            where: {
                slug: groupSlug,
                developerId: mode === 'console' ? user.id : null,
                organizationId,
                organizationEnvironmentId,
            },
        });
        if (!app) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        return app;
    },
});
