#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-env node */
const commander_1 = require("commander");
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const child_process_1 = require("child_process");
const ws_1 = require("ws");
const logger_1 = require("./server/utils/logger");
// import envVars from './env'
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
const util_1 = require("util");
const exec = (0, util_1.promisify)(child_process_1.exec);
// __dirname
// Dev: /Users/alex/dev/interval/server/dist/src
// Release: /Users/alex/.nvm/versions/node/v18.18.1/lib/node_modules/interval-server/dist/src
const projectRootDir = path_1.default.resolve(__dirname, '..', '..');
function child(cmd, args, opts) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(cmd, args, opts);
        proc.stdout.setEncoding('utf-8');
        proc.stderr.setEncoding('utf-8');
        proc.stdout.on('data', data => {
            if (opts?.silent)
                return;
            logger_1.logger.info(data.trim());
        });
        proc.stderr.on('data', data => {
            if (opts?.silent)
                return;
            logger_1.logger.error(data.trim());
        });
        proc.on('close', code => {
            if (code === null) {
                return reject(-1);
            }
            if (code > 0) {
                return reject(code);
            }
            return resolve(0);
        });
    });
}
async function checkHasPsqlInstalled() {
    try {
        await child('which', ['psql'], { silent: true });
        return true;
    }
    catch (e) {
        return false;
    }
}
const initSql = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE OR REPLACE FUNCTION nanoid(size int DEFAULT 21)
  RETURNS text AS $$
  DECLARE
    id text := '';
    i int := 0;
    urlAlphabet char(64) := 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW';
    bytes bytea := gen_random_bytes(size);
    byte int;
    pos int;
  BEGIN
    WHILE i < size LOOP
      byte := get_byte(bytes, i);
      pos := (byte & 63) + 1; -- + 1 because substr starts at 1 for some reason
      id := id || substr(urlAlphabet, pos, 1);
      i = i + 1;
    END LOOP;
    RETURN id;
  END
  $$ LANGUAGE PLPGSQL STABLE;
`;
function loadDbUrlEnvVar() {
    try {
        dotenv_1.default.config();
    }
    catch (err) {
        console.error('Failed loading .env', err);
    }
    // only parse the the db URL so that this command can be run without other env vars being set.
    try {
        return zod_1.z.object({ DATABASE_URL: zod_1.z.string() }).parse(process.env);
    }
    catch (e) {
        return null;
    }
}
async function initDb(opts) {
    const envVars = loadDbUrlEnvVar();
    if (!envVars) {
        logger_1.logger.error(`No DATABASE_URL environment variable was set.`);
        process.exit(1);
    }
    const u = new URL(envVars.DATABASE_URL);
    const dbName = u.pathname.replace('/', '');
    logger_1.logger.info(`Will create database ${dbName} on host ${u.hostname}...`);
    const isPsqlInstalled = await checkHasPsqlInstalled();
    if (!isPsqlInstalled) {
        logger_1.logger.error('Cannot initialize a database without psql installed. Please install psql and try again.');
        process.exit(1);
    }
    if (!opts.skipCreate) {
        // if the database already exists, exit
        try {
            await exec(`psql ${envVars.DATABASE_URL} -t -c "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`);
            logger_1.logger.error(`The database "${dbName}" already exists. You can run \`interval-server db-init --skip-create\` to run the initialization script against the existing "${dbName}" database.`);
            process.exit(1);
        }
        catch (e) {
            // the command errored, the database doesn't exist
        }
        await child('psql', [
            ['-h', u.hostname],
            ['-p', u.port],
            ['-U', u.username],
            '-c',
            `CREATE database "${dbName}";`,
        ].flat(), { env: { PGPASSWORD: u.password, ...process.env } });
    }
    await child('psql', [envVars.DATABASE_URL, '-c', initSql]);
    await child('npx', ['-y', 'prisma', 'db', 'push'], { cwd: projectRootDir });
}
const program = new commander_1.Command();
program.showHelpAfterError();
program
    .name('interval-server')
    .description('Interval Server is the central server for Interval apps')
    .option('-v, --verbose', 'verbose output')
    .addCommand(new commander_1.Command('start').description('starts Interval Server'))
    .addCommand(new commander_1.Command('db-init').addOption(new commander_1.Option('--skip-create', 'for when a database already exists, skip creating one')));
const [cmd, ...args] = program.parse().args;
async function main() {
    if (cmd === 'start') {
        const envVars = (await Promise.resolve().then(() => __importStar(require('./env')))).default;
        // start the internal web socket server
        Promise.resolve().then(() => __importStar(require('./wss/index')));
        const app = (0, express_1.default)();
        const mainAppServer = (await Promise.resolve().then(() => __importStar(require('./server/index')))).default;
        app.use(mainAppServer);
        const server = http_1.default.createServer(app);
        const wss = new ws_1.WebSocketServer({ server, path: '/websocket' });
        const { setupWebSocketServer } = await Promise.resolve().then(() => __importStar(require('./wss/wss')));
        setupWebSocketServer(wss);
        server.listen(Number(envVars.PORT), () => {
            logger_1.logger.info(`📡 Interval Server listening at http://localhost:${envVars.PORT}`);
        });
    }
    else if (cmd === 'db-init') {
        logger_1.logger.info('Initializing a database...');
        initDb({ skipCreate: args.includes('--skip-create') }).catch(() => {
            logger_1.logger.error(`Failed to initialize database.`);
            process.exit(1);
        });
    }
}
main();
