"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = __importDefault(require("../../env"));
const emails_1 = require("../../emails");
const prisma_1 = __importDefault(require("../../server/prisma"));
const validate_1 = require("../../utils/validate");
const actions_1 = require("../../utils/actions");
const formatters_1 = require("../../utils/formatters");
const ts_dedent_1 = __importDefault(require("ts-dedent"));
const slack_1 = require("../../server/utils/slack");
const logger_1 = require("../../server/utils/logger");
const wss_1 = require("./wss");
class FailedNotificationError extends Error {
    constructor(message) {
        super(message);
    }
}
const notify = async function ({ message, title, transaction, environment, organization, deliveryInstructions, createdAt, idempotencyKey, }) {
    let actionRunner = null;
    if (idempotencyKey) {
        const existingNote = await prisma_1.default.notification.findFirst({
            where: {
                idempotencyKey,
                organizationId: organization.id,
            },
        });
        if (existingNote) {
            return [];
        }
    }
    let instructions = deliveryInstructions ?? [];
    if (transaction) {
        transaction.action.metadata = await prisma_1.default.actionMetadata.findFirst({
            where: {
                actionId: transaction.action.id,
            },
        });
        actionRunner = await prisma_1.default.user.findUnique({
            where: {
                id: transaction.ownerId,
            },
        });
        if (!actionRunner) {
            logger_1.logger.log('Attempted to notify, but no such action runner for this transaction', { transactionId: transaction.id });
            return [];
        }
        if (!instructions) {
            if (typeof transaction.action.metadata?.defaultNotificationDelivery ===
                'string') {
                try {
                    instructions = JSON.parse(transaction.action.metadata.defaultNotificationDelivery);
                }
                catch (err) {
                    logger_1.logger.error('Failed parsing defaultNotificationDelivery for action, will fall back to action runner', {
                        actionId: transaction.action.id,
                    });
                }
            }
            if (!instructions) {
                instructions = [{ to: actionRunner.email }];
            }
        }
    }
    if (!instructions) {
        return [];
    }
    const notification = await prisma_1.default.notification.create({
        data: {
            message,
            createdAt,
            title,
            environment,
            transactionId: transaction?.id,
            organizationId: organization.id,
            idempotencyKey,
            notificationDeliveries: {
                create: instructions.map(i => ({
                    to: i.to,
                    method: i.method,
                })),
            },
        },
        include: {
            notificationDeliveries: true,
        },
    });
    if (environment === 'PRODUCTION') {
        notificationWork({
            notification,
            transaction,
            organization,
        });
    }
    if (transaction) {
        (0, wss_1.makeApiCall)('/api/notify', JSON.stringify({
            transactionId: transaction.id,
            notificationId: notification.id,
        })).catch(error => {
            logger_1.logger.error('Failed making WSS API call to send notifications', {
                error,
                transactionId: transaction.id,
                notificationId: notification.id,
            });
        });
    }
    return instructions;
};
async function notificationWork({ notification, transaction, organization, }) {
    // To notify the action runner (or organization owner if not within action) of any failures, we run other ones first
    const owner = transaction?.owner ??
        (await prisma_1.default.user.findUnique({
            where: { id: organization.ownerId },
        }));
    let ownerInstructions = [];
    const otherInstructions = [];
    for (const instruction of notification.notificationDeliveries) {
        if (instruction.to === owner?.email) {
            ownerInstructions.push(instruction);
        }
        else {
            otherInstructions.push(instruction);
        }
    }
    const attemptedNotifications = await Promise.all(otherInstructions.map(async (instruction) => {
        try {
            let timeZoneName = null;
            try {
                const user = await prisma_1.default.user.findFirst({
                    where: {
                        email: instruction.to,
                        userOrganizationAccess: {
                            some: {
                                organizationId: organization.id,
                            },
                        },
                    },
                });
                if (user) {
                    timeZoneName = user.timeZoneName;
                }
            }
            catch (error) {
                logger_1.logger.error('Failed finding user for notification time zone name', {
                    error,
                });
            }
            return await sendNotification({
                message: notification.message,
                instruction,
                transaction,
                organization,
                createdAt: (0, formatters_1.formatDateTime)(notification.createdAt, timeZoneName),
                title: notification.title || undefined,
                failedDetails: [],
            });
        }
        catch (err) {
            if (err instanceof FailedNotificationError) {
                if (err.message ===
                    `The Interval app has been uninstalled from your Slack workspace. You'll need to reconnect to send Slack notifications.`) {
                    await prisma_1.default.organization.update({
                        where: {
                            id: organization.id,
                        },
                        data: {
                            private: {
                                update: {
                                    slackAccessToken: null,
                                },
                            },
                        },
                    });
                }
            }
            return await prisma_1.default.notificationDelivery.update({
                where: {
                    id: instruction.id,
                },
                data: {
                    status: 'FAILED',
                    error: err instanceof Error ? err.message : 'Unknown error',
                },
            });
        }
    }));
    if (owner) {
        const failedDetails = attemptedNotifications.filter(d => d.error);
        if (ownerInstructions.length === 0 && failedDetails.length > 0) {
            const ownerNotification = await prisma_1.default.notificationDelivery.create({
                data: {
                    notification: {
                        connect: {
                            id: notification.id,
                        },
                    },
                    to: owner.email,
                },
            });
            ownerInstructions = [ownerNotification];
        }
        await Promise.allSettled(ownerInstructions.map(async (instruction) => {
            await sendNotification({
                message: notification.message,
                instruction,
                transaction,
                organization,
                createdAt: (0, formatters_1.formatDateTime)(notification.createdAt, owner.timeZoneName),
                title: notification.title || undefined,
                failedDetails,
            });
        }));
    }
}
async function sendNotification({ message, instruction, transaction, organization, createdAt, title, failedDetails, }) {
    const { method, user } = await populateMethod(instruction, organization.id);
    const actionName = transaction ? (0, actions_1.getName)(transaction?.action) : undefined;
    let userFromSlackEmail = null;
    switch (method) {
        case 'EMAIL':
            if (transaction && actionName) {
                await (0, emails_1.actionNotification)(instruction.to, {
                    message,
                    title,
                    metadata: {
                        transactionId: transaction.id,
                        orgSlug: organization.slug,
                        actionName: actionName,
                        actionRunner: transaction.owner.email,
                        createdAt: createdAt,
                    },
                    failedDetails: failedDetails.map(d => {
                        return {
                            to: d.to,
                            method: d.method || undefined,
                            error: d.error || undefined,
                        };
                    }),
                });
            }
            else {
                await (0, emails_1.emailNotification)(instruction.to, {
                    message,
                    title,
                    metadata: {
                        orgSlug: organization.slug,
                        createdAt: createdAt,
                    },
                    failedDetails: failedDetails.map(d => {
                        return {
                            to: d.to,
                            method: d.method || undefined,
                            error: d.error || undefined,
                        };
                    }),
                });
            }
            break;
        case 'SLACK':
            if (!organization.private?.slackAccessToken) {
                throw new FailedNotificationError(`You can't send Slack notifications until you've authorized the Interval app`);
            }
            userFromSlackEmail = await sendSlackNotification({
                destination: instruction.to,
                message,
                title,
                metadata: {
                    transactionId: transaction?.id,
                    orgSlug: organization.slug,
                    actionName: actionName,
                    actionRunner: transaction?.owner.email,
                    createdAt: createdAt,
                },
                accessToken: organization.private.slackAccessToken,
                failedDetails,
            });
            break;
    }
    return await prisma_1.default.notificationDelivery.update({
        where: {
            id: instruction.id,
        },
        data: {
            status: 'DELIVERED',
            userId: user?.id || userFromSlackEmail?.id,
        },
    });
}
async function populateMethod(instruction, organizationId) {
    const plausibleEmail = (0, validate_1.isEmail)(instruction.to);
    const recipient = await prisma_1.default.user.findFirst({
        where: {
            email: instruction.to,
            userOrganizationAccess: {
                some: {
                    organizationId,
                },
            },
        },
    });
    const method = instruction.method || recipient?.defaultNotificationMethod || 'EMAIL';
    switch (method) {
        case 'EMAIL': {
            if (!plausibleEmail) {
                throw new FailedNotificationError(`Not a valid email: ${instruction.to}`);
            }
            if (!recipient) {
                // TODO support sending emails to non-Interval users, maybe requiring an
                // explicit allowlist
                throw new FailedNotificationError(`Can't send email notifications to users outside of your organization: ${instruction.to}`);
            }
            break;
        }
        case 'SLACK': {
            if (!plausibleEmail &&
                !plausibleSlackChannel(instruction.to) &&
                !plausibleSlackUser(instruction.to)) {
                throw new FailedNotificationError(`Not a valid slack destination: ${instruction.to}`);
            }
        }
    }
    return { method, user: recipient ?? undefined };
}
async function sendSlackNotification({ destination, message, title, metadata, accessToken, failedDetails, }) {
    let destinationId;
    let userFromSlackEmail = null;
    const transactionNotification = metadata.transactionId && metadata.actionName && metadata.actionRunner;
    if (plausibleSlackChannel(destination)) {
        const channels = await (0, slack_1.getChannelsFromSlackIntegration)(accessToken, metadata.orgSlug);
        const channel = channels.find(c => `#${c.name}` === destination);
        if (!channel) {
            throw new FailedNotificationError(`Invalid Slack channel for your workspace: ${destination}`);
        }
        if (!channel.is_member) {
            throw new FailedNotificationError(`The Interval app is not installed in this Slack channel: ${destination}`);
        }
        destinationId = channel.id;
    }
    else if (plausibleSlackUser(destination)) {
        const usersResponse = await slackAPICallForNotification('GET', 'users.list', accessToken);
        if (usersResponse.error) {
            throw new FailedNotificationError(`Error posting notification to slack: ${usersResponse.error}`);
        }
        const user = usersResponse.members.find(c => `@${c.name}` === destination);
        if (!user) {
            throw new FailedNotificationError(`No such Slack user in your workspace: ${destination}`);
        }
        if (user.deleted) {
            throw new FailedNotificationError(`This Slack user has been deleted: ${destination}`);
        }
        if (user.profile.email) {
            userFromSlackEmail = await prisma_1.default.user.findUnique({
                where: {
                    email: user.profile.email,
                },
            });
        }
        destinationId = user.id;
    }
    else if ((0, validate_1.isEmail)(destination)) {
        const userResponse = await slackAPICallForNotification('GET', 'users.lookupByEmail', accessToken, {
            email: destination,
        });
        if (!userResponse.user) {
            throw new FailedNotificationError(`No Slack user with this email in your workspace: ${destination}`);
        }
        destinationId = userResponse.user.id;
    }
    const failedNotes = failedDetails.map(d => `- *To:* \`${d.to}\` *Method:* \`${d.method}\` *Error:* \`${d.error}\``);
    const failureMessage = failedDetails.length > 0 && failedNotes
        ? (0, ts_dedent_1.default) `
          :warning: This notification failed to be delivered to the following destinations:
          ${failedNotes.join('\n')}`
        : '';
    const preamble = transactionNotification
        ? `Your *${metadata.actionName}* action on Interval triggered a notification.`
        : `A notification has been triggered via Interval.`;
    const messageText = title ? `>*${title}*\n>${message}` : `>${message}`;
    // TODO add optional link to NotifyConfig
    const notificationLink = transactionNotification
        ? `<${env_1.default.APP_URL}/dashboard/${metadata.orgSlug}/transactions/${metadata.transactionId}|View the transaction that sent this notification here>.`
        : ``;
    const text = (0, ts_dedent_1.default) `
    ${preamble}
    ${messageText}
    ${notificationLink}

    ${failureMessage}`;
    if (destinationId) {
        await slackAPICallForNotification('POST', 'chat.postMessage', accessToken, {
            channel: destinationId,
            text,
            unfurl_links: 'false',
        });
    }
    else {
        logger_1.logger.error('No destinationId for sendSlackNotification with destination', { destination });
    }
    return userFromSlackEmail;
}
async function slackAPICallForNotification(method, apiMethod, accessToken, params = null) {
    try {
        return await (0, slack_1.slackAPICall)(method, apiMethod, accessToken, params);
    }
    catch (err) {
        if (err instanceof slack_1.SlackAPIError) {
            throw new FailedNotificationError(err.message);
        }
        else {
            throw err;
        }
    }
}
function plausibleSlackUser(handle) {
    return handle.startsWith('@');
}
function plausibleSlackChannel(channel) {
    return channel.startsWith('#');
}
exports.default = notify;
