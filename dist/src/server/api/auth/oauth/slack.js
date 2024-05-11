"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../../../../server/prisma"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const url_1 = require("url");
const env_1 = __importDefault(require("../../../../env"));
const logger_1 = require("../../../../server/utils/logger");
const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
async function slackOauth(req, res) {
    if (!req.session.session) {
        res.status(401).end();
        return;
    }
    if (!env_1.default.SLACK_CLIENT_ID) {
        throw new Error('Missing SLACK_CLIENT_ID environment variable');
    }
    if (!env_1.default.SLACK_CLIENT_SECRET) {
        throw new Error('Missing SLACK_CLIENT_SECRET environment variable');
    }
    let oauthResult = 'error';
    const { code, error, state } = req.query;
    const org = await prisma_1.default.organization.findUnique({
        where: {
            id: req.session.currentOrganizationId,
        },
    });
    if (!req.session.user) {
        throw new Error('Attempted slack oauth for session without a user?');
    }
    if (!org) {
        throw new Error('Attempted slack oauth for user session without a org?');
    }
    const access = await prisma_1.default.userOrganizationAccess.findFirst({
        where: {
            user: { id: req.session.user.id },
            organization: {
                id: req.session.currentOrganizationId,
            },
        },
    });
    if (!access) {
        throw new Error('Attempted slack oauth for user session without a org access?');
    }
    if (access.slackOauthNonce !== state) {
        oauthResult = 'invalid_state_param';
    }
    else if (error) {
        oauthResult = error;
    }
    else if (code) {
        const rawResponse = await (0, node_fetch_1.default)(SLACK_OAUTH_ACCESS_URL, {
            method: 'POST',
            body: new url_1.URLSearchParams({
                code: code,
                redirect_uri: `${env_1.default.APP_URL}/api/auth/oauth/slack`,
                client_id: env_1.default.SLACK_CLIENT_ID,
                client_secret: env_1.default.SLACK_CLIENT_SECRET,
            }),
        });
        const response = await rawResponse.json();
        if (response.access_token) {
            await prisma_1.default.organization.update({
                where: {
                    id: req.session.currentOrganizationId,
                },
                data: {
                    private: {
                        upsert: {
                            create: {
                                slackAccessToken: response.access_token,
                            },
                            update: {
                                slackAccessToken: response.access_token,
                            },
                        },
                    },
                },
            });
            oauthResult = 'success';
        }
        else {
            logger_1.logger.error('Slack OAuth error', { error: response['error'] });
            oauthResult = 'error';
        }
    }
    res.redirect(`/dashboard/${org.slug}/organization/settings?oauth_result=${oauthResult}`);
}
exports.default = slackOauth;
