"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralInfoSchema = void 0;
const zod_1 = require("zod");
exports.referralInfoSchema = zod_1.z
    .object({
    referrer: zod_1.z.string().nullish(),
    utmSource: zod_1.z.string().nullish(),
    utmMedium: zod_1.z.string().nullish(),
    utmCampaign: zod_1.z.string().nullish(),
    utmTerm: zod_1.z.string().nullish(),
    utmContent: zod_1.z.string().nullish(),
})
    .optional();
