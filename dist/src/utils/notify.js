"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completionMessage = exports.completionTitle = void 0;
function completionTitle(resultStatus) {
    switch (resultStatus) {
        case 'SUCCESS':
        case 'REDIRECTED':
            return 'Transaction completed: Success ✅';
        case 'FAILURE':
            return 'Transaction completed: Failure ❌';
        case 'CANCELED':
            return 'Transaction canceled.';
    }
}
exports.completionTitle = completionTitle;
function completionMessage(resultStatus, actionName = 'An action') {
    switch (resultStatus) {
        case 'SUCCESS':
        case 'REDIRECTED':
            return `${actionName} has completed successfully, see the transaction history for more information.`;
        case 'FAILURE':
            return `${actionName} has failed, see the transaction history for more information.`;
        case 'CANCELED':
            return `A transaction for ${actionName} has been canceled.`;
    }
}
exports.completionMessage = completionMessage;
