"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.colorStringToBorderClassNames = exports.colorStringToHexCode = exports.ENV_COLOR_OPTIONS = void 0;
exports.ENV_COLOR_OPTIONS = {
    none: null,
    red: '#dc2626',
    orange: '#f59e0b',
    green: '#65a30d',
    cyan: '#06b6d4',
    indigo: '#4f46e5',
    pink: '#d946ef',
    gray: '#9ca3af',
};
function colorStringToHexCode(color) {
    if (!color || !(color in exports.ENV_COLOR_OPTIONS))
        return undefined;
    return exports.ENV_COLOR_OPTIONS[color];
}
exports.colorStringToHexCode = colorStringToHexCode;
function colorStringToBorderClassNames(color) {
    switch (color) {
        case 'none':
        case null:
        case undefined:
            return 'border-gray-300';
        case 'red':
            return 'ring-red-400 border-transparent';
        case 'orange':
            return 'ring-amber-400 border-transparent';
        case 'green':
            return 'ring-lime-400 border-transparent';
        case 'teal':
            return 'ring-teal-400 border-transparent';
        case 'indigo':
            return 'ring-indigo-400 border-transparent';
        case 'pink':
            return 'ring-pink-400 border-transparent';
        case 'gray':
            return 'ring-gray-400 border-transparent';
        default:
            return undefined;
    }
}
exports.colorStringToBorderClassNames = colorStringToBorderClassNames;
