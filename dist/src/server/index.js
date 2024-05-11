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
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importStar(require("express"));
const auth_1 = __importDefault(require("./api/auth"));
const actions_1 = __importDefault(require("./api/actions"));
const notify_1 = __importDefault(require("./api/notify"));
const hosts_1 = __importDefault(require("./api/hosts"));
const workosWebhooks_1 = __importDefault(require("./api/workosWebhooks"));
const trpc_1 = __importDefault(require("./trpc"));
const healthCheck_1 = __importDefault(require("./healthCheck"));
const requestLogger_1 = __importDefault(require("./middleware/requestLogger"));
const auth_2 = require("./auth");
require("../env");
const bundledIndexFilePath = path_1.default.join(__dirname, '../../client/index.html');
const isBundled = fs_1.default.existsSync(bundledIndexFilePath);
const isProduction = process.env.NODE_ENV === 'production';
const router = (0, express_1.Router)();
router.use(requestLogger_1.default);
router.use(express_1.default.json());
// WorkOS Webhooks expect express.json()
router.use('/api/webhooks/workos', workosWebhooks_1.default);
router.use(auth_2.sessionMiddleware);
router.use(auth_2.clearDomainlessCookie);
router.use('/health-check', healthCheck_1.default);
router.use('/api/auth', auth_1.default);
router.use('/api/trpc', trpc_1.default);
router.use('/api/actions', actions_1.default);
router.use('/api/notify', notify_1.default);
router.use('/api/hosts', hosts_1.default);
router.get('/api/system/reboot', (_req, res) => {
    if (isProduction)
        res.sendStatus(404);
    const pathname = path_1.default.join(__dirname, './index.ts');
    fs_1.default.utimesSync(pathname, new Date(), new Date());
    res.sendStatus(200);
});
if (isBundled) {
    const assets = [
        'app-assets',
        'favicon.png',
        'open-graph-twitter-1600w.png',
        'open-graph.png',
        'app.webmanifest',
    ];
    for (const asset of assets) {
        router.use(`/${asset}`, express_1.default.static(path_1.default.join(__dirname, `../../client/${asset}`)));
    }
    // Handle client-side routing, return all requests to the app
    router.get('*', async (_, response) => {
        response.sendFile(bundledIndexFilePath);
    });
}
exports.default = router;
