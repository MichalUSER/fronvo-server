// ******************** //
// The starting point of the Fronvo server.
// ******************** //

// Port to attach to
const PORT = parseInt(process.env.PORT) || 3001;

// Admin panel
import { instrument, RedisStore } from '@socket.io/admin-ui';

// PM2
import { createAdapter } from '@socket.io/cluster-adapter';
import { setupWorker } from '@socket.io/sticky';

// Ratelimiter
import { EzierLimiter } from '@ezier/ratelimit';

// Custom event files
import registerEvents from 'events/main';

// Cool-ish styling
import ora, { Ora } from 'ora';
import gradient from 'gradient-string';

// Other imports
import fs from 'fs';
import * as variables from 'variables/global';
import { Server } from 'socket.io';
import { ClientToServerEvents } from 'interfaces/events/c2s';
import { ServerToClientEvents } from 'interfaces/events/s2c';
import { InterServerEvents } from 'interfaces/events/inter';
import { getEnv, getEnvBoolean } from 'variables/varUtils';

// Variables
let io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents>;
let loadingSpinner: Ora;
const loadingSpinnerDefaultText = 'Starting server';

function setLoading(currProcText: string): void {
    if (!variables.silentLogging)
        loadingSpinner.text = loadingSpinnerDefaultText + ': ' + currProcText;
}

function preStartupChecks(): void {
    function checkSilentLogging() {
        if (variables.silentLogging) console.log = () => {};
    }

    function checkRequiredFiles() {
        // Check directories
        for (let directory in variables.requiredStartupDirectories) {
            directory = variables.requiredStartupDirectories[directory];

            // No errors thrown with recursive option
            fs.mkdirSync(directory, { recursive: true });
        }

        // Check individual files
        for (const file in variables.requiredStartupFiles) {
            const fileObj =
                variables.requiredStartupFiles[file][
                    Object.keys(variables.requiredStartupFiles[file])[0]
                ];
            const filePath = fileObj.path;

            // This is optional for non-JSON files
            const fileTemplate = fileObj.template;

            // Overwrite if it doesnt exist
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(
                    filePath,
                    fileTemplate ? JSON.stringify(fileTemplate) : ''
                );
            }
        }
    }

    checkSilentLogging();
    checkRequiredFiles();
}

async function setupPrisma(): Promise<void> {
    if (!variables.localMode) {
        setLoading('Setting up Prisma');

        // Prepare for requests before-hand, prevent cold requests
        const tempLog = await variables.prismaClient.log.create({
            data: {
                logData: {
                    info: 'Temporary log, to be deleted.',
                },
            },
        });

        // Read operations aswell
        await variables.prismaClient.log.findMany();

        // Update operations
        await variables.prismaClient.log.update({
            where: { id: tempLog.id },
            data: {
                logData: {
                    info: 'Updated temporary log, to be deleted.',
                },
            },
        });

        // And delete operations
        await variables.prismaClient.log.delete({ where: { id: tempLog.id } });
    }
}

function setupRatelimiter(): void {
    if (variables.testMode) return;

    setLoading('Setting up the ratelimiter');

    // For authorised users
    const ezierLimiterPoints = getEnv('RATELIMITER_POINTS', 40);

    const ezierLimiterDuration = getEnv('RATELIMITER_DURATION', 2500);

    const ezierLimiter = new EzierLimiter({
        maxPoints: ezierLimiterPoints,
        clearDelay: ezierLimiterDuration,
    });

    variables.setRateLimiter(ezierLimiter);

    // And for unauthorised users
    const ezierLimiterUnauthorisedPoints = getEnv(
        'RATELIMITER_POINTS_UNAUTHORISED',
        10
    );

    const ezierLimiterUnauthorisedDuration = getEnv(
        'RATELIMITER_DURATION_UNAUTHORISED',
        2500
    );

    const ezierLimiterUnauthorised = new EzierLimiter({
        maxPoints: ezierLimiterUnauthorisedPoints,
        clearDelay: ezierLimiterUnauthorisedDuration,
    });

    variables.setUnauthorisedRateLimiter(ezierLimiterUnauthorised);
}

function setupServer(): void {
    setLoading('Setting up the server process, server events and admin panel');

    // Setup the socket.io server with tailored options
    io = new Server<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents
    >(PORT, {
        serveClient: false,
        path: '/fronvo',

        // Admin panel
        cors: {
            origin: ['https://admin.socket.io'],
            credentials: true,
        },

        // Enable / Disable binary parser
        parser: getEnvBoolean('BINARY_PARSER', true)
            ? require('socket.io-msgpack-parser')
            : '',

        // No namespace detected, disconnect
        connectTimeout: 5000,

        // Disable HTTPS requests
        httpCompression: false,
        maxHttpBufferSize: 0,

        // Strict pong timeout
        pingTimeout: 5000,

        // Limit to websocket connections
        transports: ['websocket'],
    });
}

function setupServerEvents(): void {
    registerEvents(io);
}

function setupPM2(): void {
    // Mostly for hosting on production
    if (variables.cluster) {
        io.adapter(createAdapter());
        setupWorker(io);
    }
}

function setupAdminPanel(): void {
    const panelUsername = getEnv('ADMIN_PANEL_USERNAME');
    const panelPassword = getEnv('ADMIN_PANEL_PASSWORD');

    // Check environmental variables and hash the admin panel password
    if (panelUsername && panelPassword) {
        instrument(io, {
            auth: {
                type: 'basic',
                username: panelUsername,

                // hash
                password: require('bcrypt').hashSync(panelPassword, 10),
            },

            // preserve users who logged in with the panel before
            store: new RedisStore(null),

            readonly: true,
        });
    }
}

async function startup(): Promise<void> {
    // Prevent startup logging, too
    preStartupChecks();

    // Gradient shenanigans
    console.log(
        gradient([
            '#e8128f',
            '#e812d2',
            '#e412e8',
            '#cb12e8',
            '#bd12e8',
            '#a812e8',
            '#8f12e8',
            '#8012e8',
        ])(`Fronvo server v0.2 ${variables.localMode ? '[LOCAL]' : ''}`)
    );

    // Special check because ora doesnt care
    if (!variables.silentLogging) {
        loadingSpinner = ora({
            text: loadingSpinnerDefaultText,
            spinner: 'dots12', // wonky windows 10 style
            interval: 40,
            color: 'magenta',
        }).start();
    }

    // Attempt to run each check one-by-one
    await setupPrisma();
    setupRatelimiter();
    setupServer();
    setupServerEvents();
    setupPM2();
    setupAdminPanel();

    // Finally, display successful server run
    if (!variables.silentLogging)
        loadingSpinner.succeed('Server running at port ' + PORT + '.');
}

startup();
