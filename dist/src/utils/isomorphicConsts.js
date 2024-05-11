"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PYTHON_SDK_NAME = exports.NODE_SDK_NAME = exports.CLIENT_ISOCKET_ID_SEARCH_PARAM_KEY = exports.SLACK_OAUTH_SCOPES = exports.TRANSACTION_ID_SEARCH_PARAM_KEY = exports.INTERVAL_USAGE_ENVIRONMENT = exports.ME_LOCAL_STORAGE_KEY = exports.REFERRAL_LOCAL_STORAGE_KEY = exports.AUTH_COOKIE_NAME = void 0;
// consts that can safely be imported in the browser or server (eg. not secrets)
exports.AUTH_COOKIE_NAME = 'interval_auth_cookie';
exports.REFERRAL_LOCAL_STORAGE_KEY = '__INTERVAL_REFERRAL_INFO';
exports.ME_LOCAL_STORAGE_KEY = '__INTERVAL_ME';
exports.INTERVAL_USAGE_ENVIRONMENT = '__INTERVAL_USAGE_ENVIRONMENT';
exports.TRANSACTION_ID_SEARCH_PARAM_KEY = '__INTERVAL_TRANSACTION_ID';
exports.SLACK_OAUTH_SCOPES = 'im:write,chat:write,channels:read,groups:read,users:read,users:read.email';
exports.CLIENT_ISOCKET_ID_SEARCH_PARAM_KEY = '__INTERVAL_CLIENT_ISOCKET_ID';
exports.NODE_SDK_NAME = '@interval/sdk';
exports.PYTHON_SDK_NAME = 'interval-py';
