/**
 * Scrollhaus — overlay menu toggle for non-scene pages.
 * (On scene pages, assets/js/scene.js owns the burger instead.)
 */
(function () {
    'use strict';

    function init() {
        var burger = document.getElementById('burger');
        if (!burger) {
            return;
        }
        var doc = document.documentElement;
        var open = false;

        function toggle(next) {
            open = next;
            doc.classList.toggle('menu-open', open);
            doc.style.overflow = open ? 'hidden' : '';
            burger.setAttribute('aria-expanded', String(open));
        }

        burger.addEventListener('click', function () {
            toggle(!open);
        });

        window.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && open) {
                toggle(false);
                burger.focus();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
