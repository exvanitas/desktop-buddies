/* Where the hub gets the user's windows. The exe's tracker today, and a Mac tracker is another one
   of these. `listen` hears each new list, and a new watch always hears one to start from. `seq`
   counts up for as long as the hub runs, across watches, so a late one can be told from a new one. */
import type { Shell, WindowSnapshot } from './shell';

export type Seen = Pick<WindowSnapshot, 'seq' | 'list'>;
export interface WindowSource {
  watch(on: boolean): Promise<void>;
  listen(f: (seen: Seen) => void): Promise<void>;
}

export const exeWindows = (shell: Shell): WindowSource => ({
  watch: on => shell.windowsWatch(on),
  listen: f => shell.on('windows', f)
});
