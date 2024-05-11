"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./server/utils/logger");
try {
    dotenv_1.default.config();
}
catch (err) {
    console.error('Failed loading .env', err);
}
const schema = zod_1.z.object({
    // required for basic app functionality
    APP_URL: zod_1.z.string(),
    DATABASE_URL: zod_1.z.string(),
    SECRET: zod_1.z.string(),
    WSS_API_SECRET: zod_1.z.string(),
    AUTH_COOKIE_SECRET: zod_1.z.string(),
    GIT_COMMIT: zod_1.z.string().optional(),
    PORT: zod_1.z.string().optional().default('3000'),
    // emails
    POSTMARK_API_KEY: zod_1.z.string().optional(),
    EMAIL_FROM: zod_1.z.string().optional().default('Interval <help@interval.com>'),
    // authentication
    WORKOS_API_KEY: zod_1.z.string().optional(),
    WORKOS_CLIENT_ID: zod_1.z.string().optional(),
    WORKOS_WEBHOOK_SECRET: zod_1.z.string().optional(),
    // notifications
    SLACK_CLIENT_ID: zod_1.z.string().optional(),
    SLACK_CLIENT_SECRET: zod_1.z.string().optional(),
    // file uploads
    S3_KEY_ID: zod_1.z.string().optional(),
    S3_KEY_SECRET: zod_1.z.string().optional(),
    S3_BUCKET: zod_1.z.string().optional(),
    S3_REGION: zod_1.z.string().optional(),
});
const possiblyValid = schema.safeParse(process.env);
if (!possiblyValid.success) {
    const missing = possiblyValid.error.issues.map(i => i.path).flat();
    logger_1.logger.error(`Missing required environment variables: \n - ${missing.join('\n - ')}`);
    process.exit(1);
}
const validated = possiblyValid.data;
exports.default = validated;
