"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadsRouter = void 0;
const zod_1 = require("zod");
const util_1 = require("./util");
const server_1 = require("@trpc/server");
const uploads_1 = require("../utils/uploads");
const logger_1 = require("../../server/utils/logger");
exports.uploadsRouter = (0, util_1.createRouter)().mutation('io.urls', {
    input: zod_1.z.object({
        transactionId: zod_1.z.string(),
        inputGroupKey: zod_1.z.string(),
        objectKeys: zod_1.z.array(zod_1.z.string()),
    }),
    async resolve({ ctx: { prisma, organizationId }, input: { transactionId, inputGroupKey, objectKeys }, }) {
        if (!uploads_1.S3_UPLOADS_ENABLED) {
            throw new server_1.TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Upload storage has not been configured',
            });
        }
        const transaction = await prisma.transaction.findUnique({
            where: {
                id: transactionId,
            },
            include: {
                action: true,
            },
        });
        if (!transaction || transaction.action.organizationId !== organizationId) {
            throw new server_1.TRPCError({ code: 'NOT_FOUND' });
        }
        try {
            const entries = [];
            for (const objectKey of objectKeys) {
                const objectName = `${transaction.id}/${inputGroupKey}/${objectKey}`;
                const [uploadUrl, downloadUrl] = await Promise.all([
                    (0, uploads_1.getIOPresignedUploadUrl)(objectName),
                    (0, uploads_1.getIOPresignedDownloadUrl)(objectName),
                ]);
                entries.push({
                    objectKey,
                    uploadUrl,
                    downloadUrl,
                });
            }
            return entries;
        }
        catch (err) {
            logger_1.logger.error('Failed generating presigned upload URL', { error: err });
            throw new server_1.TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Invalid S3 credentials',
            });
        }
    },
});
