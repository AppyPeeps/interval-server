"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardL1Paths = exports.DASHBOARD_ROUTES_GLOB = exports.ROUTES_GLOB = void 0;
const glob_1 = __importDefault(require("glob"));
const routes_1 = require("../../utils/routes");
// Should keep these in sync with those in `src/App.tsx`; they must be literals there.
exports.ROUTES_GLOB = 'src/pages/**/[a-z[]*.{tsx,mdx}';
exports.DASHBOARD_ROUTES_GLOB = 'src/pages/dashboard/\\[orgSlug\\]/*/**/[a-z]*.{tsx,mdx}';
const DASHBOARD_ROUTES = glob_1.default.sync(exports.DASHBOARD_ROUTES_GLOB);
exports.dashboardL1Paths = (0, routes_1.getDashboardL1Paths)(DASHBOARD_ROUTES);
