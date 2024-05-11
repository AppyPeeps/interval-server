"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDomain = exports.isEmail = void 0;
var validate_1 = require("./validate");
Object.defineProperty(exports, "isEmail", { enumerable: true, get: function () { return validate_1.isEmail; } });
function getDomain(email) {
    const index = email.indexOf('@');
    if (index < 0)
        return undefined;
    return email.substring(index + 1);
}
exports.getDomain = getDomain;
