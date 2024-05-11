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
const trpcExpress = __importStar(require("@trpc/server/adapters/express"));
const utils_1 = require("../../utils/trpc/utils");
const actionGroup_1 = require("./actionGroup");
const user_1 = require("./user");
const auth_1 = require("./auth");
const organization_1 = require("./organization");
const apiKeys_1 = require("./apiKeys");
const action_1 = require("./action");
const util_1 = require("./util");
const transaction_1 = require("./transaction");
const dashboard_1 = require("./dashboard");
const group_1 = require("./group");
const uploads_1 = require("./uploads");
const httpHosts_1 = require("./httpHosts");
const environments_1 = require("./environments");
const logger_1 = require("../../server/utils/logger");
const env_1 = __importDefault(require("../../env"));
const appRouter = (0, util_1.createRouter)()
    .transformer(utils_1.transformer)
    .query('app.commit-rev', {
    async resolve() {
        return env_1.default.GIT_COMMIT;
    },
})
    .merge('actionGroup.', actionGroup_1.actionGroupRouter)
    .merge('auth.', auth_1.authRouter)
    .merge('user.', user_1.userRouter)
    .merge('organization.', organization_1.organizationRouter)
    .merge('key.', apiKeys_1.keyRouter)
    .merge('transaction.', transaction_1.transactionRouter)
    .merge('action.', action_1.actionRouter)
    .merge('dashboard.', dashboard_1.dashboardRouter)
    .merge('group.', group_1.groupRouter)
    .merge('uploads.', uploads_1.uploadsRouter)
    .merge('http-hosts.', httpHosts_1.httpHostsRouter)
    .merge('environments.', environments_1.environmentsRouter)
    .middleware(util_1.authenticatedMiddleware)
    .query('app.node-env', {
    async resolve() {
        return process.env.NODE_ENV;
    },
});
const trpcRouter = trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext: util_1.createContext,
    onError({ error }) {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
            logger_1.logger.error('Something went wrong', { error });
        }
    },
});
exports.default = trpcRouter;
