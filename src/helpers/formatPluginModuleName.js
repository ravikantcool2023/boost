/**
 * @copyright   2017, Miles Johnson
 * @license     https://opensource.org/licenses/MIT
 * @flow
 */

/**
 * Combine app and plugin names into a Node/NPM applicable module name.
 */
export default function formatPluginModuleName(appName: string, pluginName: string): string {
  return `${appName}-plugin-${pluginName.toLowerCase().replace('plugin:', '')}`;
}
