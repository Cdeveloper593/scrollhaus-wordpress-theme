/**
 * Scrollhaus — scroll scene engine.
 *
 * Vanilla-JS port of the reference scene renderer: it measures the .st
 * sections inside #world, projects their .el elements in 3D as the visitor
 * scrolls, draws the continuous line on the #cv canvas, drives the #hud
 * progress rail, and interpolates the palette between light and dark stops.
 *
 * Every optional element is guarded: if the canvas is missing (project
 * singles), only the overlay-menu burger is wired and the page behaves
 * like a normal WordPress page. The accent/line colour comes from the
 * Customizer via the localized `scrollhausScene` object.
 *
 * @package Scrollhaus
 */
(function () {
    'use strict';

    var clamp = function (value, min, max) {
        min = min === undefined ? 0 : min;
        max = max === undefined ? 1 : max;
        return Math.max(min, Math.min(max, value));
    };
    var smooth = function (value) {
        var progress = clamp(value);
        return progress * progress * progress * (10 + progress * (-15 + progress * 6));
    };
    var lerp = function (from, to, fraction) {
        return from + (to - from) * fraction;
    };
    var pair = function (value) {
        return (value === undefined || value === null ? '0,0' : value).split(',').map(Number);
    };

    function lineColorRgb() {
        var fallback = [34, 52, 224];
        if (typeof window.scrollhausScene === 'object' && window.scrollhausScene && Array.isArray(window.scrollhausScene.lineRgb)) {
            var rgb = window.scrollhausScene.lineRgb;
            if (rgb.length === 3 && rgb.every(function (n) { return isFinite(n); })) {
                return rgb;
            }
        }
        return fallback;
    }

    var palette = {
        bg: [[236, 234, 226], [11, 12, 11]],
        ink: [[18, 20, 19], [241, 241, 238]],
        muted: [[94, 99, 96], [154, 160, 156]],
        hair: [[211, 208, 198], [44, 47, 45]],
        line: null // filled below from the Customizer colour.
    };
    palette.line = [lineColorRgb(), [124, 138, 255]];

    function interpolatePath(points) {
        var output = [];
        function slope(index, axis) {
            if (!index || index === points.length - 1) {
                return 0;
            }
            return (points[index + 1][axis] - points[index - 1][axis]) / (points[index + 1].z - points[index - 1].z);
        }
        points.slice(0, -1).forEach(function (start, index) {
            var end = points[index + 1];
            var distance = end.z - start.z;
            for (var step = 0; step < 80; step++) {
                var t = step / 80;
                var axis = function (key) {
                    return (2 * t * t * t - 3 * t * t + 1) * start[key]
                        + (t * t * t - 2 * t * t + t) * distance * slope(index, key)
                        + (-2 * t * t * t + 3 * t * t) * end[key]
                        + (t * t * t - t * t) * distance * slope(index + 1, key);
                };
                output.push({ z: start.z + distance * t, x: axis('x'), y: axis('y') });
            }
        });
        return output.concat([points[points.length - 1]]);
    }

    function splitHeadings(root) {
        root.querySelectorAll('.split:not([aria-label])').forEach(function (heading) {
            heading.setAttribute('aria-label', (heading.textContent || '').trim());
            var walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
            var nodes = [];
            var order = 0;
            while (walker.nextNode()) {
                nodes.push(walker.currentNode);
            }
            nodes.forEach(function (node) {
                var fragment = document.createDocumentFragment();
                node.data.split(/(\s+)/).forEach(function (word) {
                    if (!word.trim()) {
                        fragment.appendChild(document.createTextNode(word));
                        return;
                    }
                    var group = document.createElement('span');
                    group.className = 'w';
                    group.setAttribute('aria-hidden', 'true');
                    word.split('').forEach(function (character) {
                        var letter = document.createElement('span');
                        letter.className = 'c';
                        letter.textContent = character;
                        letter.style.setProperty('--i', String(order++));
                        group.appendChild(letter);
                    });
                    fragment.appendChild(group);
                });
                node.parentNode.replaceChild(fragment, node);
            });
        });
    }

    function mountScene(root) {
        var doc = document.documentElement;
        var canvas = root.querySelector('#cv');
        if (!canvas) {
            return false;
        }
        var context = canvas.getContext('2d');
        var sections = Array.prototype.slice.call(root.querySelectorAll('.st'));
        if (!sections.length) {
            return false;
        }
        var abort = new AbortController();
        var options = { signal: abort.signal };
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var frame = 0;
        var render = function () {};
        var go = function () {};
        var lastWidth = 0;
        var position = window.scrollY;
        var previous = -1;
        var timestamp = performance.now();
        var routeTarget = window.location.hash.slice(1);
        var count = root.querySelector('#count');
        var burger = root.querySelector('#burger');
        var menuOpen = false;

        splitHeadings(root);
        doc.classList.add('is3d');

        function measure() {
            if (abort.signal.aborted) {
                return;
            }
            var width = window.innerWidth;
            var height = canvas.getBoundingClientRect().height || window.innerHeight;
            var mobile = width < 760;
            lastWidth = width;
            var unit = mobile ? 900 : clamp(width * 0.8, 900, 1400);
            var scale = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = width * scale;
            canvas.height = height * scale;
            if (context) {
                context.setTransform(scale, 0, 0, scale, 0, 0);
            }
            var stops = [];
            var anchors = [];
            var depth = 0;
            var scroll = 0;
            var direction = 1;
            var scenes = sections.map(function (section, index) {
                var gap = Number(section.dataset.gap || 3);
                var anchorPair = pair((mobile && section.dataset.ma) || section.dataset.a);
                var ax = anchorPair[0];
                var ay = anchorPair[1];
                if (index && gap >= 2.2) {
                    direction *= -1;
                    anchors.push({ z: depth + gap * unit / 2, x: direction * (mobile ? 0.85 : 1.05) * width, y: (direction > 0 ? -0.42 : 0.46) * height });
                }
                if (index) {
                    depth += gap * unit;
                    scroll += gap * (mobile ? 0.52 : 0.46) * height;
                }
                var hold = Number(section.dataset.hold || 0.6) * height * 0.55;
                var start = scroll;
                anchors.push({ z: depth, x: ax * width, y: ay * height });
                stops.push({ s: start, z: depth - unit * (!index ? 1 : 1.11), ease: Number(section.dataset.ease || 1) * 0.45 });
                scroll += hold;
                stops.push({ s: scroll, z: depth - unit * (index ? 0.89 : 0.82), ease: 0 });
                var elements = Array.prototype.slice.call(section.querySelectorAll('.el')).map(function (element) {
                    var pos = pair((mobile && element.dataset.mp) || element.dataset.p);
                    var fly = pair(element.dataset.f);
                    var offset = Number(element.dataset.z || 0);
                    var absolute = Number(element.dataset.abs || 0);
                    var rotate = mobile ? 0 : Number(element.dataset.r || 0);
                    element.classList.toggle('far', offset > 0.2);
                    element.querySelectorAll('.d').forEach(function (text) {
                        if (window.getComputedStyle(text).whiteSpace !== 'nowrap') {
                            return;
                        }
                        text.style.fontSize = '';
                        if (text.offsetWidth > width * 0.9) {
                            text.style.fontSize = (parseFloat(window.getComputedStyle(text).fontSize) * width * 0.9 / text.offsetWidth) + 'px';
                        }
                    });
                    return {
                        element: element,
                        x: pos[0],
                        y: pos[1],
                        fx: fly[0] * (mobile ? 0.5 : 1),
                        fy: fly[1],
                        offset: offset,
                        absolute: absolute,
                        rotate: rotate,
                        poses: Array.prototype.slice.call(element.querySelectorAll('.pose img')),
                        node: element.querySelector('.node'),
                        letters: Array.prototype.slice.call(element.querySelectorAll('.jr-h .c'))
                    };
                });
                return { section: section, depth: depth, gap: gap, hold: hold, start: start, ax: ax, ay: ay, elements: elements, label: section.dataset.label || '' };
            });

            var path = interpolatePath(anchors);
            var markers = scenes.filter(function (scene, index) {
                return !index || scene.gap >= 2.2;
            });
            var labelNumber = 0;
            var markerNumbers = markers.map(function (marker, index) {
                if (!index || marker.label !== markers[index - 1].label) {
                    labelNumber = index + 1;
                }
                return labelNumber;
            });

            var ticks = root.querySelector('#ticks');
            if (ticks) {
                var tickNodes = markers.map(function (marker) {
                    var tick = document.createElement('i');
                    tick.className = 'tk';
                    tick.style.top = (marker.start / scroll * 100) + '%';
                    return tick;
                });
                ticks.replaceChildren.apply(ticks, tickNodes);
            }
            var spacer = root.querySelector('#spacer');
            if (spacer) {
                spacer.style.height = (scroll + height) + 'px';
            }

            go = function (target, animated) {
                var scene = null;
                scenes.forEach(function (candidate) {
                    if (candidate.section.id === target) {
                        scene = candidate;
                    }
                });
                if (!scene) {
                    return;
                }
                var top = scene.start + (target === 'hero' ? 0 : 2);
                window.scrollTo({ top: top, behavior: 'instant' });
                if (!animated) {
                    position = top;
                    previous = -1;
                    render();
                }
            };

            render = function () {
                var progress = clamp(position, 0, scroll);
                var stopIndex = stops.findIndex(function (stop) { return stop.s >= progress; });
                var end = stops[Math.max(1, stopIndex)];
                var start = stops[Math.max(0, stopIndex - 1)];
                var t = clamp((progress - start.s) / Math.max(1, end.s - start.s));
                var camera = lerp(start.z, end.z, lerp(t, smooth(t), end.ease));
                var dark = 0;

                scenes.forEach(function (scene) {
                    var delta = scene.depth - camera - unit;
                    if (scene.section.dataset.dark) {
                        dark = Math.max(dark, Math.min(1 - smooth((delta / unit - 0.45) / 0.85), 1 - smooth((-delta / unit - 0.6) / 0.65)));
                    }
                    scene.elements.forEach(function (item) {
                        var element = item.element;
                        var offset = item.offset;
                        var distance = scene.depth + offset * unit - camera;
                        var fade = clamp(scene.gap * 0.82, 1, 1.7) * unit;
                        var opacity = delta > 0
                            ? 1 - smooth((delta - 0.45 * fade) / (0.55 * fade))
                            : 1 - smooth((-delta - 0.22 * unit) / (0.42 * unit));
                        if (distance < 0.16 * unit || opacity < 0.01) {
                            element.style.visibility = 'hidden';
                            return;
                        }
                        var zoom = unit * (item.absolute || 1 + offset) / distance;
                        var drift = smooth(delta / (1.9 * unit));
                        var reveal = clamp((0.55 * unit - delta) / (0.65 * unit));
                        element.style.visibility = 'visible';
                        element.style.opacity = String(opacity);
                        element.style.pointerEvents = opacity > 0.6 && zoom < 1.6 ? 'auto' : 'none';
                        element.style.transform = 'translate3d(' + (width * (0.5 + (item.x + item.fx * drift) * zoom)) + 'px,' + (height * (0.5 + (item.y + item.fy * drift) * zoom)) + 'px,0) translate(-50%,-50%) perspective(1100px) rotateY(' + (item.rotate * drift) + 'deg) scale(' + zoom + ')';
                        element.style.setProperty('--k', String(drift));
                        element.style.setProperty('--fp', String(reveal));
                        element.style.setProperty('--dp', String(smooth((-delta / unit - 0.03) / 0.38)));
                        element.style.setProperty('--sp', String(smooth((-delta / unit - 0.03) / 0.38)));
                        if (item.node) {
                            item.node.classList.toggle('on', delta < 0.05 * unit);
                        }
                        item.poses.forEach(function (pose, index) {
                            pose.classList.toggle('on', index === Math.round(clamp((0.04 - delta / unit) / 0.42) * (item.poses.length - 1)));
                        });
                        if (item.letters.length) {
                            item.letters.forEach(function (letter, index) {
                                letter.style.setProperty('--cf', (clamp(reveal * (item.letters.length + 1) - index) * 100) + '%');
                            });
                        }
                    });
                });

                var statsScene = null;
                scenes.forEach(function (candidate) {
                    if (candidate.section.id === 'numbers') {
                        statsScene = candidate;
                    }
                });
                if (count && statsScene) {
                    var target = parseInt(count.getAttribute('data-target') || '0', 10);
                    if (isFinite(target) && target > 0) {
                        count.textContent = String(Math.round(target * smooth((progress - statsScene.start + 0.28 * height) / (0.56 * height))));
                    }
                }

                var colors = Object.keys(palette).map(function (key) {
                    var from = palette[key][0];
                    var to = palette[key][1];
                    var color = 'rgb(' + from.map(function (channel, index) {
                        return Math.round(lerp(channel, to[index], dark));
                    }).join(',') + ')';
                    doc.style.setProperty('--' + key, color);
                    return color;
                });

                if (context) {
                    context.clearRect(0, 0, width, height);
                    context.strokeStyle = colors[4];
                    context.fillStyle = colors[4];
                    var reach = unit * (mobile ? 3 : 3.3);
                    var tip = Math.min(camera + reach, path[path.length - 1].z);
                    var last = null;
                    for (var index = 0; index < path.length; index++) {
                        var point = path[index];
                        if (point.z < camera + 0.1 * unit) {
                            continue;
                        }
                        if (point.z > tip && index) {
                            var prior = path[index - 1];
                            var blend = clamp((tip - prior.z) / (point.z - prior.z));
                            point = { z: tip, x: lerp(prior.x, point.x, blend), y: lerp(prior.y, point.y, blend) };
                        }
                        var dist = point.z - camera;
                        var w = unit / dist;
                        var next = { x: width / 2 + point.x * w, y: height / 2 + point.y * w, w: w };
                        if (last) {
                            context.globalAlpha = (1 - 0.82 * smooth((dist - 1.2 * unit) / (reach - 1.2 * unit))) * smooth((dist / unit - 0.1) / 0.3);
                            context.lineWidth = clamp(2.4 * w, 0.5, 7);
                            context.beginPath();
                            context.moveTo(last.x, last.y);
                            context.lineTo(next.x, next.y);
                            context.stroke();
                        }
                        last = next;
                        if (point.z >= tip) {
                            break;
                        }
                    }
                    if (last) {
                        var finalPoint = tip >= path[path.length - 1].z - 1;
                        var radius = finalPoint ? clamp(11 * last.w, 6, 22) : clamp(5 * last.w, 2.5, 14);
                        if (!finalPoint) {
                            context.globalAlpha = 0.18;
                            context.beginPath();
                            context.arc(last.x, last.y, radius * 2.6, 0, Math.PI * 2);
                            context.fill();
                        }
                        context.globalAlpha = 1;
                        context.beginPath();
                        context.arc(last.x, last.y, radius, 0, Math.PI * 2);
                        context.fill();
                    }
                }

                var hud = root.querySelector('#hud');
                if (hud) {
                    hud.style.setProperty('--p', String(progress / scroll));
                }
                var marker = 0;
                markers.forEach(function (candidate, index) {
                    if (progress >= candidate.start - 0.6 * height) {
                        marker = index;
                    }
                });
                var hudn = root.querySelector('#hudn');
                var hudl = root.querySelector('#hudl');
                if (hudn && markers[marker]) {
                    hudn.textContent = String(markerNumbers[marker]).padStart(2, '0');
                }
                if (hudl && markers[marker]) {
                    hudl.textContent = markers[marker].label;
                }
                if (ticks) {
                    Array.prototype.forEach.call(ticks.children, function (tick, index) {
                        tick.classList.toggle('on', markers[index] && markers[index].start <= progress + 2);
                    });
                }
            };

            previous = -1;
            if (routeTarget) {
                go(routeTarget, false);
            }
            render();
        }

        function animate(now) {
            var elapsed = Math.min(0.05, (now - timestamp) / 1000);
            timestamp = now;
            var distance = window.scrollY - position;
            position = reduced || Math.abs(distance) < 0.3
                ? window.scrollY
                : position + distance * (1 - Math.exp(-elapsed * (Math.abs(distance) > window.innerHeight * 3 ? 9 : 5.5)));
            if (position !== previous) {
                previous = position;
                render();
            }
            frame = requestAnimationFrame(animate);
        }

        function toggleMenu(open) {
            menuOpen = open;
            doc.classList.toggle('menu-open', open);
            doc.style.overflow = open ? 'hidden' : '';
            if (burger) {
                burger.setAttribute('aria-expanded', String(open));
            }
        }

        root.addEventListener('click', function (event) {
            var control = event.target.closest ? event.target.closest('[data-go],button') : null;
            if (!control) {
                return;
            }
            if (control.dataset && control.dataset.go) {
                event.preventDefault();
                routeTarget = '';
                toggleMenu(false);
                go(control.dataset.go, true);
                return;
            }
            if (control.id === 'burger') {
                toggleMenu(!menuOpen);
            } else if (control.id === 'copy') {
                var mail = root.querySelector('#mail');
                var address = mail ? (mail.textContent || '').trim() : '';
                if (address && navigator.clipboard) {
                    var original = control.textContent;
                    navigator.clipboard.writeText(address).then(function () {
                        control.textContent = 'Copied';
                        window.setTimeout(function () { control.textContent = original; }, 1800);
                    }).catch(function () {
                        if (mail && mail.focus) {
                            mail.focus();
                        }
                    });
                }
            }
        }, options);

        window.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && menuOpen) {
                toggleMenu(false);
                if (burger) {
                    burger.focus();
                }
            }
        }, options);
        window.addEventListener('resize', function () {
            if (window.innerWidth !== lastWidth || !window.matchMedia('(pointer: coarse)').matches) {
                measure();
            }
        }, options);
        window.addEventListener('hashchange', function () {
            go(window.location.hash.slice(1), false);
        }, options);

        measure();
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                measure();
                routeTarget = '';
            });
        }
        frame = requestAnimationFrame(animate);
        return true;
    }

    function wireBurgerOnly() {
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

    function init() {
        if (!mountScene(document.body)) {
            wireBurgerOnly();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
