"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = exports.formatDateTime = exports.percentageFormatter = exports.timeFormatter = exports.timeZoneFormatter = exports.yearlessDateFormatter = exports.numericDateFormatter = exports.shortDateFormatter = exports.dateFormatter = exports.dateTimeFormatterWithTimeZone = exports.dateTimeFormatter = void 0;
const luxon_1 = require("luxon");
exports.dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
});
exports.dateTimeFormatterWithTimeZone = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
});
exports.dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
});
exports.shortDateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
});
exports.numericDateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
});
exports.yearlessDateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
});
exports.timeZoneFormatter = new Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short',
});
exports.timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
});
exports.percentageFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
});
function formatDateTime(date, timeZoneName) {
    let dt = luxon_1.DateTime.fromJSDate(date);
    if (timeZoneName) {
        const z = new luxon_1.IANAZone(timeZoneName);
        if (z.isValid) {
            dt = dt.setZone(timeZoneName);
        }
    }
    return dt.toLocaleString({
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZoneName: 'short',
    });
}
exports.formatDateTime = formatDateTime;
function formatDate(date, timeZoneName) {
    let dt = luxon_1.DateTime.fromJSDate(date);
    if (timeZoneName) {
        const z = new luxon_1.IANAZone(timeZoneName);
        if (z.isValid) {
            dt = dt.setZone(timeZoneName);
        }
    }
    return dt.toLocaleString({
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}
exports.formatDate = formatDate;
