/**
 * @copyright   2017, Miles Johnson
 * @license     https://opensource.org/licenses/MIT
 * @flow
 */

import Routine from './Routine';
import Tool from './Tool';

import type { Result, ResultPromise } from './types';

export default class Pipeline<T: Object> extends Routine {
  tool: Tool<T>;

  constructor(tool: Tool<T>) {
    super('root', 'Pipeline', tool ? tool.config : {});

    if (tool instanceof Tool) {
      tool.initialize();
    } else {
      throw new TypeError('A build `Tool` instance is required to operate the pipeline.');
    }

    this.tool = tool;
  }

  /**
   * Load tasks to be used by the CLI renderer.
   */
  loadTasks = () => this.subroutines;

  /**
   * Execute all subroutines in order.
   */
  run(initialValue: Result, context?: Object = {}): ResultPromise {
    this.context = context;
    this.tool.openConsole(this.loadTasks);

    return this.serializeSubroutines(initialValue).finally(() => {
      this.tool.closeConsole();
    });
  }
}
