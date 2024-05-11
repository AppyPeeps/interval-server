"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformer = void 0;
const superjson_1 = __importDefault(require("../../utils/superjson"));
const devalue_1 = __importDefault(require("devalue"));
// Use superjson for client -> server because it's safe
// Use devalue for server -> client because it's fast
// https://trpc.io/docs/data-transformers#different-transformers-for-upload-and-download
exports.transformer = {
    input: superjson_1.default,
    output: {
        serialize: d => (0, devalue_1.default)(d),
        deserialize: d => eval(`(${d})`),
    },
};
