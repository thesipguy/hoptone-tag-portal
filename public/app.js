document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-check-all]');
  if (!btn) return;
  const on = btn.getAttribute('data-check-all') === 'true';
  btn.closest('form').querySelectorAll('input[name="blocked"]').forEach((cb) => { cb.checked = on; });
});
