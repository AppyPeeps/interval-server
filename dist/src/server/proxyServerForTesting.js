"use strict";
/**
 * This emulates the development proxy setup to facilitate testing the
 * compiled JavaScript code in a non-production environment.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const http_proxy_1 = __importDefault(require("http-proxy"));
require(".");
require("../wss");
const logger_1 = require("./utils/logger");
if (process.env.NODE_ENV !== 'production') {
    const proxy = http_proxy_1.default.createProxyServer({});
    const server = http_1.default.createServer((req, res) => {
        if (!req.url)
            return;
        proxy.web(req, res, {
            target: 'http://localhost:3001',
        }, err => {
            logger_1.logger.error('Failed proxying', err);
            res.end();
        });
    });
    server.on('upgrade', (req, socket, head) => {
        proxy.ws(req, socket, head, {
            target: 'ws://localhost:3002',
        });
    });
    server.listen(3000);
}
