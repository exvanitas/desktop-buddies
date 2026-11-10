/* panel.js stays plain JavaScript, so this is its type. */
import type { Maker, MakerFile } from '@buddies/maker-core';

export function createPanel(box: HTMLElement, maker: Maker, opt: { toast?(message: string): void }): { addFiles(files: MakerFile[]): Promise<void> };
