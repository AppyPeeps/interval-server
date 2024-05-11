"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@interval/sdk");
const ts_dedent_1 = __importDefault(require("ts-dedent"));
const processVars_1 = require("../../../wss/processVars");
const hosts_1 = __importDefault(require("./hosts"));
const clients_1 = __importDefault(require("./clients"));
exports.default = new sdk_1.Page({
    name: 'WSS State',
    routes: {
        hosts: hosts_1.default,
        clients: clients_1.default,
        pending_loading_calls: new sdk_1.Page({
            name: 'Pending IO calls',
            handler: async () => {
                const ioCalls = Array.from(processVars_1.pendingIOCalls.entries()).map(([id, ioCall]) => ({ id, ioCall }));
                return new sdk_1.Layout({
                    children: [
                        sdk_1.io.display.table('Pending loading calls', {
                            data: ioCalls,
                            columns: [
                                'id',
                                {
                                    label: 'ioCall',
                                    renderCell: row => (0, ts_dedent_1.default) `
                  ~~~json
                  ${row.ioCall}
                  ~~~
                  `,
                                },
                            ],
                        }),
                    ],
                });
            },
        }),
        pending_loading_states: new sdk_1.Page({
            name: 'Pending loading states',
            handler: async () => {
                const loadingStates = Array.from(processVars_1.transactionLoadingStates.entries()).map(([id, state]) => ({ id, ...state }));
                return new sdk_1.Layout({
                    children: [
                        sdk_1.io.display.table('Loading states', {
                            data: loadingStates,
                            columns: [
                                'id',
                                'label',
                                'description',
                                'itemsInQueue',
                                'itemsCompleted',
                            ],
                        }),
                    ],
                });
            },
        }),
    },
});
