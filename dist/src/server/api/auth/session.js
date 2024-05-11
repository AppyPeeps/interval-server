"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../../../server/auth");
const logger_1 = require("../../../server/utils/logger");
async function sessionRoute(req, res) {
    if (req.session.session) {
        try {
            const { user, session } = await (0, auth_1.validateSession)(req.session.session.id);
            req.session.user = user;
            req.session.session = session;
            await req.session.save();
            res.status(200).end();
            return;
        }
        catch (err) {
            if (err instanceof auth_1.AuthenticationError) {
                switch (err.code) {
                    case 'INVALID':
                    case 'EXPIRED':
                    case 'NOT_FOUND':
                        logger_1.logger.error('Invalid or expired session, clearing', {
                            sessionId: req?.session?.session?.id,
                            error: err,
                        });
                        req.session.destroy();
                }
                res.status(401).json({ code: err.code });
                return;
            }
            else {
                logger_1.logger.error('Invalid session', { error: err });
            }
        }
    }
    res.status(401).end();
}
exports.default = sessionRoute;
