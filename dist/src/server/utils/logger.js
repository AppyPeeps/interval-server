"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProduction ? 'verbose' : 'silly');
/**
 * Custom formatter to actually send nested Error objects.
 * Basically winston.format.errors but on second-level properties.
 */
const enumerateErrorFormat = winston_1.default.format(info => {
    for (const key in info) {
        try {
            const err = info[key];
            if (err instanceof Error) {
                info[key] = {
                    name: err.name,
                    message: err.message,
                    stack: err.stack,
                    cause: err.cause,
                };
            }
        }
        catch (err) {
            // Just to be extra safe, this shouldn't happen
            console.error('Failed transforming Error contents', err);
        }
    }
    return info;
});
const format = winston_1.default.format.combine(winston_1.default.format.errors({ stack: true }), enumerateErrorFormat(), winston_1.default.format.json());
let transports = new winston_1.default.transports.Console({
    format: winston_1.default.format.combine(winston_1.default.format.errors({ stack: true }), winston_1.default.format.align(), winston_1.default.format.colorize({
        all: true,
    }), winston_1.default.format.simple()
    // Useful for complex logs, maybe enable this conditionally somehow?
    // winston.format.prettyPrint({
    //   colorize: true,
    // })
    ),
});
const logger = winston_1.default.createLogger({
    level,
    format,
    transports,
    handleExceptions: true,
    handleRejections: true,
});
exports.logger = logger;
