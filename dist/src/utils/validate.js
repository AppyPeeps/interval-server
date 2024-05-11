"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNumber = exports.validateNumber = exports.InvalidNumberError = exports.deserializeDate = exports.isEmail = exports.isOrgSlugValid = exports.isURLSafe = exports.isGroupSlugValid = exports.isSlugValid = void 0;
const text_1 = require("../utils/text");
function isSlugValid(slug) {
    if (slug === '')
        return false;
    if (/[^-_.a-zA-Z\d]/.test(slug))
        return false;
    return true;
}
exports.isSlugValid = isSlugValid;
function isGroupSlugValid(prefix) {
    if (prefix === undefined)
        return true;
    if (prefix === '')
        return false;
    // Disallow double slash //
    if (/\/\//.test(prefix))
        return false;
    if (/[^-_.a-zA-Z\d/]/.test(prefix))
        return false;
    return true;
}
exports.isGroupSlugValid = isGroupSlugValid;
function isURLSafe(slug) {
    return slug === encodeURIComponent(slug);
}
exports.isURLSafe = isURLSafe;
function isOrgSlugValid(slug) {
    return (isSlugValid(slug) &&
        slug.toLowerCase() === slug &&
        isURLSafe(slug) &&
        !/\./.test(slug) &&
        slug.length >= 2);
}
exports.isOrgSlugValid = isOrgSlugValid;
function isEmail(email) {
    // Copied from zod
    // https://github.com/colinhacks/zod/blob/c63a5988613f0accb2099d88f05db4201618ad6e/src/types.ts#L425
    return /^(([^<>()[\].,;:\s@"]+(\.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{2,})$/i.test(email);
}
exports.isEmail = isEmail;
function deserializeDate(s) {
    const d = new Date(s);
    if (d.toJSON() === s)
        return d;
    return null;
}
exports.deserializeDate = deserializeDate;
class InvalidNumberError extends Error {
}
exports.InvalidNumberError = InvalidNumberError;
/**
 * Throws an InvalidNumberError if the number is not valid.
 */
function validateNumber(value, props) {
    const valueAsNumber = Number(value);
    const valueAsString = value.toString();
    if (valueAsString.length === 0) {
        throw new InvalidNumberError('Please enter a valid number.');
    }
    if (isNaN(valueAsNumber)) {
        throw new InvalidNumberError('Please enter a valid number.');
    }
    let constraintDetails;
    if (props?.min !== undefined && props?.max !== undefined) {
        constraintDetails = `between ${props.min} and ${props.max}`;
    }
    else if (props?.min !== undefined) {
        constraintDetails = `greater than or equal to ${props.min}`;
    }
    else if (props?.max !== undefined) {
        constraintDetails = `less than or equal to ${props.max}`;
    }
    if ((props?.min !== undefined && valueAsNumber < props.min) ||
        (props?.max !== undefined && valueAsNumber > props.max)) {
        throw new InvalidNumberError(`Please enter a number ${constraintDetails}.`);
    }
    const decimals = props?.decimals ?? 0;
    const places = valueAsString.split('.')[1];
    if (places !== undefined && places.length > decimals) {
        throw new InvalidNumberError(decimals
            ? `Please enter a number with up to ${decimals} decimal ${(0, text_1.pluralize)(decimals, 'place', 'places')}.`
            : 'Please enter a whole number.');
    }
    if (valueAsString === 'Infinity') {
        throw new InvalidNumberError('Please enter a valid number.');
    }
    return valueAsNumber;
}
exports.validateNumber = validateNumber;
function isNumber(value, options) {
    try {
        validateNumber(value, options);
        return true;
    }
    catch {
        return false;
    }
}
exports.isNumber = isNumber;
