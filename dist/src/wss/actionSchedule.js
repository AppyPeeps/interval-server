"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rescheduleAll = exports.stop = exports.schedule = exports.scheduleAllExisting = exports.syncActionSchedules = exports.isValid = exports.isInputValid = void 0;
const cron = __importStar(require("node-cron"));
const actionSchedule_1 = require("../utils/actionSchedule");
const prisma_1 = __importDefault(require("../server/prisma"));
const notify_1 = __importDefault(require("../server/utils/notify"));
const actions_1 = require("../utils/actions");
const transactions_1 = require("../wss/transactions");
const transactions_2 = require("../server/utils/transactions");
const logger_1 = require("../server/utils/logger");
/**
 * Currently assumes a single app server architecture, will have
 * to be refactored in order to support multiple app servers.
 */
const tasks = new Map();
function isInputValid(input) {
    const schedule = (0, actionSchedule_1.toCronSchedule)(input);
    if (!schedule)
        return false;
    return cron.validate((0, actionSchedule_1.cronScheduleToString)(schedule));
}
exports.isInputValid = isInputValid;
function isValid(schedule) {
    return cron.validate((0, actionSchedule_1.cronScheduleToString)(schedule));
}
exports.isValid = isValid;
async function syncActionSchedules(action, inputs) {
    logger_1.logger.debug('syncActionSchedules', { action, inputs });
    const newSchedules = inputs
        .map(input => (0, actionSchedule_1.toCronSchedule)(input))
        .filter(cs => !!cs);
    const existingSchedules = action.schedules ?? [];
    const actionIsBackgroundable = (0, actions_1.isBackgroundable)(action);
    for (const existing of existingSchedules) {
        if (existing &&
            (!actionIsBackgroundable ||
                newSchedules.every(newSchedule => !(0, actionSchedule_1.cronSchedulesEqual)(existing, newSchedule)))) {
            stop(existing.id);
            const run = await prisma_1.default.actionScheduleRun.findFirst({
                where: {
                    actionScheduleId: existing.id,
                },
            });
            if (!run) {
                try {
                    await prisma_1.default.actionSchedule.delete({
                        where: {
                            id: existing.id,
                        },
                    });
                }
                catch (err) {
                    logger_1.logger.error('Failed actually deleting action schedule, will soft delete', { id: existing.id });
                }
            }
            await prisma_1.default.actionSchedule.updateMany({
                where: {
                    id: existing.id,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                },
            });
        }
    }
    if (!actionIsBackgroundable) {
        logger_1.logger.error('Action not backgroundable, not creating actionSchedules', {
            actionId: action.id,
        });
        return;
    }
    const toCreate = newSchedules.filter(newSchedule => existingSchedules.length === 0 ||
        existingSchedules.every(existing => !(0, actionSchedule_1.cronSchedulesEqual)(existing, newSchedule)));
    for (const { runnerId, ...newSchedule } of toCreate) {
        if (!isValid(newSchedule)) {
            const scheduleString = (0, actionSchedule_1.cronScheduleToString)(newSchedule);
            logger_1.logger.error('Invalid schedule, skipping', {
                newSchedule,
                scheduleString,
            });
            continue;
        }
        const actionSchedule = await prisma_1.default.actionSchedule.create({
            data: {
                action: { connect: { id: action.id } },
                runner: runnerId ? { connect: { id: runnerId } } : undefined,
                ...newSchedule,
            },
            include: {
                action: true,
                runner: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
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
                },
            },
        });
        schedule(actionSchedule);
    }
}
exports.syncActionSchedules = syncActionSchedules;
async function scheduleAllExisting() {
    const actionSchedules = await prisma_1.default.actionSchedule.findMany({
        where: {
            deletedAt: null,
        },
        include: {
            action: true,
            runner: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
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
            },
        },
    });
    for (const actionSchedule of actionSchedules) {
        try {
            schedule(actionSchedule);
        }
        catch (err) {
            logger_1.logger.error('Failed scheduling action', {
                actionScheduleId: actionSchedule.id,
            });
        }
    }
}
exports.scheduleAllExisting = scheduleAllExisting;
function schedule(actionSchedule) {
    if (tasks.has(actionSchedule.id)) {
        logger_1.logger.info('Task already scheduled, doing nothing', {
            actionScheduleId: actionSchedule.id,
        });
        return;
    }
    const task = cron.schedule((0, actionSchedule_1.cronScheduleToString)(actionSchedule), async () => {
        try {
            const action = await prisma_1.default.action.findUnique({
                where: {
                    id: actionSchedule.actionId,
                },
                include: {
                    organization: {
                        include: {
                            private: true,
                            owner: true,
                        },
                    },
                    hostInstances: {
                        include: {
                            apiKey: true,
                        },
                        orderBy: {
                            createdAt: 'desc',
                        },
                    },
                    httpHosts: {
                        orderBy: {
                            createdAt: 'desc',
                        },
                    },
                    metadata: true,
                },
            });
            if (!action) {
                // This should never happen
                logger_1.logger.error('Action not found', {
                    actionId: actionSchedule.actionId,
                });
                return;
            }
            // Double check backgroundability here in case changed in code
            if (!(0, actions_1.isBackgroundable)(action)) {
                logger_1.logger.error(`Action not backgroundable, skipping scheduled action`, {
                    actionScheduleId: actionSchedule.actionId,
                });
                return;
            }
            const scheduleRunner = actionSchedule.runner ??
                (await prisma_1.default.user.findUnique({
                    where: {
                        id: action.organization.ownerId,
                    },
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
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
                }));
            if (!scheduleRunner) {
                // This should never happen
                logger_1.logger.error('Could not find action runner', {
                    actionScheduleId: actionSchedule.id,
                });
                await prisma_1.default.actionScheduleRun.create({
                    data: {
                        actionSchedule: { connect: { id: actionSchedule.id } },
                        status: 'FAILURE',
                        details: 'Could not find action runner',
                    },
                });
                return;
            }
            let hostInstance;
            try {
                const hostInstanceWithoutApiKey = await (0, transactions_2.getCurrentHostInstance)(action);
                const hostInstanceWithApiKey = await prisma_1.default.hostInstance.findUnique({
                    where: {
                        id: hostInstanceWithoutApiKey.id,
                    },
                    include: {
                        apiKey: true,
                    },
                });
                if (!hostInstanceWithApiKey) {
                    // This should never happen
                    throw new Error(`Failed retreiving API key for hostInstance ${hostInstanceWithoutApiKey.id}`);
                }
                hostInstance = hostInstanceWithApiKey;
            }
            catch (err) {
                logger_1.logger.error('Could not find HostInstance for scheduled action', {
                    actionScheduleId: actionSchedule.id,
                });
                await prisma_1.default.actionScheduleRun.create({
                    data: {
                        actionSchedule: { connect: { id: actionSchedule.id } },
                        status: 'FAILURE',
                        details: 'Could not find HostInstance',
                    },
                });
                return;
            }
            const runner = scheduleRunner;
            const notifyRunner = async (title, message) => {
                await (0, notify_1.default)({
                    title: `${title} for ${(0, actions_1.getName)(action)}`,
                    message,
                    environment: hostInstance.apiKey.usageEnvironment,
                    organization: action.organization,
                    deliveryInstructions: [{ to: runner.email }],
                    createdAt: new Date().toISOString(),
                });
            };
            try {
                const transaction = await prisma_1.default.transaction.create({
                    data: {
                        status: 'RUNNING',
                        action: { connect: { id: action.id } },
                        actionSchedule: { connect: { id: actionSchedule.id } },
                        hostInstance: {
                            connect: { id: hostInstance.id },
                        },
                        owner: { connect: { id: runner.id } },
                    },
                    include: {
                        action: true,
                    },
                });
                try {
                    await (0, transactions_1.startTransaction)(transaction, runner);
                    await prisma_1.default.actionScheduleRun.create({
                        data: {
                            actionSchedule: { connect: { id: actionSchedule.id } },
                            status: 'SUCCESS',
                            transaction: { connect: { id: transaction.id } },
                        },
                    });
                    return;
                }
                catch (err) {
                    logger_1.logger.error('Failed starting scheduled action transaction', {
                        actionScheduleId: actionSchedule.id,
                    });
                    await prisma_1.default.transaction.update({
                        where: {
                            id: transaction.id,
                        },
                        data: {
                            status: 'HOST_CONNECTION_DROPPED',
                        },
                    });
                    await prisma_1.default.actionScheduleRun.create({
                        data: {
                            actionSchedule: { connect: { id: actionSchedule.id } },
                            status: 'FAILURE',
                            details: 'Failed starting transaction',
                            transaction: { connect: { id: transaction.id } },
                        },
                    });
                    try {
                        await notifyRunner('Scheduled run failed', "We could not reach the action, are you sure the host is running? If this is intentional, please disable the action's schedule configuration.");
                    }
                    catch (err) {
                        logger_1.logger.error('Failed notifying action runner', {
                            actionScheduleId: actionSchedule.id,
                        });
                    }
                    return;
                }
            }
            catch (err) {
                logger_1.logger.error('Failed creating transaction for scheduled action', {
                    actionScheduleId: actionSchedule.id,
                });
                await prisma_1.default.actionScheduleRun.create({
                    data: {
                        actionSchedule: { connect: { id: actionSchedule.id } },
                        status: 'FAILURE',
                        details: 'Failed creating transaction',
                    },
                });
                return;
            }
        }
        catch (err) {
            logger_1.logger.error('Failed spawning ActionScheduleRun', {
                error: err,
                actionScheduleId: actionSchedule.id,
            });
        }
    }, {
        timezone: actionSchedule.timeZoneName,
    });
    tasks.set(actionSchedule.id, task);
}
exports.schedule = schedule;
function stop(actionScheduleId) {
    const task = tasks.get(actionScheduleId);
    if (!task) {
        logger_1.logger.error('Failed stopping action schedule, task not found', {
            actionScheduleId,
        });
        return;
    }
    task.stop();
    tasks.delete(actionScheduleId);
}
exports.stop = stop;
async function rescheduleAll() {
    const stopped = tasks.size;
    for (const task of tasks.values()) {
        task.stop();
    }
    tasks.clear();
    await scheduleAllExisting();
    const started = tasks.size;
    return { stopped, started };
}
exports.rescheduleAll = rescheduleAll;
