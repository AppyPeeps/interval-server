"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTransactionUploads = exports.getIOPresignedDownloadUrl = exports.getIOPresignedUploadUrl = exports.S3_UPLOADS_ENABLED = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const env_1 = __importDefault(require("../../env"));
function isS3Available(env) {
    return (typeof env.S3_KEY_ID === 'string' &&
        typeof env.S3_KEY_SECRET === 'string' &&
        typeof env.S3_REGION === 'string' &&
        typeof env.S3_BUCKET === 'string');
}
exports.S3_UPLOADS_ENABLED = isS3Available(env_1.default);
function getS3Client() {
    if (!isS3Available(env_1.default)) {
        throw new Error('Please provide S3 credentials to enable file uploads. Visit the docs for more info: https://interval.com/docs');
    }
    return new client_s3_1.S3Client({
        region: env_1.default.S3_REGION,
        credentials: {
            accessKeyId: env_1.default.S3_KEY_ID,
            secretAccessKey: env_1.default.S3_KEY_SECRET,
        },
    });
}
async function getIOPresignedUploadUrl(key) {
    const s3Client = getS3Client();
    const command = new client_s3_1.PutObjectCommand({
        Bucket: env_1.default.S3_BUCKET,
        Key: key,
    });
    const signedUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, {
        expiresIn: 3600, // 1 hour
    });
    return signedUrl;
}
exports.getIOPresignedUploadUrl = getIOPresignedUploadUrl;
async function getIOPresignedDownloadUrl(key) {
    const s3Client = getS3Client();
    const command = new client_s3_1.GetObjectCommand({
        Bucket: env_1.default.S3_BUCKET,
        Key: key,
    });
    const signedUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, {
        expiresIn: 48 * 60 * 60, // 48 hours
    });
    return signedUrl;
}
exports.getIOPresignedDownloadUrl = getIOPresignedDownloadUrl;
async function deleteIOObjects(keys) {
    const s3Client = getS3Client();
    const command = new client_s3_1.DeleteObjectsCommand({
        Bucket: env_1.default.S3_BUCKET,
        Delete: {
            Objects: keys.map(Key => ({ Key })),
        },
    });
    return await s3Client.send(command);
}
async function findIOObjects(transactionId) {
    const s3Client = getS3Client();
    const command = new client_s3_1.ListObjectsV2Command({
        Bucket: env_1.default.S3_BUCKET,
        Prefix: transactionId,
    });
    return await s3Client.send(command);
}
async function deleteTransactionUploads(transactionId) {
    if (!exports.S3_UPLOADS_ENABLED)
        return;
    const response = await findIOObjects(transactionId);
    if (response.Contents?.length) {
        const keys = response.Contents.filter(object => object.Key).map(object => object.Key);
        await deleteIOObjects(keys);
    }
}
exports.deleteTransactionUploads = deleteTransactionUploads;
