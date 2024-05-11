"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../../../server/auth");
const prisma_1 = __importDefault(require("../../../server/prisma"));
const logger_1 = require("../../../server/utils/logger");
async function loginRoute(req, res) {
    const { email, password, transactionId } = req.body;
    if (!email || !password || Array.isArray(email) || Array.isArray(password)) {
        res.status(400).send(false);
        return;
    }
    try {
        const { user, session } = await (0, auth_1.tryLogin)(email, password);
        req.session.user = user;
        req.session.session = session;
        await req.session.save();
        if (user) {
            const fullUser = await prisma_1.default.user.findUnique({
                where: { email: user.email },
            });
            const requiredConfirmation = fullUser
                ? await (0, auth_1.requiredIdentityConfirmation)(fullUser)
                : null;
            if (requiredConfirmation === 'PASSWORD') {
                try {
                    const now = new Date();
                    await prisma_1.default.userSession.update({
                        where: { id: session.id },
                        data: { identityConfirmedAt: now },
                    });
                    if (transactionId) {
                        await prisma_1.default.transactionRequirement.updateMany({
                            where: { transactionId, type: 'IDENTITY_CONFIRM' },
                            data: { satisfiedAt: now },
                        });
                    }
                }
                catch (err) {
                    logger_1.logger.error('Login: Unable to confirm identity', { error: err });
                }
            }
        }
        res.status(200).send(true);
    }
    catch (err) {
        res.status(401).send(false);
    }
}
exports.default = loginRoute;
