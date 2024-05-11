"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slackAPICall = exports.getChannelsFromSlackIntegration = exports.SlackAPIError = void 0;
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const logger_1 = require("../../server/utils/logger");
class SlackAPIError extends Error {
    constructor(message) {
        super(message);
    }
}
exports.SlackAPIError = SlackAPIError;
async function getChannelsFromSlackIntegration(accessToken, orgSlug) {
    let nextCursor = 'first';
    const channels = [];
    let types = 'public_channel,private_channel';
    while (nextCursor) {
        const body = {
            exclude_archived: 'true',
            types,
        };
        if (nextCursor !== 'first') {
            body['cursor'] = nextCursor;
        }
        try {
            const channelsResponse = await slackAPICall('GET', 'conversations.list', accessToken, body);
            channels.push(...channelsResponse.channels
                .filter(c => c.is_member)
                .map(c => ({ id: c.id, name: c.name, is_member: c.is_member })));
            if (channelsResponse['response_metadata'] &&
                channelsResponse['response_metadata']['next_cursor'] &&
                channelsResponse['response_metadata']['next_cursor'] !== '') {
                nextCursor = channelsResponse['response_metadata']['next_cursor'];
            }
            else {
                nextCursor = null;
            }
        }
        catch (error) {
            if (error instanceof SlackAPIError &&
                error.message === 'Error communicating with Slack: missing_scope') {
                logger_1.logger.error('Organization needs to re-oauth Slack for private channel access', {
                    orgSlug,
                });
                // retry with just public channels
                types = 'public_channel';
            }
            else {
                logger_1.logger.error('Error sending slack message', error);
                nextCursor = null;
            }
        }
    }
    return channels;
}
exports.getChannelsFromSlackIntegration = getChannelsFromSlackIntegration;
async function slackAPICall(method, apiMethod, accessToken, params = null) {
    const urlParams = params && method === 'GET' ? `?` + new URLSearchParams(params) : '';
    const url = `https://slack.com/api/${apiMethod}${urlParams}`;
    const headers = {
        Authorization: `Bearer ${accessToken}`,
    };
    let body;
    if (method === 'POST') {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        body = JSON.stringify(params);
    }
    const response = await (0, cross_fetch_1.default)(url, {
        method,
        headers,
        body,
    }).then(res => {
        if (!res.ok) {
            throw new SlackAPIError(`Error communicating to Slack: ${res.statusText}`);
        }
        return res.json();
    });
    if (response['error']) {
        if (response['error'] === 'account_inactive') {
            throw new SlackAPIError(`The Interval app has been uninstalled from your Slack workspace. You'll need to reconnect to send Slack notifications.`);
        }
        else {
            throw new SlackAPIError(`Error communicating with Slack: ${response['error']}`);
        }
    }
    return response;
}
exports.slackAPICall = slackAPICall;
