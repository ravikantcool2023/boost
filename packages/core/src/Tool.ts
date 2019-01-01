/**
 * @copyright   2017-2019, Miles Johnson
 * @license     https://opensource.org/licenses/MIT
 */

/* eslint-disable no-param-reassign */

import fs from 'fs-extra';
import path from 'path';
import util from 'util';
import chalk from 'chalk';
import debug from 'debug';
import envCI from 'env-ci';
import glob from 'fast-glob';
import pluralize from 'pluralize';
import i18next from 'i18next';
import mergeWith from 'lodash/mergeWith';
import optimal, { bool, object, string, Blueprint } from 'optimal';
import parseArgs, { Arguments, Options as ArgOptions } from 'yargs-parser';
import ConfigLoader from './ConfigLoader';
import Console from './Console';
import Emitter from './Emitter';
import ModuleLoader, { Constructor } from './ModuleLoader';
import Plugin from './Plugin';
import Reporter from './Reporter';
import DefaultReporter from './reporters/DefaultReporter';
import ErrorReporter from './reporters/ErrorReporter';
import enableDebug from './helpers/enableDebug';
import handleMerge from './helpers/handleMerge';
import isEmptyObject from './helpers/isEmptyObject';
import CIReporter from './reporters/CIReporter';
import LanguageDetector from './i18n/LanguageDetector';
import FileBackend from './i18n/FileBackend';
import {
  Debugger,
  Translator,
  PackageConfig,
  PluginSetting,
  PackageWorkspaceMetadata,
} from './types';

export interface ToolOptions {
  appName: string;
  appPath: string;
  argOptions: ArgOptions;
  configBlueprint: Blueprint;
  configName: string;
  footer: string;
  header: string;
  root: string;
  scoped: boolean;
  settingsBlueprint: Blueprint;
  workspaceRoot: string;
}

export interface ToolConfig {
  debug: boolean;
  extends: string[];
  locale: string;
  output: number;
  reporters: PluginSetting<Reporter>;
  settings: { [key: string]: any };
  silent: boolean;
  theme: string;
}

export interface ToolPluginRegistry {
  reporter: Reporter;
}

export interface PluginType<T> {
  afterBootstrap: ((plugin: T) => void) | null;
  beforeBootstrap: ((plugin: T) => void) | null;
  contract: Constructor<T>;
  loader: ModuleLoader<T>;
  pluralName: string;
  singularName: string;
}

const translatorCache: Map<Tool<any, any>, Translator> = new Map();

export default class Tool<
  PluginRegistry extends ToolPluginRegistry,
  Config extends ToolConfig
> extends Emitter {
  args?: Arguments;

  argv: string[] = [];

  // @ts-ignore Set after instantiation
  config: Config;

  console: Console;

  debug: Debugger;

  options: ToolOptions;

  package: PackageConfig = { name: '', version: '0.0.0' };

  private configLoader: ConfigLoader;

  private initialized: boolean = false;

  private plugins: { [K in keyof PluginRegistry]?: PluginRegistry[K][] } = {};

  private pluginTypes: { [K in keyof PluginRegistry]?: PluginType<PluginRegistry[K]> } = {};

  constructor(options: Partial<ToolOptions>, argv: string[] = []) {
    super();

    this.argv = argv;

    this.options = optimal(
      options,
      {
        appName: string().required(),
        appPath: string().required(),
        argOptions: object(),
        configBlueprint: object(),
        configName: string().empty(),
        footer: string().empty(),
        header: string().empty(),
        root: string(process.cwd()),
        scoped: bool(),
        settingsBlueprint: object(),
        workspaceRoot: string().empty(),
      },
      {
        name: 'Tool',
      },
    );

    // Core debugger for the entire tool
    this.debug = this.createDebugger('core');

    // eslint-disable-next-line global-require
    this.debug('Using boost v%s', require('../package.json').version);

    // Setup i18n translation
    translatorCache.set(this, this.createTranslator());

    // Initialize the console first so we can start logging
    this.console = new Console(this);

    // Make this available for testing purposes
    this.configLoader = new ConfigLoader(this);

    // Define a special type of plugin
    this.registerPlugin('reporter', Reporter, {
      beforeBootstrap: reporter => {
        reporter.console = this.console;
      },
      loadBoostModules: true,
    });

    /* istanbul ignore next */
    if (process.env.NODE_ENV !== 'test') {
      // Add a reporter to catch errors during initialization
      this.addPlugin('reporter', new ErrorReporter());

      // Cleanup when an exit occurs
      process.on('exit', code => {
        this.emit('exit', [code]);
      });
    }
  }

  /**
   * Add a plugin for a specific contract type and bootstrap with the tool.
   */
  addPlugin<K extends keyof PluginRegistry>(typeName: K, plugin: PluginRegistry[K]): this {
    const type = this.pluginTypes[typeName];

    if (!type) {
      throw new Error(this.msg('errors:pluginContractNotFound', { typeName }));
    } else if (!(plugin instanceof Plugin)) {
      throw new TypeError(this.msg('errors:pluginNotExtended', { parent: 'Plugin', typeName }));
    } else if (!(plugin instanceof type.contract)) {
      throw new TypeError(
        this.msg('errors:pluginNotExtended', { parent: type.contract.name, typeName }),
      );
    }

    plugin.tool = this;

    if (type.beforeBootstrap) {
      type.beforeBootstrap(plugin);
    }

    plugin.bootstrap();

    if (type.afterBootstrap) {
      type.afterBootstrap(plugin);
    }

    this.plugins[typeName]!.push(plugin);

    return this;
  }

  /**
   * Create a debugger instance with a namespace.
   */
  createDebugger(...namespaces: string[]): Debugger {
    const handler = debug(`${this.options.appName}:${namespaces.join(':')}`) as Debugger;

    handler.invariant = (condition: boolean, message: string, pass: string, fail) => {
      handler('%s: %s', message, condition ? chalk.green(pass) : chalk.red(fail));
    };

    return handler;
  }

  /**
   * Create an i18n translator instance.
   */
  createTranslator(): Translator {
    const translator = i18next
      .createInstance()
      .use(new LanguageDetector())
      .use(new FileBackend());

    translator.init(
      {
        backend: {
          resourcePaths: [
            path.join(__dirname, '../resources'),
            path.join(this.options.appPath, 'resources'),
          ],
        },
        defaultNS: 'app',
        fallbackLng: ['en'],
        initImmediate: false,
        lowerCaseLng: true,
        ns: ['app', 'errors', 'prompts'],
      },
      error => {
        // istanbul ignore next
        if (error) {
          throw error;
        }
      },
    );

    return translator;
  }

  /**
   * Force exit the application.
   */
  exit(message: string | Error | null, code: number = 1): this {
    this.console.exit(message, code);

    return this;
  }

  /**
   * Return a plugin by name and type.
   */
  getPlugin<K extends keyof PluginRegistry>(typeName: K, name: string): PluginRegistry[K] {
    const plugin = this.getPlugins(typeName).find(p => p instanceof Plugin && p.name === name);

    if (plugin) {
      return plugin;
    }

    throw new Error(
      this.msg('errors:pluginNotFound', {
        name,
        typeName,
      }),
    );
  }

  /**
   * Return all plugins by type.
   */
  getPlugins<K extends keyof PluginRegistry>(typeName: K): PluginRegistry[K][] {
    if (!this.pluginTypes[typeName]) {
      throw new Error(this.msg('errors:pluginContractNotFound', { typeName }));
    }

    return this.plugins[typeName]! || [];
  }

  /**
   * Return the registered plugin types.
   */
  getRegisteredPlugins() {
    return this.pluginTypes;
  }

  /**
   * Return a list of absolute package folder paths, across all workspaces,
   * for the defined root.
   */
  getWorkspacePackagePaths(customRoot: string = ''): string[] {
    const root = customRoot || this.options.root;

    return glob
      .sync(this.getWorkspacePaths(root), {
        absolute: true,
        cwd: root,
      })
      .map(pkgPath => String(pkgPath));
  }

  /**
   * Return a list of absolute workspace folder paths, with wildstar glob in tact,
   * for the defined root.
   */
  getWorkspacePaths(customRoot: string = ''): string[] {
    const root = customRoot || this.options.root;
    const pkgPath = path.join(root, 'package.json');
    const lernaPath = path.join(root, 'lerna.json');
    const workspacePaths = [];

    // Yarn
    if (fs.existsSync(pkgPath)) {
      const pkg = fs.readJsonSync(pkgPath);

      if (pkg.workspaces) {
        if (Array.isArray(pkg.workspaces)) {
          workspacePaths.push(...pkg.workspaces);
        } else if (Array.isArray(pkg.workspaces.packages)) {
          workspacePaths.push(...pkg.workspaces.packages);
        }
      }
    }

    // Lerna
    if (workspacePaths.length === 0 && fs.existsSync(lernaPath)) {
      const lerna = fs.readJsonSync(lernaPath);

      if (Array.isArray(lerna.packages)) {
        workspacePaths.push(...lerna.packages);
      }
    }

    return workspacePaths.map(workspace => path.join(root, workspace));
  }

  /**
   * Initialize the tool by loading config and plugins.
   */
  initialize(): this {
    if (this.initialized) {
      return this;
    }

    const { appName } = this.options;
    const pluginNames = Object.keys(this.pluginTypes);

    this.debug('Initializing %s application', chalk.yellow(appName));

    this.args = parseArgs(
      this.argv,
      mergeWith(
        {
          array: [...pluginNames],
          boolean: ['debug', 'silent'],
          number: ['output'],
          string: ['config', 'locale', 'theme', ...pluginNames],
        },
        this.options.argOptions,
        handleMerge,
      ),
    );

    this.loadConfig();
    this.loadPlugins();
    this.loadReporters();

    this.initialized = true;

    return this;
  }

  /**
   * Load the package.json and local configuration files.
   *
   * Must be called first in the lifecycle.
   */
  loadConfig(): this {
    if (this.initialized) {
      return this;
    }

    this.package = this.configLoader.loadPackageJSON();
    this.config = this.configLoader.loadConfig(this.args!);

    // Inherit workspace metadata
    this.options.workspaceRoot = this.configLoader.workspaceRoot;

    // Enable debugger
    if (this.config.debug) {
      enableDebug(this.options.appName);
    }

    // Update locale
    if (this.config.locale) {
      translatorCache.get(this)!.changeLanguage(this.config.locale);
    }

    return this;
  }

  /**
   * Load all `package.json`s across all workspaces and their packages.
   * Once loaded, append workspace path metadata.
   */
  loadWorkspacePackages(
    customRoot: string = '',
  ): (PackageConfig & { workspace: PackageWorkspaceMetadata })[] {
    const root = customRoot || this.options.root;

    return glob
      .sync(this.getWorkspacePackagePaths(root).map(ws => `${ws}/package.json`), {
        absolute: true,
        cwd: root,
      })
      .map(filePath => {
        const jsonPath = String(filePath);
        const metadata: Partial<PackageWorkspaceMetadata> = {};

        metadata.jsonPath = jsonPath;
        metadata.packagePath = path.dirname(jsonPath);
        metadata.packageName = path.basename(metadata.packagePath);
        metadata.workspacePath = path.dirname(metadata.packagePath);
        metadata.workspaceName = path.basename(metadata.workspacePath);

        return {
          ...fs.readJsonSync(jsonPath),
          workspace: metadata,
        };
      });
  }

  /**
   * Register plugins from the loaded configuration.
   *
   * Must be called after config has been loaded.
   */
  loadPlugins(): this {
    if (this.initialized) {
      return this;
    }

    if (isEmptyObject(this.config)) {
      throw new Error(this.msg('errors:configNotLoaded', { name: 'plugins' }));
    }

    Object.keys(this.pluginTypes).forEach(type => {
      const typeName = type as keyof PluginRegistry;
      const { loader, pluralName } = this.pluginTypes[typeName]!;
      const plugins = loader.loadModules((this.config as any)[pluralName]);

      // Sort plugins by priority
      loader.debug('Sorting by priority');

      plugins.sort((a, b) =>
        a instanceof Plugin && b instanceof Plugin ? a.priority - b.priority : 0,
      );

      // Bootstrap each plugin with the tool
      loader.debug('Bootstrapping with tool environment');

      plugins.forEach(plugin => {
        this.addPlugin(typeName, plugin);
      });
    });

    return this;
  }

  /**
   * Register reporters from the loaded configuration.
   *
   * Must be called after config has been loaded.
   */
  loadReporters(): this {
    if (this.initialized) {
      return this;
    }

    if (isEmptyObject(this.config)) {
      throw new Error(this.msg('errors:configNotLoaded', { name: 'reporters' }));
    }

    const reporters = this.plugins.reporter!;
    const { loader } = this.pluginTypes.reporter!;

    // Use a special reporter when in a CI
    // istanbul ignore next
    if (envCI().isCi && !process.env.BOOST_ENV) {
      loader.debug('CI environment detected, using %s CI reporter', chalk.yellow('boost'));

      this.addPlugin('reporter', new CIReporter());

      // Use default reporter
    } else if (
      reporters.length === 0 ||
      (reporters.length === 1 && reporters[0] instanceof ErrorReporter)
    ) {
      loader.debug('Using default %s reporter', chalk.yellow('boost'));

      this.addPlugin('reporter', new DefaultReporter());
    }

    return this;
  }

  /**
   * Log a message to the console to display on success.
   */
  log(message: string, ...args: any[]): this {
    this.console.log(util.format(message, ...args));

    return this;
  }

  /**
   * Log a live message to the console to display while a process is running.
   */
  logLive(message: string, ...args: any[]): this {
    this.console.logLive(util.format(message, ...args));

    return this;
  }

  /**
   * Log an error to the console to display on failure.
   */
  logError(message: string, ...args: any[]): this {
    this.console.logError(util.format(message, ...args));

    return this;
  }

  /**
   * Retrieve a translated message from a resource bundle.
   */
  msg(
    key: string | string,
    params?: { [key: string]: any },
    options?: i18next.TranslationOptions,
  ): string {
    return translatorCache.get(this)!.t(key, {
      interpolation: { escapeValue: false },
      replace: params,
      ...options,
    });
  }

  /**
   * Register a custom type of plugin, with a defined contract that all instances should extend.
   * The type name should be in singular form, as plural variants are generated automatically.
   */
  registerPlugin<K extends keyof PluginRegistry>(
    typeName: K,
    contract: Constructor<PluginRegistry[K]>,
    options: {
      afterBootstrap?: (plugin: PluginRegistry[K]) => void;
      beforeBootstrap?: (plugin: PluginRegistry[K]) => void;
      loadBoostModules?: boolean;
    } = {},
  ): this {
    if (this.pluginTypes[typeName]) {
      throw new Error(this.msg('errors:pluginContractExists', { typeName }));
    }

    const name = String(typeName);
    const { afterBootstrap = null, beforeBootstrap = null, loadBoostModules = false } = options;

    this.debug('Registering new plugin type: %s', chalk.magenta(name));

    this.plugins[typeName] = [];

    this.pluginTypes[typeName] = {
      afterBootstrap,
      beforeBootstrap,
      contract,
      loader: new ModuleLoader(this, name, contract, loadBoostModules),
      pluralName: pluralize(name),
      singularName: name,
    };

    return this;
  }
}
