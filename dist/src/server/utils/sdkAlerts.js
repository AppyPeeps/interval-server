"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSdkAlert = void 0;
const prisma_1 = __importDefault(require("../../server/prisma"));
async function getSdkAlert(sdkName, sdkVersion) {
    return prisma_1.default.sdkAlert.findFirst({
        where: {
            sdkName,
            minSdkVersion: {
                gt: sdkVersion,
            },
        },
        orderBy: [
            {
                severity: 'desc',
            },
            {
                minSdkVersion: 'desc',
            },
        ],
    });
}
exports.getSdkAlert = getSdkAlert;
