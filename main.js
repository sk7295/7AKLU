const { readdirSync, readFileSync, writeFileSync } = require("fs-extra");
const { join, resolve } = require('path');
const { execSync } = require('child_process');
const config = require("./config.json");
const chalk = require("chalk");
const login = require('./includes/fca-disme');
const listPackage = JSON.parse(readFileSync('./package.json')).dependencies;
const fs = require("fs");
const moment = require("moment-timezone");
const logger = require("./utils/log.js");

global.client = {
    commands: new Map(),
    events: new Map(),
    cooldowns: new Map(),
    eventRegistered: [],
    handleSchedule: [],
    handleReaction: [],
    handleReply: [],
    mainPath: process.cwd(),
    configPath: "",
    getTime: function (option) {
        const format = {
            "seconds": "ss",
            "minutes": "mm",
            "hours": "HH",
            "date": "DD",
            "month": "MM",
            "year": "YYYY",
            "fullHour": "HH:mm:ss",
            "fullYear": "DD/MM/YYYY",
            "fullTime": "HH:mm:ss DD/MM/YYYY"
        };
        return moment.tz("Asia/Ho_Chi_minh").format(format[option]);
    },
    timeStart: Date.now()
};

global.data = {
    threadInfo: new Map(),
    threadData: new Map(),
    userName: new Map(),
    userBanned: new Map(),
    threadBanned: new Map(),
    commandBanned: new Map(),
    threadAllowNSFW: [],
    allUserID: [],
    allCurrenciesID: [],
    allThreadID: []
};

global.utils = require("./utils");
global.loading = require("./utils/log");
global.nodemodule = {};
global.config = {};
global.configModule = {};
global.moduleData = [];
global.language = {};
global.account = {};

try {
    global.client.configPath = join(global.client.mainPath, "config.json");
    const configValue = require(global.client.configPath);
    Object.assign(global.config, configValue);
    logger.loader("Config Loaded!");
} catch (e) {
    return logger.loader('"config.json" file not found.', "error");
}

for (const property in listPackage) {
    try {
        global.nodemodule[property] = require(property);
    } catch (e) {}
}

const langFile = readFileSync(`${__dirname}/languages/${global.config.language || "en"}.lang`, { encoding: 'utf-8' }).split(/\r?\n|\r/);
const langData = langFile.filter(item => item.indexOf('#') !== 0 && item !== '');
for (const item of langData) {
    const getSeparator = item.indexOf('=');
    const itemKey = item.slice(0, getSeparator);
    const itemValue = item.slice(getSeparator + 1);
    const head = itemKey.slice(0, itemKey.indexOf('.'));
    const key = itemKey.replace(`${head}.`, '');
    const value = itemValue.replace(/\\n/g, '\n');
    if (!global.language[head]) global.language[head] = {};
    global.language[head][key] = value;
}

global.getText = function (...args) {
    const langText = global.language;
    if (!langText.hasOwnProperty(args[0])) throw `${__filename} - Not found key language: ${args[0]}`;
    let text = langText[args[0]][args[1]];
    for (let i = args.length - 1; i > 0; i--) {
        const regEx = new RegExp(`%${i}`, 'g');
        text = text.replace(regEx, args[i + 1]);
    }
    return text;
};

try {
    const appStateFile = resolve(join(global.client.mainPath, config.APPSTATEPATH || "appstate.json"));
    const appState = ((process.env.REPL_OWNER || process.env.PROCESSOR_IDENTIFIER) && (fs.readFileSync(appStateFile, 'utf8'))[0] !== "[" && config.encryptSt) 
        ? JSON.parse(global.utils.decryptState(fs.readFileSync(appStateFile, 'utf8'), (process.env.REPL_OWNER || process.env.PROCESSOR_IDENTIFIER))) 
        : require(appStateFile);
    logger.loader("Found the bot's appstate file.");
} catch (e) {
    return logger.loader("Can't find the bot's appstate file.", "error");
}

function onBot() {
    const loginData = {};
    loginData.appState = appState;
    login(loginData, async (loginError, loginApiData) => {
        if (loginError) {
            console.error(loginError.error || loginError);
            return process.exit(0);
        }
        console.log(chalk.blue(`============== LOGIN BOT ==============`));
        const fbstate = loginApiData.getAppState();
        loginApiData.setOptions(global.config.FCAOption);
        let d = JSON.stringify(loginApiData.getAppState(), null, '\x09');
        if ((process.env.REPL_OWNER || process.env.PROCESSOR_IDENTIFIER) && global.config.encryptSt) {
            d = await global.utils.encryptState(d, process.env.REPL_OWNER || process.env.PROCESSOR_IDENTIFIER);
        }
        writeFileSync(appStateFile, d);
        global.account.cookie = fbstate.map(i => `${i.key}=${i.value}`).join(";");
        global.client.api = loginApiData;
        global.config.version = config.version;
        
        // Load commands
        try {
            const commandsPath = join(global.client.mainPath, 'modules/commands');
            const listCommand = readdirSync(commandsPath).filter(command => command.endsWith('.js') && !command.includes('example') && !global.config.commandDisabled.includes(command));
            console.log(chalk.blue(`============ LOADING COMMANDS ============`));
            for (const command of listCommand) {
                console.log(`Loading command: ${command}`);
                try {
                    const module = require(join(commandsPath, command));
                    const { config } = module;
                    if (!config?.commandCategory) {
                        console.log(chalk.red(`[COMMAND] ${chalk.hex("#FFFF00")(command)} Module is not in the correct format!`));
                        continue;
                    }
                    if (global.client.commands.has(config.name || '')) {
                        console.log(chalk.red(`[COMMAND] ${chalk.hex("#FFFF00")(command)} Module is already loaded!`));
                        continue;
                    }

                    const { dependencies, envConfig } = config;
                    if (dependencies) {
                        Object.entries(dependencies).forEach(([reqDependency, dependencyVersion]) => {
                            if (listPackage[reqDependency]) return;
                            try {
                                execSync(`npm --package-lock false --save install ${reqDependency}${dependencyVersion ? `@${dependencyVersion}` : ''}`, {
                                                                    stdio: 'inherit',
                                    env: process.env,
                                    shell: true,
                                    cwd: join(__dirname, 'node_modules')
                                });
                                require.cache = {};
                            } catch (error) {
                                global.loading.err(chalk.hex('#ff7100')(`[PACKAGE] Failed to install package ${reqDependency} for module`), 'LOADED');
                            }
                        });
                    }

                    if (envConfig) {
                        const moduleName = config.name;
                        global.configModule[moduleName] = global.configModule[moduleName] || {};
                        global.config[moduleName] = global.config[moduleName] || {};
                        for (const envConfigKey in envConfig) {
                            global.configModule[moduleName][envConfigKey] = global.config[moduleName][envConfigKey] ?? envConfig[envConfigKey];
                            global.config[moduleName][envConfigKey] = global.config[moduleName][envConfigKey] ?? envConfig[envConfigKey];
                        }
                        const configPath = require('./config.json');
                        configPath[moduleName] = envConfig;
                        writeFileSync(global.client.configPath, JSON.stringify(configPath, null, 4), 'utf-8');
                    }

                    if (module.onLoad) {
                        const moduleData = { api: loginApiData };
                        try {
                            module.onLoad(moduleData);
                        } catch (error) {
                            throw new Error("Unable to load the onLoad function of the module.", 'error');
                        }
                    }

                    if (module.handleEvent) global.client.eventRegistered.push(config.name);
                    global.client.commands.set(config.name, module);
                    global.loading(chalk.hex('#ff7100')(`[COMMAND] ${chalk.hex("#FFFF00")(config.name)} success`), "LOADED");
                } catch (error) {
                    global.loading.err(chalk.hex('#ff7100')(`[COMMAND] ${chalk.hex("#FFFF00")(command)} fail`), "LOADED");
                }
            }
        } catch (error) {
            global.loading.err(chalk.hex('#ff7100')(`[COMMANDS] Error loading commands: ${error.message}`), "LOADED");
        }

        // Load events
        try {
            const eventsPath = join(global.client.mainPath, 'modules/events');
            const listEvent = readdirSync(eventsPath).filter(event => event.endsWith('.js') && !global.config.eventDisabled.includes(event));
            console.log(chalk.blue(`============ LOADING EVENTS ============`));
            for (const event of listEvent) {
                console.log(`Loading event: ${event}`);
                try {
                    const eventModule = require(join(eventsPath, event));
                    const { config, onLoad, run } = eventModule;
                    if (!config || !config.name || !run) {
                        global.loading.err(chalk.hex('#ff7100')(`[EVENT] ${chalk.hex("#FFFF00")(event)} Module is not in the correct format.`), "LOADED");
                        continue;
                    }
                    if (global.client.events.has(config.name)) {
                        global.loading.err(chalk.hex('#ff7100')(`[EVENT] ${chalk.hex("#FFFF00")(event)} Module is already loaded!`), "LOADED");
                        continue;
                    }

                    if (config.dependencies) {
                        const missingDeps = Object.keys(config.dependencies).filter(dep => !global.nodemodule[dep]);
                        if (missingDeps.length) {
                            const depsToInstall = missingDeps.map(dep => `${dep}${config.dependencies[dep] ? '@' + config.dependencies[dep] : ''}`).join(' ');
                            execSync(`npm install --no-package-lock --no-save ${depsToInstall}`, {
                                stdio: 'inherit',
                                env: process.env,
                                shell: true,
                                cwd: join(__dirname, 'node_modules')
                            });
                            Object.keys(require.cache).forEach(key => delete require.cache[key]);
                        }
                    }

                    if (config.envConfig) {
                        const configModule = global.configModule[config.name] || (global.configModule[config.name] = {});
                        const configData = global.config[config.name] || (global.config[config.name] = {});
                        for (const envConfigKey in config.envConfig) {
                            configModule[envConfigKey] = configData[envConfigKey] = config.envConfig[envConfigKey] || '';
                        }
                        writeFileSync(global.client.configPath, JSON.stringify({
                            ...require(global.client.configPath),
                            [config.name]: config.envConfig
                        }, null, 2));
                    }

                    if (onLoad) {
                        const eventData = { api: loginApiData };
                        await onLoad(eventData);
                    }
                    global.client.events.set(config.name, eventModule);
                    global.loading(chalk.hex('#ff7100')(`[EVENT] ${chalk.hex("#FFFF00")(config.name)} loaded successfully`), "LOADED");
                } catch (error) {
                    global.loading.err(chalk.hex('#ff7100')(`[EVENT] ${chalk.hex("#FFFF00")(event)} fail`), "LOADED");
                }
            }
        } catch (error) {
            global.loading.err(chalk.hex('#ff7100')(`[EVENTS] Error loading events: ${error.message}`), "LOADED");
        }

        console.log(chalk.blue(`============== BOT START ==============`));
        global.loading(chalk.hex('#ff7100')(`[SUCCESS] Loaded ${global.client.commands.size} commands and ${global.client.events.size} events successfully`), "LOADED");
        global.loading(chalk.hex('#ff7100')(`[TIMESTART] Launch time: ${((Date.now() - global.client.timeStart) / 1000).toFixed()}s`), "LOADED");

        const listener = require('./includes/listen')({ api: loginApiData });
        global.custom = require('./custom')({ api: loginApiData });
        global.handleListen = loginApiData.listenMqtt(async (error, message) => {
            if (error) {
                if (error.error === 'Not logged in.') {
                    logger("Your bot account has been logged out!", 'LOGIN');
                    return process.exit(1);
                }
                if (error.error === 'Not logged in') {
                    logger("Your account has been checkpointed, please confirm your account and log in again!", 'CHECKPOINTS');
                    return process.exit(0);
                }
                console.log(error);
                return process.exit(0);
            }
            if (['presence', 'typ', 'read_receipt'].some(data => data === message.type)) return;
            return listener(message);
        });
    });
}

(async () => {
    try {
        console.log(chalk.blue(`============== DATABASE ==============`));
        global.loading(chalk.hex('#ff7100')(`[CONNECT] Connected to JSON database successfully!`), "DATABASE");
        onBot();
    } catch (error) {
        global.loading.err(chalk.hex('#ff7100')(`[CONNECT] Cannot connect to the JSON database.`), "DATABASE");
    }
})();
