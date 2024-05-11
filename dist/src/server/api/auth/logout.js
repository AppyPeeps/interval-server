"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../../../server/auth");
async function logoutRoute(req, res) {
    if (req.session.session) {
        await (0, auth_1.logoutSession)(req.session.session.id);
    }
    req.session.destroy();
    res.status(200).send(true);
}
exports.default = logoutRoute;
