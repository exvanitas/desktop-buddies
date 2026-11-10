/* What comes in and goes out as files: images, buddy files, Shimeji folders and generated art. */
import { read, saveName, write, type Buddy, type PoseKey } from '@buddies/buddy-file';
import type { MakerBuddy, MakerDeps, MakerFile } from './deps';
import { AREA_ADJ, SCALE_HINT, poseFromFile } from './prompts';
import type { Session } from './session';

const SHIME = /shime\d+\.png$/i;

interface Adding {
  addPet(d: Partial<Buddy> & Pick<Buddy, 'base'>, quiet?: boolean): MakerBuddy | null;
  addFromSrc(src: string, name?: string): Promise<void>;
}

export function createImports(s: Session, deps: MakerDeps, roster: Adding) {
  const { art, world, toast, after, readImage } = deps;

  async function importShimeji(chosen: MakerFile[]) {
    const files = chosen.filter(f => SHIME.test(f.name));
    if (!files.length) return toast('No shime1.png … files found in that folder');
    toast('Importing Shimeji frames…');
    const list: { name: string; src: string }[] = []; for (const f of files) list.push({ name: f.name, src: (await readImage(f))! });
    const d = await art.fromShimeji(list);
    if (!d) return toast('A Shimeji set needs at least shime1.png');
    /* The art sits in img, under the character's folder or over it. */
    const folders = (files[0]!.webkitRelativePath || '').split('/').filter(Boolean).slice(0, -1);
    d.name = (folders.filter(f => !/^img$/i.test(f)).pop() || 'Shimeji').slice(0, 16);
    if (!roster.addPet(d)) return;
    toast(`Imported ${Object.keys(d.poses).length + 1} poses — tweak any in Pose frames`);
  }

  /* Files named after poses, onto the selected buddy. */
  async function importGenerated(files: MakerFile[]) {
    const p = s.current(); if (!p) return;
    const groups: Record<string, MakerFile[]> = {}, unknown: string[] = [];
    files.filter(f => /^image\//.test(f.type)).forEach(f => { const k = poseFromFile(f.name); if (k) (groups[k] = groups[k] || []).push(f); else unknown.push(f.name); });
    if (!Object.keys(groups).length) return toast('Name files after poses, e.g. walk_1.png');
    toast('Processing images…');
    const sorted = (arr: MakerFile[]) => arr.sort((a, b) => art.natSort(a.name, b.name));
    const srcs = async (arr: MakerFile[]) => { const o: string[] = []; for (const f of sorted(arr)) o.push((await readImage(f))!); return o; };
    let mainSrc: string | null = null, mainFailed = false;
    if (groups.main) {
      const src = (await srcs(groups.main))[0]!, r = await art.processBase(src);
      if (r) { mainSrc = src; p.base = r.frame; p.ref = r.ref; } else mainFailed = true;
      delete groups.main;
    }
    const done: string[] = [];
    for (const [key, arr] of Object.entries(groups)) {
      let list = await srcs(arr);
      /* a lone stand image is a blink frame: mix it into a mostly-open-eyes idle loop */
      if (key === 'stand' && list.length === 1) list = Array<string>(7).fill(mainSrc || p.base.src).concat(list);
      const r = await art.processFrames(list, p.ref, { independent: true });
      if (!r) continue;
      const m = await art.matchScale(p.base, r.frames);
      p.poses[key as PoseKey] = { frames: r.frames, fps: key === 'run' ? 10 : r.frames.length > 1 ? 5 : 4, scale: m ? +(m * (AREA_ADJ[key] || 1)).toFixed(3) : SCALE_HINT[key] || 1 };
      done.push(key);
    }
    if (!s.state.pets.includes(p)) return toast(`${p.name || 'That buddy'} isn't here any more, so the images went nowhere. They're still on your disk.`);
    s.save(true); s.changed({ scope: 'all' });
    toast(`Updated ${mainSrc ? 'main image + ' : ''}${done.length} pose${done.length === 1 ? '' : 's'}${mainFailed ? " · couldn't read the main image" : ''}${unknown.length ? ` · skipped ${unknown.length} unnamed file(s)` : ''}`);
    if (done.length) after(400, () => world.act(p.id, 'love'));
  }

  return {
    importShimeji, importGenerated,
    /* Images dropped or picked. Four or more Shimeji frames are a Shimeji set. */
    async addFiles(files: MakerFile[]) {
      const shime = files.filter(f => SHIME.test(f.name));
      if (shime.length >= 4) return importShimeji(shime);
      for (const f of files) { const src = await readImage(f); if (src) await roster.addFromSrc(src, f.name.replace(/\.[^.]+$/, '').slice(0, 16)); else toast('Only image files can be added'); }
    },
    /* Every buddy that comes in from a file comes through BuddyFile.read. */
    async importBuddy(file: MakerFile | null | undefined) {
      if (!file) return;
      try { roster.addPet(read(await file.text())); } catch (_) { toast("That isn't a Desktop Buddies file"); }
    },
    /* The selected buddy as a file to save, as long as her own import would take it back. */
    buddyFile() {
      const p = s.current(); if (!p) return null;
      const text = write(p);
      try { read(text); } catch (e) { toast(`Can't save ${p.name || 'this buddy'}: ${(e as Error).message}`); return null; }
      return { name: saveName(p.name), text };
    }
  };
}
