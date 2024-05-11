"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ws_1 = require("ws");
const prisma_1 = __importDefault(require("./prisma"));
const env_1 = __importDefault(require("../env"));
const router = (0, express_1.Router)();
router.get('/app', function (req, res) {
    res.set('Cache-Control', 'no-store');
    res.send('OK');
});
router.get('/rev', function (req, res) {
    res.set('Cache-Control', 'no-store');
    res.send(env_1.default.GIT_COMMIT);
});
router.get('/db', async function (req, res) {
    const userCount = await prisma_1.default.user.count();
    res.set('Cache-Control', 'no-store');
    res.send(userCount > 0 ? 'OK' : 'KO');
});
router.get('/wss', function (req, res) {
    res.set('Cache-Control', 'no-store');
    const ws = new ws_1.WebSocket('ws://localhost:3002');
    ws.onopen = () => {
        res.send('OK');
    };
    ws.onerror = () => {
        res.sendStatus(500);
    };
});
exports.default = router;
