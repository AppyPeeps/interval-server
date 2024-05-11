"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncActionSchedules = exports.isValid = exports.isInputValid = void 0;
const cron = __importStar(require("node-cron"));
const actionSchedule_1 = require("../../utils/actionSchedule");
const wss_1 = require("./wss");
function isInputValid(input) {
    const schedule = (0, actionSchedule_1.toCronSchedule)(input);
    if (!schedule)
        return false;
    return cron.validate((0, actionSchedule_1.cronScheduleToString)(schedule));
}
exports.isInputValid = isInputValid;
function isValid(schedule) {
    return cron.validate((0, actionSchedule_1.cronScheduleToString)(schedule));
}
exports.isValid = isValid;
async function syncActionSchedules(action, inputs) {
    return (0, wss_1.makeApiCall)('/api/action-schedules/sync', JSON.stringify({
        actionId: action.id,
        inputs,
    }));
}
exports.syncActionSchedules = syncActionSchedules;
