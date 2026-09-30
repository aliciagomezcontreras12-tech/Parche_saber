// mobile-menu.js v7
(function () {
  'use strict';

  var btn = document.getElementById('navMobileBtn');
  var overlay = document.getElementById('sidebarOverlay');
  var sidebar = document.getElementById('sidebar');

  if (!btn || !overlay || !sidebar) {
    return;
  }

  function isMobileView() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  // Única fuente de verdad: recalcula botón, overlay y aria-expanded
  // a partir del estado real (clases del body), sin importar qué
  // código haya tocado 'sidebar-open' (mobile-menu.js u otro script).
  function syncVisibility() {
    var authActive = document.body.classList.contains('auth-active');
    var mobile = isMobileView();
    var shouldHideBtn = authActive || !mobile;

    btn.setAttribute('aria-hidden', shouldHideBtn ? 'true' : 'false');
    btn.style.display = shouldHideBtn ? 'none' : 'flex';

    var wantsOpen = document.body.classList.contains('sidebar-open');
    var canBeOpen = wantsOpen && !authActive && mobile;

    // Si algo dejó la clase puesta en un estado donde no debería
    // (p. ej. login, o pasar a desktop), la limpiamos.
    if (wantsOpen && !canBeOpen) {
      document.body.classList.remove('sidebar-open');
    }

    overlay.style.display = canBeOpen ? 'block' : 'none';
    btn.setAttribute('aria-expanded', canBeOpen ? 'true' : 'false');
  }

  function open() {
    if (document.body.classList.contains('auth-active') || !isMobileView()) return;
    document.body.classList.add('sidebar-open');
    syncVisibility();
  }

  function close() {
    document.body.classList.remove('sidebar-open');
    syncVisibility();
  }

  function toggle(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (document.body.classList.contains('auth-active')) return;
    if (document.body.classList.contains('sidebar-open')) {
      close();
    } else {
      open();
    }
  }

  btn.addEventListener('click', toggle);
  btn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    toggle(e);
  }, { passive: false });

  overlay.addEventListener('touchstart', function (e) {
    e.preventDefault();
    close();
  }, { passive: false });
  overlay.addEventListener('click', close);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target) return;
    if (target.id === 'sidebarCloseBtn' || (target.parentElement && target.parentElement.id === 'sidebarCloseBtn')) {
      close();
      return;
    }
    if (target.closest && target.closest('.navbtn')) {
      close();
    }
  });

  window.addEventListener('resize', syncVisibility);

  if (window.MutationObserver) {
    // Se dispara con CUALQUIER cambio de clase en el body, incluido
    // cuando otro script (por ejemplo app.js al navegar) quita
    // 'sidebar-open' directamente. Así el overlay y el aria-expanded
    // nunca quedan desincronizados del sidebar real.
    var observer = new MutationObserver(function () {
      syncVisibility();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  syncVisibility();

  window.openMobileSidebar = open;
  window.closeMobileSidebar = close;
})();