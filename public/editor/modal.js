/* public/editor/modal.js
   Modal helpers. Exposes window.Modal = { showPrompt, showInput, showConfirm, showCustom, hide }.
   Keyboard: Enter submits, Escape cancels, backdrop click cancels.
*/
(function () {
  const modal = document.getElementById('modal-container');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalConfirm = document.getElementById('modal-confirm');
  const modalCancel = document.getElementById('modal-cancel');
  const backdrop = document.querySelector('.modal-backdrop');

  let confirmCb = null;
  let cancelCb = null;

  function hide() {
    modal.classList.add('hidden');
    confirmCb = null;
    cancelCb = null;
  }

  function fireConfirm() {
    const cb = confirmCb;
    hide();
    if (cb) Promise.resolve(cb()).catch(err => console.error('[Modal] onConfirm error:', err));
  }
  function fireCancel() {
    const cb = cancelCb;
    hide();
    if (cb) Promise.resolve(cb()).catch(err => console.error('[Modal] onCancel error:', err));
  }

  modalConfirm.onclick = fireConfirm;
  modalCancel.onclick = fireCancel;
  backdrop?.addEventListener('click', fireCancel);

  document.addEventListener('keydown', (e) => {
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Enter') {
      // Don't hijack Enter inside a textarea
      if (e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      fireConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fireCancel();
    }
  });

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function showInput({ title, defaultValue = '', placeholder = '', confirmText = 'Confirm', onConfirm, onCancel }) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<input type="text" id="modal-input" class="modal-input" autocomplete="off" placeholder="${esc(placeholder)}" />`;
    const inp = document.getElementById('modal-input');
    inp.value = defaultValue;
    modalConfirm.style.display = '';
    modalConfirm.textContent = confirmText;
    modalCancel.style.display = '';
    modalConfirm.classList.remove('danger');
    modal.classList.remove('hidden');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    confirmCb = () => onConfirm?.(inp.value);
    cancelCb = () => onCancel?.();
  }

  // Back-compat wrapper for existing call sites: showPrompt(title, defaultVal, cb).
  function showPrompt(title, defaultValue, cb) {
    showInput({ title, defaultValue, onConfirm: cb });
  }

  function showConfirm({ title, message, confirmText = 'Confirm', danger = false, onConfirm, onCancel }) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<p style="color:var(--text-secondary);line-height:1.5">${esc(message)}</p>`;
    modalConfirm.style.display = '';
    modalConfirm.textContent = confirmText;
    modalConfirm.classList.toggle('danger', !!danger);
    modalCancel.style.display = '';
    modal.classList.remove('hidden');
    setTimeout(() => modalConfirm.focus(), 50);
    confirmCb = () => { modalConfirm.classList.remove('danger'); onConfirm?.(); };
    cancelCb = () => { modalConfirm.classList.remove('danger'); onCancel?.(); };
  }

  function showCustom({ title, bodyHtml, confirmText = 'Confirm', onConfirm, onCancel, hideConfirm = false }) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalConfirm.style.display = hideConfirm ? 'none' : '';
    modalConfirm.textContent = confirmText;
    modalCancel.style.display = '';
    modalConfirm.classList.remove('danger');
    modal.classList.remove('hidden');
    confirmCb = onConfirm ? () => onConfirm() : null;
    cancelCb = onCancel ? () => onCancel() : null;
  }

  window.Modal = { showPrompt, showInput, showConfirm, showCustom, hide };
})();
