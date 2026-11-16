/* Shared class ordering. Only IDs and folder labels are stored; assignment access
   and individual versions are still resolved by the portal before rendering. */
(function (root) {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  function normalize(layout, assignments) {
    const seen = new Set();
    const items = [];
    for (const item of Array.isArray(layout?.items) ? layout.items : []) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.type === 'folder') {
        const children = [];
        for (const id of Array.isArray(item.items) ? item.items : []) {
          if (typeof id === 'string' && !seen.has(id)) { seen.add(id); children.push(id); }
        }
        items.push({ type: 'folder', id: item.id, name: String(item.name || 'Folder'), items: children });
      } else if (item.type === 'assignment') items.push({ type: 'assignment', id: item.id });
    }
    for (const a of assignments) {
      if (!seen.has(a.id)) { seen.add(a.id); items.push({ type: 'assignment', id: a.id }); }
    }
    return { version: 1, items };
  }
  function move(layout, ids, folderId = '', beforeId = '') {
    const next = copy(layout);
    const selected = new Set(ids);
    // Keep the displayed order of a multi-selection, including across folders.
    const ordered = next.items.flatMap(x => x.type === 'folder' ? x.items : [x.id]).filter(id => selected.has(id));
    if (beforeId && selected.has(beforeId)) return next;
    const destination = folderId ? next.items.find(x => x.type === 'folder' && x.id === folderId) : null;
    if (folderId && !destination) return next;
    next.items = next.items.filter(x => x.type === 'folder' || !selected.has(x.id));
    next.items.forEach(x => { if (x.type === 'folder') x.items = x.items.filter(id => !selected.has(id)); });
    const target = destination ? destination.items : next.items;
    const index = target.findIndex(x => (typeof x === 'string' ? x : x.id) === beforeId);
    target.splice(index < 0 ? target.length : index, 0, ...ordered.map(id => destination ? id : { type: 'assignment', id }));
    return next;
  }
  function render(layout, assignments, cards, legacyRender) {
    if (!layout) return legacyRender(assignments, cards);
    const byId = new Map(assignments.map((a, i) => [a.id, cards[i]]));
    return normalize(layout, assignments).items.map(item => {
      if (item.type !== 'folder') return byId.get(item.id) || '';
      const visible = item.items.filter(id => byId.has(id));
      if (!visible.length) return '';
      return `<details class="assignment-folder" open><summary>📁 ${escape(item.name)} <span>(${visible.length})</span></summary>${visible.map(id => byId.get(id)).join('')}</details>`;
    }).join('');
  }
  class Editor {
    constructor(container, { assignments, layout, save, cancel }) {
      this.container = container;
      this.assignments = new Map(assignments.map(a => [a.id, a]));
      this.layout = normalize(layout, assignments);
      this.selected = new Set();
      this.save = save;
      this.cancel = cancel;
      this.busy = false;
      this.draw();
    }
    row(id, folder = '') {
      const a = this.assignments.get(id);
      if (!a) return '';
      return `<div class="ao-row ${this.selected.has(id) ? 'ao-selected' : ''}" data-id="${escape(id)}" data-folder="${escape(folder)}">
        <button type="button" class="btn btn-secondary small ao-handle" draggable="true" data-drag="${escape(id)}" aria-label="Drag ${escape(a.title)}" title="Drag to reorder">⠿</button>
        <input type="checkbox" data-select="${escape(id)}" ${this.selected.has(id) ? 'checked' : ''} aria-label="Select ${escape(a.title)}">
        <span class="ao-title">${escape(a.title)}${!a.is_published ? ' <small>Draft</small>' : ''}</span>
        <button type="button" class="btn btn-secondary small" data-up="${escape(id)}" aria-label="Move ${escape(a.title)} up">↑</button>
        <button type="button" class="btn btn-secondary small" data-down="${escape(id)}" aria-label="Move ${escape(a.title)} down">↓</button>
      </div>`;
    }
    draw(focusAttribute, focusId) {
      const folders = this.layout.items.filter(x => x.type === 'folder');
      this.container.innerHTML = `<div class="ao-editor" aria-busy="${this.busy}">
        <p>Drag assignments into order or into a folder. Select several to move them together. This order is shared with students.</p>
        <p class="ao-hint">Only assignments shown this quarter are listed. Work from other quarters stays in place. Saving a custom order replaces automatic workbook grouping.</p>
        <fieldset ${this.busy ? 'disabled' : ''}>
          <div class="ao-toolbar">
            <label><input type="checkbox" data-all ${this.selected.size === this.assignments.size && this.selected.size ? 'checked' : ''}> Select all</label>
            <span role="status">${this.selected.size} selected</span>
            <select aria-label="Destination folder" data-destination><option value="">No folder (top level)</option>${folders.map(f => `<option value="${escape(f.id)}">${escape(f.name)}</option>`).join('')}</select>
            <button type="button" class="btn btn-secondary small" data-move ${!this.selected.size ? 'disabled' : ''}>Move selected</button>
          </div>
          <div class="ao-toolbar">
            <input type="text" maxlength="100" placeholder="Folder name" aria-label="New folder name" data-name>
            <button type="button" class="btn btn-secondary small" data-create>New folder${this.selected.size ? ' with selected' : ''}</button>
          </div>
          <div class="ao-drop" data-folder="" data-end>Drop here to move to the end of the top level</div>
          <div class="ao-items">${this.layout.items.map(item => {
            if (item.type !== 'folder') return this.row(item.id);
            const count = item.items.filter(id => this.assignments.has(id)).length;
            return `<section class="assignment-folder" data-folder="${escape(item.id)}">
              <div class="ao-folder-header" data-end data-folder="${escape(item.id)}">
                <strong>📁 ${escape(item.name)} (${count})</strong>
                <button type="button" class="btn btn-secondary small" data-folder-up="${escape(item.id)}" aria-label="Move folder ${escape(item.name)} up">↑</button>
                <button type="button" class="btn btn-secondary small" data-folder-down="${escape(item.id)}" aria-label="Move folder ${escape(item.name)} down">↓</button>
                <button type="button" class="btn btn-secondary small" data-rename="${escape(item.id)}">Rename</button>
                <button type="button" class="btn btn-secondary small" data-remove="${escape(item.id)}">Ungroup</button>
              </div>${item.items.map(id => this.row(id, item.id)).join('')}
              <div class="ao-drop" data-end data-folder="${escape(item.id)}">Drop assignments into this folder</div>
            </section>`;
          }).join('') || '<p>No assignments yet. You can create folders now.</p>'}</div>
          <div class="ao-toolbar"><button type="button" class="btn btn-primary" data-save>Save organization</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div>
        </fieldset><p class="ao-message" role="status">${escape(this.message || '')}</p></div>`;
      const all = this.container.querySelector('[data-all]');
      all.indeterminate = this.selected.size > 0 && this.selected.size < this.assignments.size;
      this.container.onchange = event => {
        const el = event.target;
        if (el.hasAttribute('data-all')) this.selected = new Set(el.checked ? this.assignments.keys() : []);
        else if (el.dataset.select) el.checked ? this.selected.add(el.dataset.select) : this.selected.delete(el.dataset.select);
        else return;
        this.draw(el.dataset.select ? 'data-select' : 'data-all', el.dataset.select || '');
      };
      this.container.onclick = event => this.click(event);
      this.container.ondragstart = event => {
        const id = event.target.dataset.drag;
        if (!id || this.busy) { event.preventDefault(); return; }
        this.dragIds = this.selected.has(id) ? [...this.selected] : [id];
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      };
      this.container.ondragover = event => {
        if (!this.dragIds || this.busy) return;
        const target = event.target.closest('.ao-row, [data-end]');
        if (!target) return;
        event.preventDefault();
        this.clearDrop();
        target.classList.add('ao-drop-active');
        event.dataTransfer.dropEffect = 'move';
      };
      this.container.ondragend = () => { this.dragIds = null; this.clearDrop(); };
      this.container.ondrop = event => {
        event.preventDefault();
        const target = event.target.closest('.ao-row, [data-end]');
        if (target && this.dragIds && !this.busy) {
          this.layout = move(this.layout, this.dragIds, target.dataset.folder, target.dataset.id || '');
          this.dragIds = null;
          this.draw();
        }
        this.clearDrop();
      };
      if (focusAttribute) [...this.container.querySelectorAll(`[${focusAttribute}]`)].find(el => el.getAttribute(focusAttribute) === focusId)?.focus();
    }
    clearDrop() { this.container.querySelectorAll('.ao-drop-active').forEach(el => el.classList.remove('ao-drop-active')); }
    async click(event) {
      const button = event.target.closest('button');
      if (!button || this.busy) return;
      const d = button.dataset;
      this.message = '';
      if ('cancel' in d) { this.cancel(); return; }
      if ('save' in d) {
        this.busy = true; this.message = 'Saving…'; this.draw();
        try { await this.save(copy(this.layout)); }
        catch (error) { this.busy = false; this.message = error.message || 'Could not save. Please try again.'; this.draw(); }
        return;
      }
      if ('move' in d) this.layout = move(this.layout, [...this.selected], this.container.querySelector('[data-destination]').value);
      if ('create' in d) {
        const name = this.container.querySelector('[data-name]').value.trim();
        if (!name) { this.message = 'Enter a folder name.'; this.draw(); this.container.querySelector('[data-name]').focus(); return; }
        const id = 'folder-' + crypto.randomUUID();
        this.layout.items.push({ type: 'folder', id, name, items: [] });
        this.layout = move(this.layout, [...this.selected], id);
      }
      if (d.rename) {
        const folder = this.layout.items.find(x => x.id === d.rename);
        const name = prompt('Folder name', folder.name);
        if (name === null) return;
        if (!name.trim() || name.trim().length > 100) { this.message = 'Use a folder name between 1 and 100 characters.'; }
        else folder.name = name.trim();
      }
      if (d.remove) {
        const i = this.layout.items.findIndex(x => x.id === d.remove);
        this.layout.items.splice(i, 1, ...this.layout.items[i].items.map(id => ({ type: 'assignment', id })));
      }
      const id = d.up || d.down || d.folderUp || d.folderDown;
      if (id) {
        const parent = this.layout.items.find(x => x.type === 'folder' && x.items.includes(id));
        const list = parent ? parent.items : this.layout.items;
        const visible = list.filter(x => typeof x === 'string' ? this.assignments.has(x) : x.type === 'folder' || this.assignments.has(x.id));
        const index = visible.findIndex(x => (typeof x === 'string' ? x : x.id) === id);
        const other = visible[index + (d.up || d.folderUp ? -1 : 1)];
        if (other) {
          const a = list.indexOf(visible[index]), b = list.indexOf(other);
          [list[a], list[b]] = [list[b], list[a]];
        }
      }
      const focus = Object.keys(d)[0];
      this.draw('data-' + focus.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), d[focus]);
    }
  }
  root.AssignmentOrganization = { normalize, move, render, Editor };
  if (typeof module !== 'undefined') module.exports = root.AssignmentOrganization;
})(typeof window !== 'undefined' ? window : globalThis);
