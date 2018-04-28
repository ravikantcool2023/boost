import chalk from 'chalk';
import Tool from '../src/Tool';
import Plugin from '../src/Plugin';
import Reporter from '../src/Reporter';
import DefaultReporter from '../src/DefaultReporter';
import { DEFAULT_TOOL_CONFIG } from '../src/constants';
import enableDebug from '../src/helpers/enableDebug';
import { getFixturePath, copyFixtureToMock } from './helpers';

jest.mock('../src/helpers/enableDebug');

describe('Tool', () => {
  let tool;

  beforeEach(() => {
    tool = new Tool({
      appName: 'test-boost',
      root: getFixturePath('app'),
    });
    tool.config = {};
    tool.package = {};
  });

  describe('constructor()', () => {
    it('enables debug if --debug is passed', () => {
      tool = new Tool(
        {
          appName: 'test-boost',
          root: getFixturePath('app'),
        },
        ['--debug'],
      );

      expect(enableDebug).toHaveBeenCalledWith('test-boost');
    });
  });

  describe('createDebugger()', () => {
    it('returns a debug function', () => {
      const debug = tool.createDebugger('foo');

      expect(typeof debug).toBe('function');
      expect(debug.namespace).toBe('test-boost:foo');
    });

    it('provides an invariant function', () => {
      const debug = tool.createDebugger('foo');

      expect(typeof debug.invariant).toBe('function');
    });
  });

  describe('exit()', () => {
    it('accepts a string', () => {
      const spy = jest.fn();

      tool.console.exit = spy;
      tool.exit('Oops', 123);

      expect(spy).toHaveBeenCalledWith('Oops', 123);
    });

    it('accepts an error', () => {
      const error = new Error('Oh nooo', 456);
      const spy = jest.fn();

      tool.console.exit = spy;
      tool.exit(error);

      expect(spy).toHaveBeenCalledWith(error, 1);
    });
  });

  describe('getPlugin()', () => {
    it('errors if not found', () => {
      expect(() => {
        tool.getPlugin('foo');
      }).toThrowError('Failed to find plugin "foo". Have you installed it?');
    });

    it('returns plugin by name', () => {
      const plugin = new Plugin();
      plugin.name = 'foo';

      tool.plugins.push(plugin);

      expect(tool.getPlugin('foo')).toBe(plugin);
    });
  });

  describe('initialize()', () => {
    it('loads config', () => {
      expect(tool.config).toEqual({});
      expect(tool.package).toEqual({});
      expect(tool.initialized).toBe(false);

      tool.initialize();

      expect(tool.config).not.toEqual({});
      expect(tool.package).not.toEqual({});
      expect(tool.initialized).toBe(true);
    });
  });

  describe('loadConfig()', () => {
    it('doesnt load if initialized', () => {
      tool.initialized = true;
      tool.loadConfig();

      expect(tool.config).toEqual({});
      expect(tool.package).toEqual({});
    });

    it('loads package.json', () => {
      tool.loadConfig();

      expect(tool.package).toEqual({
        name: 'test-boost-app',
        version: '0.0.0',
      });
    });

    it('loads config file', () => {
      tool.loadConfig();

      expect(tool.config).toEqual({
        ...DEFAULT_TOOL_CONFIG,
        foo: 'bar',
      });
    });

    it('extends from argv', () => {
      tool.argv = ['--debug', '--silent'];
      tool.loadConfig();

      expect(tool.config.debug).toBe(true);
      expect(tool.config.silent).toBe(true);
    });

    it('doesnt extend from argv if disabled', () => {
      tool.argv = ['--debug', '--silent'];
      tool.options.extendArgv = false;
      tool.loadConfig();

      expect(tool.config.debug).toBe(false);
      expect(tool.config.silent).toBe(false);
    });

    it('enables debug if debug config is true', () => {
      tool.argv = ['--debug'];
      tool.loadConfig();

      expect(enableDebug).toHaveBeenCalledWith('test-boost');
    });
  });

  describe('loadPlugins()', () => {
    it('errors if config is falsy', () => {
      expect(() => {
        tool.loadPlugins();
      }).toThrowError('Cannot load plugins as configuration has not been loaded.');
    });

    it('errors if config is an empty object', () => {
      expect(() => {
        tool.config = {};
        tool.loadPlugins();
      }).toThrowError('Cannot load plugins as configuration has not been loaded.');
    });

    it('doesnt load if no plugins found in config', () => {
      tool.config = { plugins: [] };
      tool.loadPlugins();

      expect(tool.plugins).toEqual([]);
    });

    it('doesnt load if initialized', () => {
      tool.initialized = true;
      tool.config = { plugins: ['foo'] };
      tool.loadPlugins();

      expect(tool.plugins).toEqual([]);
    });

    it('bootstraps plugins on load', () => {
      const plugin = new Plugin();
      const spy = jest.spyOn(plugin, 'bootstrap');

      tool.config = { plugins: [plugin] };
      tool.loadPlugins();

      expect(spy).toHaveBeenCalled();
    });

    it('bootstraps plugins with tool if bootstrap() is overridden', () => {
      class TestPlugin extends Plugin {
        bootstrap() {}
      }

      const plugin = new TestPlugin();

      tool.config = { plugins: [plugin] };
      tool.loadPlugins();

      expect(plugin.tool).toBe(tool);
    });

    it('sorts by priority', () => {
      const foo = new Plugin();
      const bar = new Plugin();
      const baz = new Plugin();

      baz.priority = 1;
      bar.priority = 2;
      foo.priority = 3;

      tool.config = { plugins: [foo, bar, baz] };
      tool.loadPlugins();

      expect(tool.plugins).toEqual([baz, bar, foo]);
    });
  });

  describe('loadReporter()', () => {
    it('errors if config is falsy', () => {
      expect(() => {
        tool.loadReporter();
      }).toThrowError('Cannot load reporter as configuration has not been loaded.');
    });

    it('errors if config is an empty object', () => {
      expect(() => {
        tool.config = {};
        tool.loadReporter();
      }).toThrowError('Cannot load reporter as configuration has not been loaded.');
    });

    it('doesnt load if initialized', () => {
      tool.initialized = true;
      tool.loadReporter();

      expect(tool.reporter).toBeNull();
    });

    it('loads default reporter if config not set', () => {
      tool.config = { reporter: '' };
      tool.loadReporter();

      expect(tool.reporter).toBeInstanceOf(DefaultReporter);
    });

    it('loads reporter using a string', () => {
      const unmock = copyFixtureToMock('reporter', 'test-boost-reporter-foo');

      tool.config = { reporter: 'foo' };
      tool.loadReporter();

      expect(tool.reporter).toBeInstanceOf(Reporter);
      expect(tool.reporter.name).toBe('foo');
      expect(tool.reporter.moduleName).toBe('test-boost-reporter-foo');

      unmock();
    });

    it('loads reporter using an object', () => {
      const unmock = copyFixtureToMock('reporter', 'test-boost-reporter-bar');

      tool.config = { reporter: { reporter: 'bar' } };
      tool.loadReporter();

      expect(tool.reporter).toBeInstanceOf(Reporter);
      expect(tool.reporter.name).toBe('bar');
      expect(tool.reporter.moduleName).toBe('test-boost-reporter-bar');

      unmock();
    });

    it('passes options to reporter', () => {
      const unmock = copyFixtureToMock('reporter', 'test-boost-reporter-baz');

      tool.options.footer = 'Powered by Boost';
      tool.config = { reporter: 'baz', silent: true };
      tool.loadReporter();

      const { reporter } = tool;

      expect(reporter.options.footer).toBe('Powered by Boost');
      expect(reporter.options.silent).toBe(true);

      unmock();
    });
  });

  describe('log()', () => {
    it('sends log to console', () => {
      const spy = jest.fn();

      tool.console.emit = spy;
      tool.log('Some message: %s', 'foo');

      expect(spy).toHaveBeenCalledWith('log', ['Some message: foo', 'Some message: %s', ['foo']]);
    });
  });

  describe('logError()', () => {
    it('sends error to console', () => {
      const spy = jest.fn();

      tool.console.emit = spy;
      tool.logError('Some error: %s', 'foo');

      expect(spy).toHaveBeenCalledWith('log.error', ['Some error: foo', 'Some error: %s', ['foo']]);
    });
  });
});
