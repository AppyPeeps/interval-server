"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const env_1 = __importDefault(require("../env"));
const zod_1 = require("zod");
const logger_1 = require("../server/utils/logger");
const prisma_1 = __importDefault(require("../server/prisma"));
const notify_1 = require("./notify");
const transactions_1 = require("./transactions");
const client_1 = require("@prisma/client");
const ioSchema_1 = require("@interval/sdk/dist/ioSchema");
const consts_1 = require("./consts");
const requestLogger_1 = __importDefault(require("../server/middleware/requestLogger"));
const auth_1 = require("../server/auth");
const actionSchedule_1 = require("./actionSchedule");
const timezones_1 = require("../utils/timezones");
const app = (0, express_1.default)();
app.use(requestLogger_1.default);
// Very basic authentication layer that uses a shared secret
function authMiddleware(req, res, next) {
    const header = req.header('Authorization');
    const token = header?.split(' ')[1];
    if (token === (0, auth_1.encryptPassword)(env_1.default.WSS_API_SECRET)) {
        next?.();
        return;
    }
    res.status(401);
    res.end();
}
app.use(authMiddleware);
app.use(express_1.default.json());
const notifyBody = zod_1.z.object({
    transactionId: zod_1.z.string(),
    notificationId: zod_1.z.string(),
});
app.post('/api/notify', async (req, res) => {
    try {
        const parsed = notifyBody.parse(req.body);
        const [transaction, notification] = await prisma_1.default.$transaction([
            prisma_1.default.transaction.findUniqueOrThrow({
                where: {
                    id: parsed.transactionId,
                },
            }),
            prisma_1.default.notification.findUniqueOrThrow({
                where: {
                    id: parsed.notificationId,
                },
                include: {
                    notificationDeliveries: true,
                },
            }),
        ]);
        await (0, notify_1.sendNotificationToConnectedClient)(transaction, notification);
        return res.sendStatus(200);
    }
    catch (err) {
        logger_1.logger.error('Error in WSS /api/notify', {
            error: err,
            body: req.body,
        });
        res.status(err instanceof zod_1.z.ZodError
            ? 400
            : err instanceof client_1.Prisma.PrismaClientKnownRequestError
                ? 404
                : 500);
        res.end();
    }
});
const startBody = zod_1.z.object({
    transactionId: zod_1.z.string(),
    runnerId: zod_1.z.string(),
    clientId: zod_1.z.string(),
    params: ioSchema_1.serializableRecord,
    paramsMeta: zod_1.z.any(),
});
app.post('/api/transactions/start', async (req, res) => {
    try {
        const parsed = startBody.parse(req.body);
        const [transaction, runner] = await prisma_1.default.$transaction([
            prisma_1.default.transaction.findUniqueOrThrow({
                where: {
                    id: parsed.transactionId,
                },
                include: {
                    action: true,
                },
            }),
            prisma_1.default.user.findUniqueOrThrow({
                where: {
                    id: parsed.runnerId,
                },
                include: {
                    userOrganizationAccess: {
                        select: {
                            permissions: true,
                            groupMemberships: {
                                select: {
                                    group: {
                                        select: {
                                            id: true,
                                            slug: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            }),
        ]);
        await (0, transactions_1.startTransaction)(transaction, runner, {
            ...parsed,
        });
        res.sendStatus(200);
    }
    catch (err) {
        logger_1.logger.error('Error in WSS /api/transactions/start', {
            error: err,
            body: req.body,
        });
        res.status(err instanceof zod_1.z.ZodError
            ? 400
            : err instanceof client_1.Prisma.PrismaClientKnownRequestError
                ? 404
                : 500);
        res.end();
    }
});
const cancelBody = zod_1.z.object({
    transactionId: zod_1.z.string(),
});
app.post('/api/transactions/cancel', async (req, res) => {
    try {
        const parsed = cancelBody.parse(req.body);
        const transaction = await prisma_1.default.transaction.findUniqueOrThrow({
            where: {
                id: parsed.transactionId,
            },
        });
        await (0, transactions_1.cancelTransaction)(transaction);
        return res.sendStatus(200);
    }
    catch (err) {
        logger_1.logger.error('Error in WSS /api/transactions/cancel', {
            error: err,
            body: req.body,
        });
        res.status(err instanceof zod_1.z.ZodError
            ? 400
            : err instanceof client_1.Prisma.PrismaClientKnownRequestError
                ? 404
                : 500);
        res.end();
    }
});
const syncScheduleBody = zod_1.z.object({
    actionId: zod_1.z.string(),
    inputs: zod_1.z.array(zod_1.z.object({
        schedulePeriod: zod_1.z.enum(['hour', 'day', 'week', 'month']),
        timeZoneName: zod_1.z.enum(timezones_1.ALL_TIMEZONES).optional(),
        hours: zod_1.z.number().optional(),
        minutes: zod_1.z.number().optional(),
        dayOfWeek: zod_1.z.number().optional(),
        dayOfMonth: zod_1.z.number().optional(),
        runnerId: zod_1.z.string().optional().nullable(),
        notifyOnSuccess: zod_1.z.boolean().optional(),
    })),
});
app.post('/api/action-schedules/sync', async (req, res) => {
    try {
        const parsed = syncScheduleBody.parse(req.body);
        logger_1.logger.debug('/api/action-schedules/sync', {
            parsed,
        });
        const action = await prisma_1.default.action.findUniqueOrThrow({
            where: {
                id: parsed.actionId,
            },
            include: {
                schedules: {
                    where: {
                        deletedAt: null,
                    },
                },
            },
        });
        await (0, actionSchedule_1.syncActionSchedules)(action, parsed.inputs);
        return res.sendStatus(200);
    }
    catch (err) {
        logger_1.logger.error('Error in WSS /api/action-schedules/sync', {
            error: err,
            body: req.body,
        });
        res.status(err instanceof zod_1.z.ZodError
            ? 400
            : err instanceof client_1.Prisma.PrismaClientKnownRequestError
                ? 404
                : 500);
        res.end();
    }
});
app.listen(consts_1.port, () => {
    const url = new URL(env_1.default.APP_URL);
    url.port = consts_1.port.toString();
    logger_1.logger.info(`📡 Internal WSS API Server listening at ${url.toString()}`);
});
