"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const email_templates_1 = __importDefault(require("email-templates"));
const handlebars_1 = __importDefault(require("handlebars"));
const preview_email_1 = __importDefault(require("preview-email"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const postmark_1 = require("postmark");
const env_1 = __importDefault(require("../env"));
const logger_1 = require("../server/utils/logger");
const TEMPLATES_FOLDER = path_1.default.join(__dirname, '..', '..', '..', 'email-templates');
handlebars_1.default.registerPartial('layout', fs_1.default.readFileSync(path_1.default.join(TEMPLATES_FOLDER, 'partials', 'layout.hbs'), {
    encoding: 'utf-8',
}));
handlebars_1.default.registerPartial('actionButton', fs_1.default.readFileSync(path_1.default.join(TEMPLATES_FOLDER, 'partials', 'action-button.hbs'), {
    encoding: 'utf-8',
}));
handlebars_1.default.registerHelper('if_equals', function (a, b, options) {
    if (a == b) {
        //@ts-ignore
        return options.fn(this);
    }
    //@ts-ignore
    return options.inverse(this);
});
handlebars_1.default.registerHelper('unless_equals', function (a, b, options) {
    if (a !== b) {
        //@ts-ignore
        return options.fn(this);
    }
    //@ts-ignore
    return options.inverse(this);
});
const emailTemplate = new email_templates_1.default({
    message: {},
    views: {
        options: {
            extension: 'hbs',
        },
        root: path_1.default.join(TEMPLATES_FOLDER, 'messages'),
    },
});
/**
 * Prepares an email to pass to a sender, such as Postmark.
 */
async function prepareEmail({ to, template, templateProps, subjectBuilder, }) {
    const emailRenderProps = { ...templateProps, APP_URL: env_1.default.APP_URL };
    const from = env_1.default.EMAIL_FROM;
    const subject = subjectBuilder(templateProps);
    const html = await emailTemplate.render(template, emailRenderProps);
    return { from, to, html, subject };
}
function emailSender(template, subjectBuilder, senderOpts) {
    return async function sendEmail(to, props, opts) {
        logger_1.logger.info('✉️ Mailer: sending email to', to);
        if (process.env.NODE_ENV === 'test') {
            logger_1.logger.info('> Test environment detected, not sending email');
            return;
        }
        const message = await prepareEmail({
            to,
            template,
            templateProps: {
                ...props,
                preheader: props.preheader ?? senderOpts?.preheader ?? '',
            },
            subjectBuilder,
        });
        if (opts?.preview) {
            logger_1.logger.info('> Preview mode enabled, not sending email');
            const htmlTmpFile = await (0, preview_email_1.default)(message, {
                open: false,
                openSimulator: false,
                returnHtml: true,
            }).catch((e) => logger_1.logger.error(e));
            return { htmlTmpFile };
        }
        // log props to the console in development (helpful for e.g. clicking verification links)
        if (process.env.NODE_ENV === 'development') {
            logger_1.logger.info(props);
        }
        if (!env_1.default.POSTMARK_API_KEY) {
            logger_1.logger.info('- ⚠️ Not sending email because POSTMARK_API_KEY is not set.');
            return;
        }
        const postmark = new postmark_1.ServerClient(env_1.default.POSTMARK_API_KEY);
        logger_1.logger.info(`> Sending "${message.subject}" to ${message.to}`);
        const response = await postmark.sendEmail({
            From: message.from,
            To: message.to,
            Subject: message.subject,
            HtmlBody: message.html,
        });
        return { response, html: message.html };
    };
}
exports.default = emailSender;
