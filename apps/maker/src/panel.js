/* The settings panel: DOM only. What it shows comes from the Maker, and every change goes through
   it. Plain JavaScript, because the Peel Maker's view replaces it. */
import { POSE, POSES, SITUATIONS } from '@buddies/buddy-file';
import { ACTS, ALL, MAX, NEGATIVE, SAMPLES, promptSheet, shown } from '@buddies/maker-core';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createPanel(box, maker, opt) {
  let rmArm = 0, showAll = false, poseDrop = null;
  const toast = opt.toast || (() => {});
  box.classList.add('pn');
  box.innerHTML = `
    <div class="pn-h"><h1><b></b>Desktop Buddies</h1><button type="button" class="pn-fold" aria-expanded="true" aria-label="Collapse panel">–</button></div>
    <div class="pn-b">
      <section class="pn-s">
        <div class="pn-t"><span>Buddies</span><em class="pn-count"></em></div>
        <div class="pn-pets" role="tablist" aria-label="Buddy list"></div>
        <div class="pn-samples"><span>Samples</span></div>
        <div class="pn-row">
          <label class="pn-chip pn-file">Import Shimeji folder<input type="file" class="pn-shime" webkitdirectory multiple></label>
          <label class="pn-chip pn-file">Import buddy file<input type="file" class="pn-import" accept=".buddy,.json,application/json"></label>
        </div>
      </section>

      <section class="pn-s pn-ed" hidden>
        <div class="pn-top">
          <label class="pn-av" title="Change main image"><img alt=""><span>Change image</span><input type="file" accept="image/*" aria-label="Change main image"></label>
          <div class="pn-col">
            <label class="pn-lab"><span>Name</span><input class="pn-in pn-name" maxlength="16" placeholder="Name"></label>
            <div class="pn-lab"><span>Art faces</span><div class="pn-seg pn-faces"><button type="button" data-v="left">◀ Left</button><button type="button" data-v="right">Right ▶</button></div></div>
          </div>
        </div>
        <div class="pn-rng"><span>Size</span><input type="range" class="pn-size" min="48" max="280" aria-label="Size"><output></output></div>
        <div class="pn-lab"><span>Try an action</span><div class="pn-acts"></div></div>

        <details class="pn-kit">
          <summary><span>Prompt kit</span><em>AI art + dialogue</em></summary>
          <p class="pn-note">Describe the buddy once. Copy the prompts into your chatbot and image generator, then bring the results back here.</p>
          <label class="pn-lab pn-k"><span>Personality &amp; description</span><textarea class="pn-in pn-k-pers" rows="3" placeholder="e.g. A sleepy forest spirit who talks like an old poet and is obsessed with tea"></textarea></label>
          <label class="pn-lab pn-k"><span>Appearance <small>optional: leave blank and the dialogue reply will include one</small></span><textarea class="pn-in pn-k-look" rows="3" placeholder="e.g. small round moss creature, green fur, leaf on head, big black eyes, tiny stubby legs"></textarea></label>
          <div class="pn-lab pn-k"><span>Prompt style</span><div class="pn-seg pn-k-mode"><button type="button" data-v="tags">Tags (Anima / SD)</button><button type="button" data-v="text">Sentences</button></div></div>
          <label class="pn-lab pn-k pn-k-q"><span>Quality tags</span><input class="pn-in pn-k-quality"></label>
          <label class="pn-lab pn-k"><span>Always add</span><input class="pn-in pn-k-style"></label>

          <h4 class="pn-k-h">1 · Dialogue <small>paste into any chatbot</small></h4>
          <div class="pn-row"><button type="button" class="pn-chip pn-k-copyd">Copy dialogue prompt</button><button type="button" class="pn-chip pn-k-edit">Edit current lines</button></div>
          <label class="pn-lab pn-k"><span>Paste the reply (JSON)</span><textarea class="pn-in pn-k-reply" rows="3" placeholder='{"chat": ["…"], "hello": ["…"], …}'></textarea></label>
          <div class="pn-row"><button type="button" class="pn-chip pn-k-apply">Apply dialogue</button><button type="button" class="pn-chip pn-k-reset">Use default lines</button></div>
          <p class="pn-note pn-k-stat"></p>

          <h4 class="pn-k-h">2 · Images <small>one prompt per pose frame</small></h4>
          <div class="pn-k-imgs"></div>
          <div class="pn-row pn-k-up">
            <label class="pn-chip pn-file pn-primary">Upload generated images<input type="file" class="pn-k-files" accept="image/*" multiple></label>
          </div>
          <p class="pn-note">Name the files after the pose, like <code>main.png</code>, <code>walk_1.png</code>, <code>walk_2.png</code>, <code>cry_1.png</code>. You can drop them all at once. Plain backgrounds are removed automatically, and each pose is scaled so the character matches the main image's size. Tip: generate <b>main</b> first, then use it as a reference image (img2img, IP-Adapter, or "same character" in chat AIs) so every pose looks like the same buddy.</p>
        </details>

        <details class="pn-poses-wrap" open>
          <summary><span>Pose frames</span><em class="pn-pose-count"></em></summary>
          <p class="pn-note">Give any pose its own image, or several frames to animate it. Empty poses borrow from another pose (shown faded) or animate the main image. Tip: frames drawn on the same canvas size as the main image keep their scale automatically.</p>
          <div class="pn-poses"></div>
          <div class="pn-pose-ed" hidden></div>
          <div class="pn-row"><button type="button" class="pn-chip pn-match" title="Rescale every pose so the character's body is the same size as in the main image">Match sizes to main image</button></div>
        </details>

        <div class="pn-row pn-io">
          <button type="button" class="pn-chip pn-export">Save buddy file</button>
          <button type="button" class="pn-rm">Remove buddy</button>
        </div>
      </section>

      <section class="pn-s">
        <div class="pn-t"><span>Everyone</span></div>
        <div class="pn-all"></div>
        <div class="pn-lab"><span>Chattiness</span><div class="pn-seg pn-chat"><button type="button" data-v="off">Off</button><button type="button" data-v="low">Low</button><button type="button" data-v="normal">Normal</button><button type="button" data-v="high">High</button></div></div>
        <div class="pn-row"><button type="button" class="pn-chip pn-bub" aria-pressed="true">Speech bubbles</button><button type="button" class="pn-chip pn-names" aria-pressed="true">Name tags</button></div>
        <div class="pn-row"><button type="button" class="pn-chip pn-primary pn-page">Export desktop page</button></div>
        <p class="pn-note">One .html file with all your buddies and no editor. Right-click a buddy there to call another, dismiss it, or dismiss all. Add <code>#transparent</code> to its address for a see-through background.</p>
      </section>

      <ul class="pn-tips">
        <li><b>Click</b> They wave or spin. Click too much and they get grumpy.</li>
        <li><b>Rub</b> Wiggle the mouse over them to pet. Cheers them up when sad or mad.</li>
        <li><b>Drag &amp; throw</b> They grab walls and the ceiling. Throw too hard and they get dizzy.</li>
        <li><b>Hover still</b> They get shy.</li>
        <li><b>Paste</b> an image (Ctrl+V) to swap the selected buddy's main image, or drop images on <i>+ Add</i>.</li>
      </ul>
    </div>`;
  const $ = s => box.querySelector(s);
  const petsEl = $('.pn-pets'), ed = $('.pn-ed'), poseEd = $('.pn-pose-ed');
  poseEd.addEventListener('dragover', e => { e.preventDefault(); poseEd.classList.add('over'); });
  poseEd.addEventListener('dragleave', () => poseEd.classList.remove('over'));
  poseEd.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); poseEd.classList.remove('over'); poseDrop && poseDrop([...e.dataTransfer.files]); });

  addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input')) return;
    const it = [...(e.clipboardData && e.clipboardData.items || [])].find(x => x.type.startsWith('image/')); if (!it) return;
    e.preventDefault(); maker.pasteImage(it.getAsFile());
  });

  /* ---------- rendering ---------- */
  function render() {
    const S = maker.state;
    $('.pn-count').textContent = `${S.pets.length} / ${MAX}`;
    petsEl.innerHTML = '';
    S.pets.forEach(p => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pn-pet'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', p.id === maker.selected);
      b.innerHTML = `<i style="background-image:url(${esc(p.base.src)})"></i><span>${esc(p.name || 'No name')}</span>`;
      b.onclick = () => maker.select(p.id);
      petsEl.append(b);
    });
    if (S.pets.length < MAX) {
      const a = document.createElement('label'); a.className = 'pn-add'; a.innerHTML = '<i>+</i><span>Add</span><input type="file" accept="image/*" multiple aria-label="Add buddies from images">';
      a.querySelector('input').addEventListener('change', e => { maker.addFiles([...e.target.files]); e.target.value = ''; });
      a.addEventListener('dragover', e => { e.preventDefault(); a.classList.add('over'); });
      a.addEventListener('dragleave', () => a.classList.remove('over'));
      a.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); a.classList.remove('over'); maker.addFiles([...e.dataTransfer.files]); });
      petsEl.append(a);
    }
    const p = maker.current(); ed.hidden = !p;
    if (p) {
      $('.pn-av img').src = p.base.src;
      const n = $('.pn-name'); if (document.activeElement !== n) n.value = p.name;
      $('.pn-size').value = p.size; $('.pn-rng output').textContent = p.size;
      box.querySelectorAll('.pn-faces button').forEach(b => b.setAttribute('aria-pressed', (p.faces || 'right') === b.dataset.v));
      $('.pn-rm').textContent = 'Remove buddy'; clearTimeout(rmArm); rmArm = 0;
      renderPoses(p);
      renderKit(p);
    }
    renderActs();
    $('.pn-bub').setAttribute('aria-pressed', S.bubbles !== false);
    $('.pn-names').setAttribute('aria-pressed', S.names !== false);
    box.querySelectorAll('.pn-chat button').forEach(b => b.setAttribute('aria-pressed', (S.chatter || 'normal') === b.dataset.v));
  }

  /* what's on offer depends on the art, so this follows every pose edit */
  function renderActs() {
    const p = maker.current();
    if (p) box.querySelectorAll('.pn-acts .pn-act').forEach(b => { b.hidden = !maker.canAct(p, b.dataset.a); });
    box.querySelectorAll('.pn-all .pn-act').forEach(b => { b.hidden = !maker.canAnyAct(b.dataset.a); });
  }
  function renderPoses(p) {
    const grid = $('.pn-poses'); grid.innerHTML = '';
    let n = 0, group = '';
    POSES.forEach(ps => {
      if (ps.group !== group) { group = ps.group; const h = document.createElement('div'); h.className = 'pn-pg'; h.textContent = group; grid.append(h); }
      const s = shown(p, ps.key), own = p.poses[ps.key] && p.poses[ps.key].frames.length;
      if (own) n++;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pn-pose' + (own ? ' own' : '') + (maker.openPose === ps.key ? ' open' : '');
      const rot = s.rot === '@wall' ? ' style="transform:rotate(90deg)"' : s.rot === '@ceil' ? ' style="transform:rotate(180deg)"' : '';
      b.innerHTML = `<i><img src="${esc(s.src)}" alt=""${rot}></i><span>${ps.label}</span>${own ? `<em>${own}</em>` : ''}`;
      b.title = own ? `${ps.label}: ${own} frame${own > 1 ? 's' : ''}` : `${ps.label}: empty — uses ${s.key ? POSE[s.key].label : 'the main image'}`;
      b.onclick = () => { maker.togglePose(p, ps.key); if (maker.openPose) poseEd.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
      grid.append(b);
    });
    $('.pn-pose-count').textContent = `${n} / ${POSES.length} set`;
    renderPoseEd(p);
    renderActs();
  }
  function renderPoseEd(p) {
    const key = maker.openPose;
    if (!key) { poseEd.hidden = true; poseEd.innerHTML = ''; return; }
    const meta = POSE[key], ps = p.poses[key], s = shown(p, key);
    poseEd.hidden = false;
    const fb = s.own ? '' : `<p class="pn-note">Empty — currently ${s.key ? `borrows <b>${POSE[s.key].label}</b>` : meta.fb === '@wall' ? 'rotates the main image onto the wall' : meta.fb === '@ceil' ? 'flips the main image onto the ceiling' : 'animates the main image'}.</p>`;
    poseEd.innerHTML = `
      <div class="pn-pe-h"><b>${meta.label}</b><button type="button" class="pn-chip pn-pe-play">▶ Play</button><button type="button" class="pn-x" aria-label="Close">×</button></div>
      ${meta.hint ? `<p class="pn-note">${meta.hint}</p>` : ''}${fb}
      <div class="pn-frames"></div>
      <div class="pn-row"><label class="pn-chip pn-file">${ps && ps.frames.length ? 'Add frames' : 'Upload frames'}<input type="file" accept="image/*" multiple></label>${ps && ps.frames.length ? '<button type="button" class="pn-chip pn-pe-clear">Clear pose</button>' : ''}</div>
      ${ps && ps.frames.length ? `
      <div class="pn-rng"><span>Speed</span><input type="range" class="pn-pe-fps" min="1" max="24" value="${ps.fps || 6}"><output>${ps.fps || 6} fps</output></div>
      <div class="pn-rng"><span>Scale</span><input type="range" class="pn-pe-scale" min="40" max="250" value="${Math.round((ps.scale || 1) * 100)}"><output>${Math.round((ps.scale || 1) * 100)}%</output></div>` : ''}`;
    const fr = poseEd.querySelector('.pn-frames');
    (ps ? ps.frames : []).forEach((f, i) => {
      const d = document.createElement('div'); d.className = 'pn-frame';
      d.innerHTML = `<img src="${esc(f.src)}" alt="Frame ${i + 1}"><small>${i + 1}</small><div><button type="button" data-a="l" aria-label="Move earlier">‹</button><button type="button" data-a="x" aria-label="Remove frame">×</button><button type="button" data-a="r" aria-label="Move later">›</button></div>`;
      d.querySelectorAll('button').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'x') maker.removeFrame(p, key, i); else maker.moveFrame(p, key, i, a === 'l' ? -1 : 1);
      });
      fr.append(d);
    });
    if (!ps || !ps.frames.length) fr.innerHTML = '<div class="pn-drop">Drop images here, or use Upload. Several files become an animation (sorted by file name).</div>';
    const addTo = files => maker.addFrames(p, files);
    poseEd.querySelector('input[type=file]').addEventListener('change', e => { addTo([...e.target.files]); e.target.value = ''; });
    poseDrop = addTo;
    poseEd.querySelector('.pn-pe-play').onclick = () => maker.act(p.id, maker.openPose);
    poseEd.querySelector('.pn-x').onclick = () => maker.closePose(p);
    const clr = poseEd.querySelector('.pn-pe-clear'); if (clr) clr.onclick = () => maker.clearPose(p, maker.openPose);
    const fps = poseEd.querySelector('.pn-pe-fps'); if (fps) fps.oninput = e => { maker.setSpeed(p, key, +e.target.value); e.target.nextElementSibling.textContent = ps.fps + ' fps'; };
    const sc = poseEd.querySelector('.pn-pe-scale'); if (sc) sc.oninput = e => { maker.setScale(p, key, +e.target.value / 100); e.target.nextElementSibling.textContent = e.target.value + '%'; };
  }

  /* ---------- prompt kit ---------- */
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast(`Copied ${what}`);
  }
  function renderKit(p) {
    const k = maker.kitOf(p);
    const set = (sel, v) => { const e = $(sel); if (document.activeElement !== e) e.value = v; };
    set('.pn-k-pers', k.personality); set('.pn-k-look', k.appearance); set('.pn-k-quality', k.quality);
    set('.pn-k-style', k.mode === 'tags' ? k.styleTags : k.styleText);
    $('.pn-k-q').hidden = k.mode !== 'tags';
    box.querySelectorAll('.pn-k-mode button').forEach(b => b.setAttribute('aria-pressed', k.mode === b.dataset.v));
    const n = p.lines ? Object.keys(p.lines).length : 0;
    $('.pn-k-stat').textContent = n ? `Using ${p.name || 'this buddy'}'s own lines for ${n} of ${Object.keys(SITUATIONS).length} situations (the rest use defaults).` : 'Using the default lines.';
    renderKitImages(p);
  }
  function renderKitImages(p) {
    const k = maker.kitOf(p), wrap = $('.pn-k-imgs');
    const list = maker.imagePromptsFor(p);
    if (!list) { wrap.innerHTML = '<div class="pn-drop">Add an appearance above, or apply a dialogue reply that includes one, and the image prompts appear here.</div>'; return; }
    const listed = showAll ? list : list.filter(x => x.core);
    wrap.innerHTML = '';
    listed.forEach(x => {
      const d = document.createElement('div'); d.className = 'pn-kp';
      d.innerHTML = `<div class="pn-kp-h"><b>${esc(x.label)}${x.frames > 1 ? ` <small>frame ${x.frame}/${x.frames}</small>` : ''}</b><code>${x.file}.png</code><button type="button" class="pn-chip">Copy</button></div><p title="Click to show the full prompt">${esc(x.summary)}</p>${x.note ? `<small class="pn-kp-n">${esc(x.note)}</small>` : ''}`;
      d.querySelector('button').onclick = () => copy(x.text, `${x.file} prompt`);
      d.querySelector('p').onclick = e => { const el = e.currentTarget, o = el.classList.toggle('open'); el.textContent = o ? x.text : x.summary; };
      wrap.append(d);
    });
    const row = document.createElement('div'); row.className = 'pn-row';
    const more = list.length - list.filter(x => x.core).length;
    row.innerHTML = `<button type="button" class="pn-chip pn-k-all">Copy ${showAll ? 'all' : 'these'} (${listed.length})</button>${k.mode === 'tags' ? '<button type="button" class="pn-chip pn-k-neg">Copy negative prompt</button>' : ''}<button type="button" class="pn-chip pn-k-more">${showAll ? 'Essentials only' : `Show ${more} more poses`}</button>`;
    row.querySelector('.pn-k-all').onclick = () => copy(promptSheet(listed, k.mode), `${listed.length} prompts`);
    const neg = row.querySelector('.pn-k-neg'); if (neg) neg.onclick = () => copy(NEGATIVE, 'negative prompt');
    row.querySelector('.pn-k-more').onclick = () => { showAll = !showAll; renderKitImages(p); };
    wrap.append(row);
  }
  const kitInput = (sel, field) => $(sel).addEventListener('input', e => maker.setKitField(field, e.target.value));
  kitInput('.pn-k-pers', 'personality'); kitInput('.pn-k-look', 'appearance'); kitInput('.pn-k-quality', 'quality'); kitInput('.pn-k-style', 'style');
  box.querySelectorAll('.pn-k-mode button').forEach(b => b.onclick = () => maker.setKitMode(b.dataset.v));
  $('.pn-k-copyd').onclick = () => { const t = maker.dialoguePromptText(); if (t !== null) copy(t, 'dialogue prompt'); };
  $('.pn-k-edit').onclick = () => { const t = maker.currentLines(); if (t !== null) $('.pn-k-reply').value = t; };
  $('.pn-k-apply').onclick = () => { if (maker.applyReply($('.pn-k-reply').value)) $('.pn-k-reply').value = ''; };
  $('.pn-k-reset').onclick = () => maker.resetLines();
  $('.pn-k-files').addEventListener('change', e => { maker.importGenerated([...e.target.files]); e.target.value = ''; });
  const up = $('.pn-kit');
  up.addEventListener('dragover', e => { e.preventDefault(); up.classList.add('over'); });
  up.addEventListener('dragleave', e => { if (!up.contains(e.relatedTarget)) up.classList.remove('over'); });
  up.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); up.classList.remove('over'); maker.importGenerated([...e.dataTransfer.files]); });

  $('.pn-match').onclick = () => maker.matchSizes();

  /* ---------- static wiring ---------- */
  SAMPLES.forEach(d => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pn-sample';
    b.title = `Add ${d.name}${d.note ? ' (' + d.note + ')' : ''}`; b.setAttribute('aria-label', b.title);
    b.style.backgroundImage = `url(${maker.thumb(d.kind)})`;
    if (d.note) b.classList.add('star');
    b.onclick = () => maker.addSample(d.kind);
    $('.pn-samples').append(b);
  });
  ACTS.forEach(([a, l]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pn-act'; b.dataset.a = a; b.textContent = l; b.onclick = () => maker.selected && maker.act(maker.selected, a); $('.pn-acts').append(b); });
  ALL.forEach(([a, l]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pn-act'; b.dataset.a = a; b.textContent = l; b.onclick = () => maker.actAll(a); $('.pn-all').append(b); });

  $('.pn-shime').addEventListener('change', e => { maker.importShimeji([...e.target.files]); e.target.value = ''; });
  $('.pn-import').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; maker.importBuddy(f); });
  $('.pn-export').onclick = () => {
    const file = maker.buddyFile(); if (!file) return;
    const blob = new Blob([file.text], { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('.pn-av input').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; maker.setMainImage(f); });
  $('.pn-name').addEventListener('input', e => { const p = maker.current(); if (!p) return; maker.setName(e.target.value); const c = petsEl.querySelector('[aria-selected="true"] span'); if (c) c.textContent = p.name || 'No name'; });
  $('.pn-size').addEventListener('input', e => { const p = maker.current(); if (!p) return; maker.setSize(+e.target.value); $('.pn-rng output').textContent = p.size; });
  box.querySelectorAll('.pn-faces button').forEach(b => b.onclick = () => maker.setFaces(b.dataset.v));
  $('.pn-rm').onclick = e => {
    const p = maker.current(); if (!p) return;
    if (!rmArm) { e.currentTarget.textContent = `Click again to remove ${p.name || 'this buddy'}`; rmArm = setTimeout(() => { rmArm = 0; render(); }, 3000); return; }
    clearTimeout(rmArm); rmArm = 0; maker.remove();
  };
  $('.pn-page').onclick = () => maker.exportPage();
  $('.pn-bub').onclick = () => maker.toggleBubbles();
  $('.pn-names').onclick = () => maker.toggleNames();
  box.querySelectorAll('.pn-chat button').forEach(b => b.onclick = () => maker.setChatter(b.dataset.v));
  const fold = $('.pn-fold');
  fold.onclick = () => { const m = box.classList.toggle('min'); fold.textContent = m ? '+' : '–'; fold.setAttribute('aria-expanded', !m); fold.setAttribute('aria-label', m ? 'Expand panel' : 'Collapse panel'); };

  maker.subscribe(c => {
    /* a slow upload can finish for a buddy who is no longer on screen */
    if (c.pet && c.pet !== maker.current()) return;
    if (c.scope === 'all') render();
    else if (c.scope === 'poses') renderPoses(c.pet);
    else if (c.scope === 'kit') renderKit(c.pet);
    else if (c.scope === 'prompts') renderKitImages(c.pet);
  });
  return { addFiles: maker.addFiles };
}
