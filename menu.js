(function () {
  var links = document.getElementById('nav-links');
  var menu = document.getElementById('menu-btn');
  if (!links || !menu) return;

  function setOpen(open) {
    links.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  menu.addEventListener('click', function () { setOpen(!links.classList.contains('open')); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
})();
