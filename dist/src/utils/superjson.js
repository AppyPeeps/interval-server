"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const superjson_1 = __importDefault(require("superjson"));
// Custom transformer for python time strings (HH:MM:SS)
superjson_1.default.registerCustom({
    isApplicable: (v) => typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v),
    serialize: v => String(v),
    deserialize: v => String(v),
}, 'time');
exports.default = superjson_1.default;
