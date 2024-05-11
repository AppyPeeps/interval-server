"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../auth");
describe('generateKey', () => {
    const user = {
        firstName: 'Something-complicated and long',
    };
    test('environments', () => {
        expect((0, auth_1.generateKey)(user, 'DEVELOPMENT')).toMatch(/_dev_/);
        expect((0, auth_1.generateKey)(user, 'PRODUCTION')).toMatch(/^live_/);
    });
    test('name prefix cleans name', () => {
        expect((0, auth_1.generateKey)(user, 'DEVELOPMENT')).toMatch(/somethingcomplicatedandlong_dev_/);
    });
});
