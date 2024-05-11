"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const iron_session_1 = require("iron-session");
const prisma_1 = __importDefault(require("../../../server/prisma"));
const auth_1 = require("../../../server/auth");
const logger_1 = require("../../../server/utils/logger");
async function resetPasswordRoute(req, res) {
    const { seal, password, passwordConfirm } = req.body;
    try {
        if (!seal ||
            !password ||
            !passwordConfirm ||
            password !== passwordConfirm) {
            throw new PasswordResetError('Invalid input');
        }
        const unsealed = await (0, iron_session_1.unsealData)(seal, {
            password: auth_1.ironSessionOptions.password,
        });
        const resetToken = await prisma_1.default.userPasswordResetToken.delete({
            where: {
                id: unsealed.resetTokenId,
            },
        });
        if (resetToken.expiresAt < new Date()) {
            throw new PasswordResetError('Reset token expired', 403);
        }
        const user = await prisma_1.default.user.update({
            where: {
                id: resetToken.userId,
            },
            data: {
                password: (0, auth_1.encryptPassword)(password),
            },
            select: {
                id: true,
                lastName: true,
                firstName: true,
                email: true,
                mfaId: true,
            },
        });
        // Log user out of all existing sessions
        await prisma_1.default.userSession.deleteMany({
            where: {
                userId: resetToken.userId,
            },
        });
        const session = await prisma_1.default.userSession.create({
            data: {
                user: {
                    connect: {
                        id: user.id,
                    },
                },
            },
        });
        req.session.user = user;
        req.session.session = session;
        req.session.currentOrganizationId = undefined;
        await req.session.save();
        res.status(200).send(true);
    }
    catch (err) {
        logger_1.logger.error('Failed to reset password', { error: err });
        if (err instanceof PasswordResetError) {
            res.status(err.code).send(err.message);
        }
        else {
            res.status(400).send(false);
        }
    }
}
exports.default = resetPasswordRoute;
class PasswordResetError extends Error {
    message;
    code = 400;
    constructor(message, code) {
        super(message);
        this.message = message;
        if (code) {
            this.code = code;
        }
    }
}
