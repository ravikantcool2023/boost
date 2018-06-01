/* eslint-disable unicorn/no-hex-escape */

import chalk from 'chalk';
import Reporter from '../src/Reporter';
import Task from '../src/Task';
import { STATUS_PASSED, STATUS_FAILED } from '../src/constants';

const oldNow = Date.now;

describe('Reporter', () => {
  let reporter;

  beforeEach(() => {
    reporter = new Reporter();
    reporter.err = jest.fn();
    reporter.out = jest.fn();
  });

  describe('bootstrap()', () => {
    it('sets start and stop events', () => {
      const cli = { on: jest.fn() };

      reporter.bootstrap(cli);

      expect(cli.on).toHaveBeenCalledWith('start', expect.anything());
      expect(cli.on).toHaveBeenCalledWith('stop', expect.anything());
      expect(cli.on).toHaveBeenCalledWith('log', expect.anything());
      expect(cli.on).toHaveBeenCalledWith('log.error', expect.anything());
    });
  });

  describe('addLine()', () => {
    it('adds a line to the list', () => {
      expect(reporter.lines).toEqual([]);

      reporter.addLine('foo');

      expect(reporter.lines).toEqual(['foo']);
    });
  });

  describe('clearOutput()', () => {
    it('writes ansi escape code', () => {
      reporter.clearOutput();

      expect(reporter.out).toHaveBeenCalledWith('\x1Bc');
    });

    it('resets last output height', () => {
      reporter.lastOutputHeight = 10;
      reporter.clearOutput();

      expect(reporter.lastOutputHeight).toBe(0);
    });
  });

  describe('clearLinesOutput()', () => {
    it('writes ansi escape code for each line height', () => {
      reporter.lastOutputHeight = 10;
      reporter.clearLinesOutput();

      expect(reporter.out).toHaveBeenCalledWith('\x1B[1A\x1B[K'.repeat(10));
    });

    it('resets last output height', () => {
      reporter.lastOutputHeight = 10;
      reporter.clearLinesOutput();

      expect(reporter.lastOutputHeight).toBe(0);
    });
  });

  describe('debounceRender()', () => {
    let spy;

    beforeEach(() => {
      jest.useFakeTimers();
      spy = jest.spyOn(global, 'setTimeout');
    });

    afterEach(() => {
      spy.mockRestore();
      jest.useRealTimers();
    });

    it('schedules a timer', () => {
      expect(reporter.renderScheduled).toBe(false);

      reporter.debounceRender();

      expect(reporter.renderScheduled).toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    it('doesnt schedule if already set', () => {
      reporter.debounceRender();
      reporter.debounceRender();
      reporter.debounceRender();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('displayError()', () => {
    it('writes to stderr', () => {
      reporter.displayError(new Error('Oops'));

      expect(reporter.err).toHaveBeenCalledTimes(3);
    });
  });

  describe('displayFinalOutput()', () => {
    let timeoutSpy;
    let intervalSpy;

    beforeEach(() => {
      timeoutSpy = jest.spyOn(global, 'clearTimeout');
      intervalSpy = jest.spyOn(global, 'clearInterval');
    });

    afterEach(() => {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    });

    it('calls clearTimeout if render timer set', () => {
      reporter.displayFinalOutput();

      expect(timeoutSpy).not.toHaveBeenCalled();

      reporter.renderTimer = 1;
      reporter.displayFinalOutput();

      expect(timeoutSpy).toHaveBeenCalledWith(1);
    });

    it('calls clearInterval if interval timer set', () => {
      reporter.displayFinalOutput();

      expect(intervalSpy).not.toHaveBeenCalled();

      reporter.intervalTimer = 1;
      reporter.displayFinalOutput();

      expect(intervalSpy).toHaveBeenCalledWith(1);
    });

    it('triggers final render', () => {
      const spy = jest.spyOn(reporter, 'handleRender');

      reporter.displayFinalOutput();

      expect(spy).toHaveBeenCalled();
    });

    it('displays error if provided', () => {
      const spy = jest.spyOn(reporter, 'displayError');
      const error = new Error('Oops');

      reporter.displayFinalOutput(error);

      expect(spy).toHaveBeenCalledWith(error);
    });

    it('displays footer if no error provided', () => {
      const spy = jest.spyOn(reporter, 'displayFooter');

      reporter.displayFinalOutput();

      expect(spy).toHaveBeenCalled();
    });

    it('displays logs on success', () => {
      reporter.logs.push('foo');

      const spy = jest.spyOn(reporter, 'displayLogs');

      reporter.displayFinalOutput();

      expect(spy).toHaveBeenCalledWith(['foo']);
    });

    it('displays error logs on failure', () => {
      reporter.errorLogs.push('foo');

      const spy = jest.spyOn(reporter, 'displayLogs');

      reporter.displayFinalOutput(new Error('Oops'));

      expect(spy).toHaveBeenCalledWith(['foo']);
    });

    it('displays error logs over error', () => {
      reporter.errorLogs.push('foo');

      const spy = jest.spyOn(reporter, 'displayError');

      reporter.displayFinalOutput(new Error('Oops'));

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('displayLogs()', () => {
    it('displays nothing if no logs', () => {
      reporter.displayLogs([]);

      expect(reporter.out).not.toHaveBeenCalled();
    });

    it('displays the logs', () => {
      reporter.displayLogs(['foo', 'bar']);

      expect(reporter.out).toHaveBeenCalledWith('\nfoo\nbar\n');
    });
  });

  describe('displayFooter()', () => {
    beforeEach(() => {
      Date.now = () => 0;
    });

    afterEach(() => {
      Date.now = oldNow;
    });

    it('displays default message', () => {
      reporter.displayFooter();

      expect(reporter.out).toHaveBeenCalledWith(expect.stringContaining('Ran in 0.00s'));
    });

    it('displays custom footer message', () => {
      reporter.options.footer = 'Powered by Boost';
      reporter.displayFooter();

      expect(reporter.out).toHaveBeenCalledWith(expect.stringContaining('Powered by Boost'));
    });
  });

  describe('findLine()', () => {
    it('returns undefined if not found', () => {
      expect(reporter.findLine(line => line === 'foo')).toBeUndefined();
    });

    it('returns the line', () => {
      reporter.lines.push('foo');

      expect(reporter.findLine(line => line === 'foo')).toBe('foo');
    });
  });

  describe('flushBufferedOutput()', () => {
    it('doesnt output if no buffer', () => {
      reporter.flushBufferedOutput();

      expect(reporter.out).not.toHaveBeenCalled();
    });

    it('output if buffer is not empty', () => {
      reporter.bufferedOutput = 'foo\nbar\nbaz';
      reporter.flushBufferedOutput();

      expect(reporter.out).toHaveBeenCalledWith('foo\nbar\nbaz');
    });

    it('sets last output height', () => {
      reporter.bufferedOutput = 'foo\nbar\nbaz';
      reporter.flushBufferedOutput();

      expect(reporter.lastOutputHeight).toBe(2);
    });
  });

  describe('flushBufferedStreams()', () => {
    it('calls all buffer callbacks', () => {
      const spy1 = jest.fn();
      const spy2 = jest.fn();

      reporter.bufferedStreams.push(spy1, spy2);
      reporter.flushBufferedStreams();

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });
  });

  describe('getColorPalette()', () => {
    const oldLevel = chalk.level;
    const basePalette = {
      failure: 'red',
      pending: 'gray',
      success: 'green',
      warning: 'yellow',
    };

    afterEach(() => {
      chalk.level = oldLevel;
    });

    it('returns base palette if chalk level < 2', () => {
      chalk.level = 1;

      expect(reporter.getColorPalette()).toEqual(basePalette);
    });

    it('returns base palette if chalk level >= 2 and theme is default', () => {
      chalk.level = 2;
      reporter.options.theme = 'default';

      expect(reporter.getColorPalette()).toEqual(basePalette);
    });

    it('returns base palette if theme does not exist', () => {
      chalk.level = 2;
      reporter.options.theme = 'unknown';

      expect(reporter.getColorPalette()).toEqual(basePalette);
    });

    it('returns theme palette', () => {
      chalk.level = 2;
      reporter.options.theme = 'solarized';

      expect(reporter.getColorPalette()).toEqual({
        failure: '#dc322f',
        pending: '#93a1a1',
        success: '#859900',
        warning: '#b58900',
      });
    });
  });

  describe('getColorType()', () => {
    it('returns yellow for skipped', () => {
      const task = new Task('task').skip();

      expect(reporter.getColorType(task)).toBe('warning');
    });

    it('returns green for passed', () => {
      const task = new Task('task');

      task.status = STATUS_PASSED;

      expect(reporter.getColorType(task)).toBe('success');
    });

    it('returns red for failed', () => {
      const task = new Task('task');

      task.status = STATUS_FAILED;

      expect(reporter.getColorType(task)).toBe('failure');
    });

    it('returns gray otherwise', () => {
      const task = new Task('task', () => {});

      expect(reporter.getColorType(task)).toBe('pending');
    });
  });

  describe('getElapsedTime()', () => {
    it('returns numbers in seconds', () => {
      expect(reporter.getElapsedTime(1000, 5000)).toBe('4.00s');
    });

    it('colors red if higher than slow threshold', () => {
      reporter.options.slowThreshold = 3000;

      expect(reporter.getElapsedTime(1000, 5000)).toBe(chalk.red('4.00s'));
    });

    it('doesnt color if highlight is false', () => {
      reporter.options.slowThreshold = 3000;

      expect(reporter.getElapsedTime(1000, 5000, false)).toBe('4.00s');
    });
  });

  describe('handleBaseStart()', () => {
    const oldCI = process.env.CI;

    beforeEach(() => {
      process.env.CI = false;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      process.env.CI = oldCI;
    });

    it('sets start time', () => {
      reporter.handleBaseStart();

      expect(reporter.startTime).not.toBe(0);
    });

    it('sets an interval if not in a CI', () => {
      process.env.CI = false;
      reporter.handleBaseStart();

      expect(setInterval).toHaveBeenCalled();
    });

    it('doesnt set an interval if in a CI', () => {
      process.env.CI = true;
      reporter.handleBaseStart();
      process.env.CI = false;

      expect(setInterval).not.toHaveBeenCalled();
    });
  });

  describe('handleBaseStop()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sets stop time', () => {
      reporter.handleBaseStop();

      expect(reporter.stopTime).not.toBe(0);
    });

    it('clears an interval', () => {
      const spy = jest.spyOn(global, 'clearInterval');

      reporter.intervalTimer = 1;
      reporter.handleBaseStop();

      expect(spy).toHaveBeenCalled();
    });

    it('displays final output', () => {
      const spy = jest.spyOn(reporter, 'displayFinalOutput');

      reporter.handleBaseStop(new Error());

      expect(spy).toHaveBeenCalledWith(new Error());
    });
  });

  describe('handleLogMessage()', () => {
    it('adds a log', () => {
      expect(reporter.logs).toEqual([]);

      reporter.handleLogMessage('foo');

      expect(reporter.logs).toEqual(['foo']);
    });
  });

  describe('handleErrorMessage()', () => {
    it('adds a log', () => {
      expect(reporter.errorLogs).toEqual([]);

      reporter.handleErrorMessage('foo');

      expect(reporter.errorLogs).toEqual(['foo']);
    });
  });

  describe('hideCursor()', () => {
    it('writes ansi escape code', () => {
      reporter.hideCursor();

      expect(reporter.out).toHaveBeenCalledWith('\x1B[?25l');
    });
  });

  describe('indent()', () => {
    it('indents based on length', () => {
      expect(reporter.indent()).toBe('');
      expect(reporter.indent(1)).toBe(' ');
      expect(reporter.indent(3)).toBe('   ');
    });
  });

  describe('log()', () => {
    it('adds to buffered output', () => {
      reporter.log('foo');
      reporter.log('bar');

      expect(reporter.bufferedOutput).toBe('foobar');
    });

    it('can control newlines', () => {
      reporter.log('foo', 1);
      reporter.log('bar', 2);

      expect(reporter.bufferedOutput).toBe('foo\nbar\n\n');
    });

    it('doesnt log if silent', () => {
      reporter.options.silent = true;
      reporter.log('foo');
      reporter.log('bar');

      expect(reporter.bufferedOutput).toBe('');
    });
  });

  describe('removeLine()', () => {
    it('removes a line', () => {
      reporter.lines.push('foo', 'bar', 'baz');
      reporter.removeLine(line => line === 'foo');

      expect(reporter.lines).toEqual(['bar', 'baz']);
    });
  });

  describe('render()', () => {
    it('logs each line', () => {
      reporter.lines.push('foo', 'bar', 'baz');
      reporter.render();

      expect(reporter.bufferedOutput).toBe('foo\nbar\nbaz\n');
    });
  });

  describe('resetCursor()', () => {
    it('writes ansi escape code', () => {
      reporter.resetCursor();

      expect(reporter.out).toHaveBeenCalledWith(expect.stringContaining('0H'));
    });
  });

  describe('showCursor()', () => {
    it('writes ansi escape code', () => {
      reporter.showCursor();

      expect(reporter.out).toHaveBeenCalledWith('\x1B[?25h');
    });
  });

  describe('style()', () => {
    it('colors pending', () => {
      expect(reporter.style('foo', 'pending')).toBe(chalk.gray('foo'));
    });

    it('colors failure', () => {
      expect(reporter.style('foo', 'failure')).toBe(chalk.red('foo'));
    });

    it('colors success', () => {
      expect(reporter.style('foo', 'success')).toBe(chalk.green('foo'));
    });

    it('colors warning', () => {
      expect(reporter.style('foo', 'warning')).toBe(chalk.yellow('foo'));
    });

    it('can apply modifiers', () => {
      expect(reporter.style('foo', 'pending', ['bold', 'dim', 'italic'])).toBe(
        chalk.gray.bold.dim.italic('foo'),
      );
    });
  });
});
