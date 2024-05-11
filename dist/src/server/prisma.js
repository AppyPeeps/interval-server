"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const logger_1 = require("./utils/logger");
const env_1 = __importDefault(require("../env"));
const prisma = global.prisma ??
    new client_1.PrismaClient({
        datasources: {
            db: {
                url: env_1.default.DATABASE_URL,
            },
        },
    });
try {
    //@ts-ignore undocumented prisma field
    const dbUrlString = prisma._engine.config.overrideDatasources.db.url;
    const dbUrl = new URL(dbUrlString);
    logger_1.logger.info(`[Prisma] Connecting to database as user: ${dbUrl.username}`);
    if (dbUrl.host.includes('interval2-prod-do-user-860008')) {
        logger_1.logger.info(`[Prisma] 🚨 Connecting to prod DB 🚨`);
    }
}
catch (e) {
    logger_1.logger.info('Failed to determine Prisma URL');
}
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}
exports.default = prisma;
