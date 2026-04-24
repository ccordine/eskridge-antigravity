(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

// --- recyclr: presets storage cache (TTL) ------------------------------------
function __recyclrStorageAvailable() {
    try {
        const x = '__recyclr__' + Math.random().toString(36).slice(2);
        window.localStorage.setItem(x, '1');
        window.localStorage.removeItem(x);
        return true;
    } catch (_) { return false; }
}

function __recyclrPresetsCacheKey(url) {
    return `recyclr:presets:${url}`;
}

function __recyclrReadPresetsCache(url, ttlMs) {
    if (!__recyclrStorageAvailable()) return null;
    try {
        const raw = window.localStorage.getItem(__recyclrPresetsCacheKey(url));
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return null;
        const now = Date.now();
        if (typeof obj.ts !== 'number' || (ttlMs > 0 && (now - obj.ts) > ttlMs)) {
            return null;
        }
        return obj.data || null;
    } catch (_) { return null; }
}

function __recyclrWritePresetsCache(url, data) {
    if (!__recyclrStorageAvailable()) return;
    try {
        const obj = { ts: Date.now(), data };
        window.localStorage.setItem(__recyclrPresetsCacheKey(url), JSON.stringify(obj));
    } catch (_) { }
}

async function __recyclrLoadPresetsWithCache(url, ttlMs) {
    // Try cache first
    const cached = __recyclrReadPresetsCache(url, ttlMs);
    if (cached) { return { data: cached, fromCache: true }; }
    // Otherwise fetch and cache
    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return { data: null, fromCache: false };
        const data = await res.json();
        __recyclrWritePresetsCache(url, data);
        return { data, fromCache: false };
    } catch (_) {
        return { data: null, fromCache: false };
    }
}
// --- end storage cache --------------------------------------------------------


// --- Recyclr Presets system --------------------------------------------------
function __recyclrParseRule(ruleStr) {
    // "<srcSel>@<srcLoc> -> <dstSel>@<dstLoc>" OR 'literal("...") -> <dstSel>@<dstLoc>'
    const parts = String(ruleStr || '').split(/->/);
    if (parts.length !== 2) return null;
    const L = parts[0].trim();
    const R = parts[1].trim();
    const mR = R.match(/^(?<dst>.+?)@(?<dstLoc>[a-zA-Z][\w-]*)$/);
    if (!mR) return null;
    const right = { dst: mR.groups.dst.trim(), dstLoc: mR.groups.dstLoc.trim() };

    const lit = L.match(/^literal\((?<lit>.*)\)$/i);
    if (lit) {
        let v = lit.groups.lit.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        return { literal: v, ...right };
    }

    const mL = L.match(/^(?<src>.+?)@(?<srcLoc>[a-zA-Z][\w-]*)$/);
    if (!mL) return null;
    return { src: mL.groups.src.trim(), srcLoc: mL.groups.srcLoc.trim(), ...right };
}

function __recyclrNormalizeLoc(loc) {
    switch ((loc || 'innerHTML')) {
        case 'text': return 'textContent';
        case 'append': return 'beforeend';
        default: return loc;
    }
}

async function __recyclrLoadPresetsExternal(url) {
    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}

function __recyclrBuildEventsFromPresetRules(html, rules) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events = [];
    for (const rule of (rules || [])) {
        let selection = '';
        if (typeof rule.literal === 'string') {
            selection = rule.literal;
        } else if (rule.src) {
            const node = doc.querySelector(rule.src);
            if (!node) { __recyclrDebugLog(this, 'preset src missing', rule.src); continue; }
            const srcLoc = __recyclrNormalizeLoc(rule.srcLoc || 'innerHTML');
            if (srcLoc === 'outerHTML') selection = node.outerHTML;
            else if (srcLoc === 'textContent') selection = node.textContent;
            else selection = node.innerHTML;
        } else {
            __recyclrDebugLog(this, 'preset rule invalid', rule); continue;
        }
        const dstLoc = __recyclrNormalizeLoc(rule.dstLoc || 'innerHTML');
        events.push({ selector: rule.dst, location: dstLoc, selection });
    }
    return events;
}
// --- end presets system ------------------------------------------------------


// --- recyclr: debug utility ---
function __recyclrDebugLog(ctx, ...args) {
    try {
        const debugOn = !!(ctx && (ctx.debug || (ctx.config && ctx.config.debug)));
        if (debugOn && typeof console !== 'undefined' && console.log) {
            __recyclrDebugLog(this, '[recyclr]', ...args);
        }
    } catch (e) {
        /* no-op */
    }
}
// --- end debug utility ---


// --- recyclr: global loading overlay ---
const RECYCLR_GLOBAL_LOADING_KEY = '__recyclrGlobalLoadingStateV1';
const RECYCLR_GLOBAL_LOADING_SELECTOR = '#gx-global-loading-indicator';

function __recyclrGlobalRef() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return null;
}

function __recyclrGlobalLoadingState() {
    const ref = __recyclrGlobalRef();
    if (!ref) {
        return { activeCount: 0 };
    }

    if (!ref[RECYCLR_GLOBAL_LOADING_KEY] || typeof ref[RECYCLR_GLOBAL_LOADING_KEY] !== 'object') {
        ref[RECYCLR_GLOBAL_LOADING_KEY] = { activeCount: 0 };
    }

    return ref[RECYCLR_GLOBAL_LOADING_KEY];
}

function __recyclrSetGlobalLoadingVisible(visible) {
    try {
        const target = document.querySelector(RECYCLR_GLOBAL_LOADING_SELECTOR);
        if (!target) return;

        const show = !!visible;
        target.classList.toggle('hidden', !show);
        target.classList.toggle('flex', show);
        target.setAttribute('aria-hidden', show ? 'false' : 'true');
    } catch (_) { }
}

function __recyclrBeginGlobalLoading() {
    const state = __recyclrGlobalLoadingState();
    state.activeCount = Math.max(0, (state.activeCount || 0)) + 1;
    __recyclrSetGlobalLoadingVisible(true);
}

function __recyclrEndGlobalLoading() {
    const state = __recyclrGlobalLoadingState();
    state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
    __recyclrSetGlobalLoadingVisible(state.activeCount > 0);
}
// --- end global loading overlay ---

// --- recyclr: preserve scroll utility ---
function __recyclrCaptureScroll(root) {
    const map = new Map();
    try {
        if (!(root instanceof Element)) return map;
        const nodes = [];
        if (root.hasAttribute && root.hasAttribute('data-gx-preserve-scroll')) {
            nodes.push(root);
        }
        root.querySelectorAll && root.querySelectorAll('[data-gx-preserve-scroll]').forEach(n => nodes.push(n));
        nodes.forEach(node => {
            const key = node.getAttribute('data-gx-preserve-scroll') || node.id;
            if (!key) return;
            map.set(key, node.scrollTop);
        });
    } catch (_) { }
    return map;
}

function __recyclrRestoreScroll(map) {
    try {
        if (!map || map.size === 0) return;
        map.forEach((scrollTop, key) => {
            const node = document.querySelector(`[data-gx-preserve-scroll="${key}"]`) || document.getElementById(key);
            if (node) node.scrollTop = scrollTop;
        });
    } catch (_) { }
}
// --- end preserve scroll utility ---

// --- recyclr: singleton DOM guard ---
const __recyclrSingletonIds = [
    'top-nav',
    'sidebar',
    'content',
    'modals',
    'notifications-indicator-shell',
    'gx-global-loading-indicator',
    'modal',
];

function __recyclrDeduplicateSingletonDom() {
    try {
        __recyclrSingletonIds.forEach((id) => {
            const nodes = Array.from(document.querySelectorAll(`#${id}`));
            if (nodes.length <= 1) return;
            nodes.slice(1).forEach((node) => {
                try {
                    node.remove();
                } catch (_) { }
            });
        });
    } catch (_) { }
}
// --- end singleton DOM guard ---


class GX {

    history = false // allow for updating the location / history of the browser
    debug = false // allow for debugging code
    dispatch = false // allow for dispatching events
    method = 'get' // request method, get|put|post|delete|patch|etc
    url = null // the url string that we're sending our request to
    form = null // form HTML element ( in stimulus, we just pass in the srcElement, not this.element, the controller goes on the document body)
    selection = null // a string to describe what we want to select and replace selectionSelector@location->targetSelector@location
    identifier = null // event name when dispatching
    loading = null // selector query string, show spinner
    error = null // selector query string, show error
    disable = null // selector query string, disable all targets
    background = false // background requests skip global loading overlay
    data = null // add in data from submit buttons or stuff
    presets = null
    config = null
    constructor({
        history,
        debug,
        dispatch,
        method,
        url,
        form,
        selection,
        identifier,
        loading,
        error,
        disable,
        background,
        data,
        config,
        presets,
        presetsUrl,
        presetsTTLMs
    }) {
        const __recyclrHistoryOn = (history === 'on' || history === true);
        if (__recyclrHistoryOn) {
            try {
                if (typeof window !== 'undefined' && !window.__recyclrPopstateBound) {
                    window.__recyclrPopstateBound = true;
                    window.addEventListener('popstate', () => location.reload(), { passive: true });
                }
            } catch (_) {
                /* no-op */
            }
        }

        if (typeof debug === 'boolean') this.debug = debug;
        if (typeof dispatch === 'boolean') this.dispatch = dispatch;
        if (typeof history === 'boolean') this.history = history;
        if (typeof background === 'boolean') this.background = background;

        if (this.validate({
            config: {
                type: 'object',
                value: config,
                // instance: HTMLElement not available in node
            }
        }, true)) this.config = config

        if (!this.config && ((typeof presetsUrl === 'string' && presetsUrl.length) || typeof presetsTTLMs === 'number')) {
            this.config = {};
        }

        if (this.config && typeof presetsUrl === 'string' && presetsUrl.length) this.config.presetsUrl = presetsUrl;
        if (this.config && typeof presetsTTLMs === 'number') this.config.presetsTTLMs = presetsTTLMs;

        if (this.validate({
            debug: {
                type: 'string',
                value: debug,
                options: [
                    'on',
                    'off'
                ]
            }
        }, true)) {
            if (debug == 'on') this.debug = true
        }

        if (this.validate({
            presets: {
                type: 'string',
                value: presets
            }
        })) this.presets = presets.split(' ');

        if (this.presets != null && this.presets.length > 0 && this.config?.presets && Object.keys(this.config.presets).length > 0) {
            if (selection == null) {
                selection = ''
            }
            let selections = selection.split(' ');
            this.presets.forEach(preset => {
                if (this.config.presets[preset] ?? false) {
                    selections.push(this.config.presets[preset])
                }
            });
            selection = selections.filter(item => item != '').join(' ')
        }

        if (this.validate({
            selection: {
                type: 'string',
                value: selection
            }
        })) this.selection = selection

        if (this.validate({
            url: {
                type: 'string',
                value: url
            }
        })) this.url = url

        if (this.validate({
            identifier: {
                type: 'string',
                value: identifier
            }
        }, true)) this.identifier = identifier

        if (this.validate({
            loading: {
                type: 'string',
                value: loading
            }
        }, true)) this.loading = loading

        if (this.validate({
            disable: {
                type: 'string',
                value: disable
            }
        }, true)) this.disable = disable

        if (this.validate({
            error: {
                type: 'string',
                value: error
            }
        }, true)) this.error = error

        if (this.validate({
            form: {
                type: 'object',
                value: form,
                // instance: HTMLElement not available in node
            }
        }, true)) this.form = form

        if (this.validate({
            history: {
                type: 'string',
                value: history,
                options: [
                    'on',
                    'off'
                ]
            }
        }, true)) {
            if (history == 'on') this.history = true
        }

        if (this.validate({
            dispatch: {
                type: 'string',
                value: dispatch,
                options: [
                    'on',
                    'off'
                ]
            }
        }, true)) {
            if (dispatch == 'on') this.dispatch = true
        }

        if (this.validate({
            background: {
                type: 'string',
                value: background,
                options: [
                    'on',
                    'off'
                ]
            }
        }, true)) {
            this.background = background === 'on'
        }

        if (this.validate({
            method: {
                type: 'string',
                value: method,
                options: [
                    'get',
                    'put',
                    'post'
                ]
            }
        }, true)) {
            this.method = method
        }

        this.data = data ?? null
    }

    fixQueryString(url) {
        try {
            const raw = String(url ?? '');
            const normalized = raw.replace(/&amp;/g, '&');
            const u = new URL(normalized, window.location.href);
            return u.toString();
        } catch (e) {
            __recyclrDebugLog(this, 'fixQueryString fallback', e);
            return url;
        }
    }

    async request() {
        __recyclrDebugLog(this, 'request')
        // How will we determine the request method?
        // gx-get? gx-method? something else?
        /**
         *
         * Essentially, we'll load these gx attributes onto the trigger, which may be a form element, or just an element that has some inputs, or something else
         *
         * Some kind of event will trigger the gx-controller to use the GX class to make a request, parse the mapping, and evaluate it
         *
         * Examples:
         *
         * A button is clicked, and it updates a few locations on the page
         *
         * A form is submitted, and it updates a few locations on the page
         *
         * An api URL is being polled and will trigger the gx-controller to update the page because a certain event has occurred in the background
         *
         * A button is clicked, and we want to open a modal
         *
         * The nav is opened, a nav button is clicked, and we want to open a modal
         *
         * Different classes or controllers are added to an element, but the content of that element is untouched
         *
         *
         * Concept:
         *
         * We'll want to be able to get the data from the sourceElement of the event, then we'll use that data, make a javascript request, and update certain locations on the page
         *
         * We may want to study more HTMX to see any edge-cases I'm missing, but I think I've got all I need covered here
         *
         * I want to make one single request, and update multiple locations, being as efficient as possible
         *
         * I also want to handle redirects from the server if needed, preserving the from location and the intent, so that we can navigate back, like if logged out
         *
         * I also want to use this for polling for events and random encounters
         *
         * Potential Solutions:
         *
         * I may do a gx-get, gx-put, gx-post, gx-patch, gx-all, etc, and grab which-ever is needed based on the given method during the handler, so that if I trigger it from something else, I can determine what actions is handled for each case
         * This might not be necessary though
         * I may just do gx-method, gx-route, gx-select
         *
         * I'll also want to do something like how hx-disable, hx-loading, etc, just selectors and attributes to use on the page
         *
         */
        const useGlobalLoading = !this.background;
        __recyclrDebugLog(this, 'show loading here...', { useGlobalLoading })
        if (useGlobalLoading) {
            __recyclrBeginGlobalLoading()
        }
        if (this.loading) {
            this.handleShowSpinner()
        }
        let valid = this.validate({
            // form: {
            // type:'object',
            // value:this.form
            // },
            url: {
                type: 'string',
                value: this.url
            },
            selection: {
                type: 'string',
                value: this.selection
            },
            method: {
                type: 'string',
                value: this.method
            },
        })
        if (!valid) {
            throw new Error('Missing requirements to make a request...')
            return false
        }

        // From here we need to:
        // disable all disable targets
        // show the loading target
        // hide all relevant event targets

        this.url = this.fixQueryString(this.url)

        try {


            let requestBody = {
                // headers: {
                // "Content-Type": "application/x-www-form-urlencoded",
                // "Content-Type": "multipart/form-data",
                // },
            }

            requestBody.method = this.method.toUpperCase()
            if (this.form !== null) {
                let formData = new FormData(this.form)
                if (this.data !== null) {
                    let keys = Object.keys(this.data)
                    keys.forEach(key => {
                        formData.append(key, this.data[key]);
                    })
                }
                switch (this.method) {
                    case 'put':
                    case 'post':
                        requestBody.body = formData
                        break
                    case 'get':
                        const queryString = new URLSearchParams(formData).toString();
                        this.url += `?${queryString}`
                        this.url = this.fixQueryString(this.url)
                        break;
                    default:
                        console.error(`No actionable case...`)
                        break
                }
            }
            let condition = null
            let target = await applyBusyState(this?.target || document, true);
            let response = await fetch(this.url, requestBody).then(response => {
                __recyclrDebugLog(this, 'here we need to figure out what the response was')
                __recyclrDebugLog(this, 'Status code:', response.status);
                __recyclrDebugLog(this, 'selection:')
                __recyclrDebugLog(this, this.selection)
                if (response.redirected) {
                    __recyclrDebugLog(this, 'this has been redirected')
                    condition = 'redirect'
                }
                if (!response.ok) {
                    condition = 'error'
                    // new Error('Network response was not ok ' + response.statusText);
                    console.error('There was a problem with the fetch operation');
                }
                this.url = response.url
                return response; // Get the response as text (HTML)
            })
            let html = await response.text()
            let res = response

            __recyclrDebugLog(this, 'hide loading here...')
            valid = this.validate({
                html: {
                    type: 'string',
                    value: html
                },
                selection: {
                    type: 'string',
                    value: this.selection
                }
            })

            if (!valid) {
                throw new Error('Missing requirements to evaluate the response ...')
                return false
            }

            // console.log('evaluating...')
            const events = await this.evaluateWithPresets(res, html, this.selection, condition)
            // console.log('evaluated...')

            if (events.length <= 0) {
                throw new Error(`No changes were returned... Selection:${this.selection}`)
            }

            // __recyclrDebugLog(this, 'rendering...');
            this.render(events)
            // console.log('rendered...')
            // From here we need to:
            // enable all disable targets
            // hide the loading target
            // show all relevant event targets
            // update the history
            if (this.history) {
                const historyUrl = (response && typeof response.url === 'string' && response.url.trim() !== '')
                    ? response.url
                    : this.url;
                history.pushState(null, 'Page Title', historyUrl);
            }

        } catch (err) {
            console.error('An error has occurred while processing this request...')
            console.error(err)
            // From here we need to:
            // enable all disable targets
            // hide the loading target(s)
            // show all relevant event targets
            // show the error target

        } finally {
            if (this.loading) {
                this.handleHideSpinner()
            }
            if (useGlobalLoading) {
                __recyclrEndGlobalLoading()
            }
        }
    }
    handleShowSpinner() {
        __recyclrDebugLog(this, 'showing spinner')
        __recyclrDebugLog(this, this.loading)
        let spinner = document.querySelector(this.loading)
        if (spinner) {
            spinner.style.display = 'block'
        }
    }

    handleHideSpinner() {
        __recyclrDebugLog(this, 'hiding spinner')
        __recyclrDebugLog(this, this.loading)
        let spinner = document.querySelector(this.loading)
        if (spinner) {
            spinner.style.display = 'none'
        }
    }

    render(events) {
        if (!Array.isArray(events) || events.length === 0) {
            return;
        }
        // Parse through the events and swap each target in sequence.
        events.forEach(event => {
            try {
                let { selector, location, selection } = event ?? {}
                if (typeof selector !== 'string' || selector.trim() === '') {
                    __recyclrDebugLog(this, 'render: invalid selector, skipping event', event);
                    return;
                }
                if (typeof location !== 'string' || location.trim() === '') {
                    __recyclrDebugLog(this, 'render: invalid location, skipping event', event);
                    return;
                }
                if (typeof selection !== 'string') {
                    selection = selection == null ? '' : String(selection);
                }

                let target = null;
                try {
                    target = document.querySelector(selector);
                } catch (e) {
                    __recyclrDebugLog(this, 'render: bad target selector', selector, e);
                    return;
                }
                if (target == null) { __recyclrDebugLog(this, 'render: missing target', selector); return; }

                const preserved = (location === 'innerHTML' || location === 'outerHTML')
                    ? __recyclrCaptureScroll(target)
                    : null;

                switch (location) {
                    case 'innerHTML':
                    case 'outerHTML':
                        target[location] = selection
                        break;
                    case 'beforebegin':
                    case 'afterbegin':
                    case 'beforeend':
                    case 'afterend':
                        target.insertAdjacentHTML(location, selection)
                        break;
                    default:
                        __recyclrDebugLog(this, `render: invalid location; dropping event. Location:${location}; Selector:${selector}`)
                        return;
                }

                if (preserved) {
                    __recyclrRestoreScroll(preserved);
                }

                if (this.dispatch && this.validate({
                    identifier: {
                        type: 'string',
                        value: this.identifier
                    }
                }, true)) {
                    this.handleDispatch(this._lastEventName || 'updated', { target: target, bubbles: true })
                }
            } catch (e) {
                __recyclrDebugLog(this, 'render: dropping event after non-fatal error', e, event);
            }
        });

        __recyclrDeduplicateSingletonDom();
    }

    async evaluateWithPresets(res, html, selection, condition) {
        try {
            // Load presets from config or external file once
            if (!this._presetsLoaded) {
                this._presetsLoaded = true;
                this._presetsConfig = this.config?.presets || null;
                if (!this._presetsConfig && this.config?.presetsUrl) {
                    const ttl = (typeof this.config.presetsTTLMs === 'number') ? this.config.presetsTTLMs : 0;
                    const out = await __recyclrLoadPresetsWithCache(this.config.presetsUrl, ttl);
                    this._presetsConfig = out.data;
                }
            }

            // Decide which presets to use
            let names = [];
            const hNames = res?.headers?.get?.('Recyclr-Use-Presets');
            if (hNames) names = hNames.split(/[;,]/).map(s => s.trim()).filter(Boolean);

            // Triggers by redirect / status
            try {
                if (names.length === 0 && this._presetsConfig?.triggers) {
                    const t = this._presetsConfig.triggers;
                    if (res?.redirected && Array.isArray(t.redirect)) names = t.redirect.slice();
                    if (res?.status && t['status:' + res.status]) names = t['status:' + res.status].slice();
                }
            } catch (_) { }

            // If none requested, just do normal path
            if (!this._presetsConfig || names.length === 0) {
                return this.evaluate(html, selection, condition);
            }

            // Gather rules for the chosen names
            const all = this._presetsConfig.presets || {};
            let rules = [];
            names.forEach(n => {
                const spec = all[n];
                if (!spec) return;
                if (Array.isArray(spec)) {
                    spec.forEach(s => rules.push(typeof s === 'string' ? __recyclrParseRule(s) : s));
                } else if (typeof spec === 'string') {
                    rules.push(__recyclrParseRule(spec));
                } else if (typeof spec === 'object') {
                    rules.push(spec);
                }
            });
            rules = rules.filter(Boolean);

            // If still none, fall back
            if (rules.length === 0) {
                if (this._presetsConfig?.fallback && all[this._presetsConfig.fallback]) {
                    const fb = all[this._presetsConfig.fallback];
                    const arr = Array.isArray(fb) ? fb : [fb];
                    arr.forEach(s => rules.push(typeof s === 'string' ? __recyclrParseRule(s) : s));
                } else {
                    // Default safe fallback: body -> body
                    rules.push({ src: 'body', srcLoc: 'innerHTML', dst: 'body', dstLoc: 'innerHTML' });
                }
            }

            const events = __recyclrBuildEventsFromPresetRules.call(this, html, rules);
            if (!Array.isArray(events) || events.length === 0) {
                __recyclrDebugLog(this, 'presets produced no events; falling back to evaluate()');
                return this.evaluate(html, selection, condition);
            }

            // Keep the event name if server provided
            this._lastEventName = res?.headers?.get?.('Recyclr-Event') || 'updated';
            this._lastPresetNames = names;
            return events;
        } catch (e) {
            __recyclrDebugLog(this, 'evaluateWithPresets failed', e);
            return this.evaluate(html, selection, condition);
        }
    }

    parse(s) {
        // "[selectionSelector(@location)]->[targetSelector(@location)] ..."
        let valid = this.validate({
            s: {
                value: s,
                type: 'string'
            }
        })
        if (!valid) throw new Error('Invalid arguments given...')
        let events = s.split(' ').map(event => {

            let conditionTouple = event.split(':')
            let eventString = null
            let condition = null

            switch (conditionTouple.length) {
                case 1:
                    eventString = conditionTouple[0]
                    break;
                case 2:
                    condition = conditionTouple[0]
                    eventString = conditionTouple[1]
                    break;
                default:
                    throw new Error('Invalid event properties...')
            }


            // Parse the event
            const d = eventString.split('->').map(target => {
                let data = target.split('@')
                // Here we check to make sure data[0] does not contain the append/prepend data
                return {
                    selector: data[0],
                    location: data[1] ?? 'outerHTML'
                }
            })
            return {
                condition: condition,
                selection: d[0],
                target: d[1]
            }
        })
        // console.log(events)
        //
        // Add a check here to make sure that the selector for select isn't beforeend or something like that, since that's meaningless and should only be used for the output selector
        //
        return events
    }

    evaluate(html, select, condition = null) {
        // evaluate my parser on response html
        // render / querySelector the html in js, for each event in the parseMap, find the selection from the html, then update our targets in the dom
        // make sure all the javascript events are being added to the content
        let events = this.parse(select)

        if (events != null) {
            events = events.filter(item => {
                return item.condition == condition
            })
        }
        const doc = this.parseHTML(html)
        const selections = []
        events.forEach(event => {

            let { selection, target } = event
            if (target == null || target == undefined) target = selection

            if (target == null) { __recyclrDebugLog(this, 'render: missing target', selection); return; }
            let { selector, location } = selection

            //
            // Determine if location is looking for properties ie: [name, href, data-label]
            //
            /**
            *   If location  has a \[ [\w\W\d]+ \] then we're looking for properties
            *   I could maybe do it with split
            *   split location by [
            *   0 is the location selector
            *   1 is the properties and the end bracket joined by commas with potential spaces
            *   When this is present we have to scrap the normal behavior, and only do the updates
            *   I think we need to just do the swap, and not push it into selections
            *       We are skipping the render method
            *
            *
            */
            // console.log('creating new location... Location:' + location)
            // let L = new Location({ string: location })
            let L = new Location(location)

            // console.log('has properties')
            // console.log(L.properties())
            let properties = Array.from(L.properties() ?? [])
            // console.log(properties)
            if (properties.length) {
                let response = doc.querySelector(selector)
                // Here we need to find the outputs, and load them in, then return early so it's not replaced or put into my selections
                return false;
            }

            target.selection = doc.querySelector(selector)[L.string]
            selections.push(target)
        })

        return selections
    }

    validate(o, silent = false) {
        let valid = true
        let keys = Array.from(Object.keys(o));
        keys.forEach(k => {
            let { type, value, length, instance, options } = o[k]

            if (typeof type !== 'string') {
                (!silent || this.debug) && console.error('Type was not a string...');
                valid = false
                return valid
            }
            if (typeof value !== type) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... expected ${type}...`)
                valid = false
                return valid
            }
            if (instance && !(value instanceof instance)) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... expected instance of ${JSON.stringify(instance)}...`)
                valid = false
                return valid
            }
            if (options && !(options.includes(value))) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... Value: ${JSON.stringify(value)} not in ${JSON.stringify(options)}...`)
                valid = false
                return valid
            }

        });

        return valid;
    }


    parseHTML(resp) {
        const parser = new DOMParser()
        return parser.parseFromString(resp, 'text/html')
    }

    handleDispatch(eventName, params = {}) {
        const fullEventName = `${this.identifier}:${eventName}`;

        const { bubbles, cancelable, composed } = params

        const target = params.target ?? document

        const event = new CustomEvent(fullEventName, {
            detail: { ...params }, bubbles: bubbles ?? true,
            cancelable: cancelable ?? true,
            composed: composed ?? true,
        });

        return target.dispatchEvent(event);

    }
    test() {
        __recyclrDebugLog(this, 'Running GX tests...')
        let tests = {
            validate: () => {
                let valid = this.validate({
                    foo: {
                        type: 'string',
                        value: 'bar'
                    }
                })
                if (!valid) console.error('Could not validate...')

                valid = this.validate({
                    foo: {
                        type: 'number',
                        value: 1
                    }
                })
                if (!valid) console.error('Could not validate...')
            },
            notValidate: () => {
                let valid = this.validate({
                    foo: {
                        type: 'number',
                        value: 'bar'
                    }
                })
                if (valid) console.error('Could validate, but shouldn\'t...')

                valid = this.validate({
                    foo: {
                        type: 'number',
                        value: '1'
                    }
                })
                if (valid) console.error('Could validate, but shouldn\'t...')

                valid = this.validate({
                    foo: {
                        type: 'string',
                        value: 1
                    }
                })
                if (valid) console.error('Could validate, but shouldn\'t...')
            },
            parse: () => {
                // 'selectionSelector@location->targetSelector@location%swap' ?
                // 'selectionSelector@location->targetSelector@location%append' ?
                // Actually, we don't need this
                //
                // 'selectionSelector@location->targetSelector@beforeend' (append)
                // 'selectionSelector@location->targetSelector@afterbegin (append)
                // 'selectionSelector@location->targetSelector@outerHTML (swap)
                // 'selectionSelector@location->targetSelector@innerHTML (swap)
                let events = this.parse('selectionSelector@location->targetSelector@location')
                let valid = events.length > 0
                if (!valid) console.error('Could not validate...')

                __recyclrDebugLog(this, JSON.stringify(events))

                events = this.parse('selectionSelector@location->targetSelector@location selectionSelector@location->targetSelector@location')
                valid = (events.length === 2)
                if (!valid) console.error('Could not validate...')

                events = this.parse('selectionSelector->targetSelector')

                __recyclrDebugLog(this, JSON.stringify(events))

                valid = events.length > 0
                if (!valid) console.error('Could not validate...')
            },
            parseProps: () => {
                let events = this.parse('selectionSelector@[name]->targetSelector@location')
                let valid = events.length > 0
                if (!valid) console.error('Could not validate...')
                __recyclrDebugLog(this, JSON.stringify(events))
                let event = events[0]
                let { selection } = event
                let { location } = selection
                __recyclrDebugLog(this, 'creating new location... Location:' + location)
                __recyclrDebugLog(this, 'this one might be wrong, since it is not being passed an object')
                let L = new Location(location)
                __recyclrDebugLog(this, L.properties())
            },
            parseManyProps: () => {
                let events = this.parse('selectionSelector@[name,width,src,dataSocket]->targetSelector@location')
                let valid = events.length > 0
                if (!valid) console.error('Could not validate...')
                __recyclrDebugLog(this, JSON.stringify(events))
                let event = events[0]
                let { selection } = event
                let { location } = selection
                __recyclrDebugLog(this, 'creating new location... Location:' + location)
                __recyclrDebugLog(this, 'this one might be wrong, since it is not being passed an object')
                let L = new Location(location)
                __recyclrDebugLog(this, L.properties())
            }
        }

        Array.from(Object.keys(tests)).forEach(t => {
            __recyclrDebugLog(this, `Running ${t} test...`)
            tests[t]()
            __recyclrDebugLog(this, `${t} test completed...`)
        })
    }
}

class Location {

    string = ""

    constructor(s) {

        let valid = this.validate({
            s: {
                type: 'string',
                value: s
            }
        })
        if (!valid) throw new Error('Could not validate...')
        // console.log('new location: ')
        // console.log(s)
        this.string = s
    }

    evaluate() {

    }

    properties() {

        let valid = this.validate({
            s: {
                type: 'string',
                value: this.string
            }
        })
        if (!valid) throw new Error('Could not validate this.string...')

        // console.log('properties... splitting this.string')
        // console.log(this.string)
        let location = this.string.split('[')
        if (location[1]) {
            // We are going to have to find the taret and the selection, then grab the properties and update the target from the selection
            let properties = location[1].split(']')
            properties = properties[0]
            properties = properties.split(',')
            return properties
        }
        return [];
    }

    selector() {

        let valid = this.validate({
            s: {
                type: 'string',
                value: this.string
            }
        })
        if (!valid) throw new Error('Could not validate this.string...')
        // console.log('selector... splitting this.string')
        // console.log(this.string)
        return this.string.split('[')[0]
    }

    validate(o, silent = false) {
        let valid = true
        let keys = Array.from(Object.keys(o));
        keys.forEach(k => {
            let { type, value, length, instance, options } = o[k]

            if (typeof type !== 'string') {
                (!silent || this.debug) && console.error('Type was not a string...');
                valid = false
                return valid
            }
            if (typeof value !== type) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... expected ${type}...`)
                valid = false
                return valid
            }
            if (instance && !(value instanceof instance)) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... expected instance of ${JSON.stringify(instance)}...`)
                valid = false
                return valid
            }
            if (options && !(options.includes(value))) {
                (!silent || this.debug) && console.error(`Invalid value for ${k} given... Value: ${JSON.stringify(value)} not in ${JSON.stringify(options)}...`)
                valid = false
                return valid
            }

        });

        return valid;
    }


}

module.exports = GX
module.exports.GX = GX
module.exports.default = GX
module.exports.mount = mountRecyclr
module.exports.createRecyclrStream = createRecyclrStream


// --- recyclr: busy/disable helpers ---
function applyBusyState(root, busy) {
    try {
        let el = root;
        if (!(el instanceof Element)) {
            el = typeof root === 'string' ? document.querySelector(root) : null;
        }
        if (!el) return;
        if (busy) {
            el.setAttribute('aria-busy', 'true');
            el.setAttribute('inert', '');
        } else {
            el.removeAttribute('aria-busy');
            el.removeAttribute('inert');
        }
        const focusables = el.querySelectorAll('button, [role="button"], input, select, textarea, [tabindex]');
        focusables.forEach(node => {
            if (busy) {
                node.setAttribute('data-recyclr-prev-disabled', node.disabled ? '1' : '0');
                node.disabled = true;
                node.setAttribute('aria-disabled', 'true');
            } else {
                const prev = node.getAttribute('data-recyclr-prev-disabled');
                if (prev === '0') {
                    node.disabled = false;
                    node.removeAttribute('aria-disabled');
                }
                node.removeAttribute('data-recyclr-prev-disabled');
            }
        });
    } catch (e) {
        __recyclrDebugLog(this, 'applyBusyState error', e);
    }
}
// --- end busy/disable helpers ---


// ==============================
// Realtime (WebSocket / SSE)
// ==============================

// Attach a helper on GX to consume a realtime message that carries HTML + directives.
GX.prototype.consumeRealtime = async function(message = {}) {
    try {
        const html = message && typeof message.html === 'string' ? message.html : '';
        if (!html) { __recyclrDebugLog(this, 'consumeRealtime: empty html, ignoring'); return; }

        // Build a pseudo-response so evaluateWithPresets can reuse header-based logic
        const headerMap = new Map();
        if (message.presets) {
            const arr = Array.isArray(message.presets) ? message.presets : String(message.presets).split(/[;, ]+/);
            headerMap.set('Recyclr-Use-Presets', arr.filter(Boolean).join(','));
        }
        if (message.eventName) headerMap.set('Recyclr-Event', message.eventName);

        const pseudoRes = {
            status: message.status ?? 200,
            redirected: !!message.redirected,
            headers: { get: (k) => headerMap.get(k) }
        };

        let events = [];

        // If explicit routing rules are provided, prefer those.
        if (Array.isArray(message.rules) && message.rules.length) {
            const selection = message.rules.join(' ');
            events = this.evaluate(html, selection, message.condition ?? null) || [];
        } else {
            // Otherwise, let presets/triggers decide. Fall back to the instance's selection.
            const selection = this.selection || 'body@innerHTML->body@innerHTML';
            events = await this.evaluateWithPresets(pseudoRes, html, selection, message.condition ?? null);
        }

        if (!events || !events.length) {
            __recyclrDebugLog(this, 'consumeRealtime: no events produced');
            return;
        }

        this.render(events);

        if (this.dispatch && this.validate({ identifier: { type: 'string', value: this.identifier } }, true)) {
            const ev = headerMap.get('Recyclr-Event') || 'updated';
            this.handleDispatch(ev, { target: document, bubbles: true });
        }
    } catch (e) {
        __recyclrDebugLog(this, 'consumeRealtime failed', e);
    }
};

// Lightweight, dependency-free realtime connector with WS primary, SSE fallback.
function createRecyclrStream(options = {}) {
    const cfg = Object.assign({
        wsUrl: null,
        sseUrl: null,
        topics: [],                // array of strings
        token: null,               // static token string
        tokenProvider: null,       // async () => token
        heartbeatMs: 25000,
        backoffBaseMs: 500,
        backoffMaxMs: 30000,
        debug: false,
        gx: null,                  // optional GX instance to receive messages
        onMessage: null            // optional custom handler (msg, ctx) => void
    }, options || {});

    let ws = null;
    let es = null;
    let stopped = false;
    let attempt = 0;
    let lastSeenId = null;
    let hbTimer = null;
    let connectedType = null;

    function log(...args) { if (cfg.debug) try { console.log('[recyclr:rt]', ...args); } catch (_) {} }

    function buildQuery() {
        const params = new URLSearchParams();
        if (cfg.topics && cfg.topics.length) params.set('topics', cfg.topics.join(','));
        if (lastSeenId) params.set('last_id', String(lastSeenId));
        return params.toString();
    }

    async function buildToken() {
        try {
            return cfg.token || (cfg.tokenProvider ? await cfg.tokenProvider() : null);
        } catch (_) { return null; }
    }

    function handleMessage(raw, ctx) {
        try {
            let obj = null;
            if (typeof raw === 'string') {
                obj = JSON.parse(raw);
            } else if (raw && typeof raw.data === 'string') {
                obj = JSON.parse(raw.data);
            } else if (typeof raw === 'object') {
                obj = raw;
            }

            if (!obj || typeof obj !== 'object') return;
            if (obj.id != null) lastSeenId = obj.id;
            if (cfg.onMessage) cfg.onMessage(obj, ctx);
            if (cfg.gx && typeof cfg.gx.consumeRealtime === 'function') {
                cfg.gx.consumeRealtime(obj);
            }
        } catch (e) {
            log('message parse error', e);
        }
    }

    function scheduleReconnect() {
        if (stopped) return;
        attempt += 1;
        const delay = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * Math.pow(2, attempt)) * (0.7 + Math.random()*0.6);
        log('reconnecting in', Math.round(delay), 'ms');
        setTimeout(connect, delay);
    }

    function clearHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

    async function connectWS() {
        const t = await buildToken();
        const q = buildQuery();
        const url = new URL(cfg.wsUrl, window.location.href);
        if (q) url.search = q + (t ? `&token=${encodeURIComponent(t)}` : (url.search ? '' : ''));
        else if (t) url.search = `token=${encodeURIComponent(t)}`;

        log('connecting WS', url.toString());
        try {
            ws = new WebSocket(url.toString());
        } catch (e) {
            log('WS ctor failed', e);
            ws = null;
            return false;
        }

        ws.onopen = () => {
            connectedType = 'ws';
            attempt = 0;
            log('WS open');
            clearHeartbeat();
            hbTimer = setInterval(() => {
                try { ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping', ts: Date.now() })); } catch (_) {}
            }, cfg.heartbeatMs);
        };

        ws.onmessage = (ev) => handleMessage(ev, { transport: 'ws' });
        ws.onerror = (ev) => log('WS error', ev);
        ws.onclose = () => {
            log('WS close');
            clearHeartbeat();
            ws = null;
            if (!stopped) scheduleReconnect();
        };
        return true;
    }

    async function connectSSE() {
        if (!cfg.sseUrl) return false;
        const t = await buildToken();
        const q = buildQuery();
        const url = new URL(cfg.sseUrl, window.location.href);
        if (q) url.search = q + (t ? `&token=${encodeURIComponent(t)}` : (url.search ? '' : ''));
        else if (t) url.search = `token=${encodeURIComponent(t)}`;

        log('connecting SSE', url.toString());
        try {
            es = new EventSource(url.toString(), { withCredentials: true });
        } catch (e) {
            log('SSE ctor failed', e);
            es = null;
            return false;
        }
        connectedType = 'sse';
        attempt = 0;

        es.onmessage = (ev) => handleMessage(ev, { transport: 'sse' });
        es.onerror = (ev) => {
            log('SSE error', ev);
            try { es && es.close(); } catch (_) {}
            es = null;
            if (!stopped) scheduleReconnect();
        };
        return true;
    }

    async function connect() {
        if (stopped) return;
        clearHeartbeat();

        // Prefer WS if available
        if (cfg.wsUrl) {
            const ok = await connectWS();
            if (ok && ws) return;
        }
        // Fallback to SSE
        await connectSSE();
    }

    function stop() {
        stopped = true;
        clearHeartbeat();
        try { ws && ws.close(); } catch (_) {}
        try { es && es.close(); } catch (_) {}
        ws = null; es = null;
        connectedType = null;
    }

    // Public API
    return {
        start: () => { stopped = false; attempt = 0; connect(); },
        stop,
        isConnected: () => !!(ws && ws.readyState === 1) || !!es,
        transport: () => connectedType
    };
}

function __recyclrNumberOrNull(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function __recyclrFlagValue(value, fallback) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['on', 'true', '1', 'yes'].includes(normalized)) return true;
    if (['off', 'false', '0', 'no'].includes(normalized)) return false;
    return fallback;
}

function __recyclrClosestWithinScope(node, selector, scope) {
    if (!(node instanceof Element)) return null;
    let el = null;
    try {
        el = node.closest(selector);
    } catch (_) {
        return null;
    }
    if (!el) return null;
    if (scope && typeof scope.contains === 'function' && typeof document !== 'undefined' && scope !== document && !scope.contains(el)) {
        return null;
    }
    return el;
}

function __recyclrCreateGXFromElement(trigger, defaults = {}, eventContext = {}) {
    if (!(trigger instanceof Element)) return null;

    const doc = trigger.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const dataset = trigger.dataset || {};
    const ctx = defaults || {};

    let form = null;
    const formSelector = dataset.gxForm ?? ctx.formSelector ?? null;
    if (typeof formSelector === 'string' && formSelector.trim() && doc) {
        try {
            form = doc.querySelector(formSelector);
        } catch (_) {
            form = null;
        }
    }
    if (!form && trigger.tagName === 'FORM') form = trigger;
    if (!form && typeof trigger.closest === 'function') form = trigger.closest('form');

    const submitter = eventContext.submitter instanceof Element ? eventContext.submitter : null;
    const dataSource = submitter || trigger;
    let data = null;
    if (dataSource && typeof dataSource.name === 'string' && dataSource.name && dataSource.value != null) {
        data = {};
        data[dataSource.name] = dataSource.value;
    }

    const rawMethod = (dataset.gxMethod ?? form?.getAttribute?.('method') ?? trigger.getAttribute?.('method') ?? ctx.method ?? 'get');
    const method = typeof rawMethod === 'string' ? rawMethod.toLowerCase() : rawMethod;
    const url = (dataset.gxUrl ?? trigger.getAttribute?.('href') ?? trigger.getAttribute?.('action') ?? form?.getAttribute?.('action') ?? ctx.url ?? null);
    const selection = (dataset.gxSelect ?? form?.dataset?.gxSelect ?? ctx.selection ?? null);
    const background = __recyclrFlagValue(dataset.gxBackground, ctx.background ?? false);
    const presetsTTLMs = __recyclrNumberOrNull(dataset.gxPresetsTTLMs ?? ctx.presetsTTLMs);

    return new GX({
        history: __recyclrFlagValue(dataset.gxHistory, ctx.history ?? 'on'),
        debug: __recyclrFlagValue(dataset.gxDebug, ctx.debug ?? false),
        dispatch: __recyclrFlagValue(dataset.gxDispatch, ctx.dispatch ?? 'on'),
        method,
        url,
        form,
        selection,
        identifier: dataset.gxIdentifier ?? ctx.identifier ?? 'gx',
        loading: dataset.gxLoading ?? ctx.loading ?? null,
        error: dataset.gxError ?? ctx.error ?? null,
        disable: dataset.gxDisable ?? ctx.disable ?? null,
        background,
        data,
        config: ctx.config ?? null,
        presets: dataset.gxPresets ?? ctx.presets ?? null,
        presetsUrl: dataset.gxPresetsUrl ?? ctx.presetsUrl ?? null,
        presetsTTLMs
    });
}

function mountRecyclr(root = null, options = {}) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || typeof scope.addEventListener !== 'function') {
        return {
            destroy() { },
            root: scope,
            options: options || {}
        };
    }

    const cfg = Object.assign({
        clickSelector: '[recyclr="click"], [data-gx-trigger="click"], a[data-gx-select], button[data-gx-select][type="button"], input[data-gx-select][type="button"]',
        submitSelector: 'form[data-gx-select], form[recyclr="submit"], form[data-gx-trigger="submit"]',
        defaults: {}
    }, options || {});

    function handleClick(event) {
        if (event.defaultPrevented) return;
        const trigger = __recyclrClosestWithinScope(event.target, cfg.clickSelector, scope);
        if (!trigger) return;
        event.preventDefault();
        const gx = __recyclrCreateGXFromElement(trigger, cfg.defaults, { type: 'click', originalEvent: event });
        if (!gx) return;
        return gx.request();
    }

    function handleSubmit(event) {
        if (event.defaultPrevented) return;
        const trigger = __recyclrClosestWithinScope(event.target, cfg.submitSelector, scope);
        if (!trigger) return;
        event.preventDefault();
        const gx = __recyclrCreateGXFromElement(trigger, cfg.defaults, {
            type: 'submit',
            submitter: event.submitter || null,
            originalEvent: event
        });
        if (!gx) return;
        return gx.request();
    }

    scope.addEventListener('click', handleClick, true);
    scope.addEventListener('submit', handleSubmit, true);

    return {
        destroy() {
            scope.removeEventListener('click', handleClick, true);
            scope.removeEventListener('submit', handleSubmit, true);
        },
        root: scope,
        options: cfg
    };
}

},{}],2:[function(require,module,exports){
const Recyclr = require('recyclrjs');

const state = {
  scenarios: [],
  scenariosLoading: false,
  mounted: false,
  labRoot: null,
  refs: null,
  renderer: null,
  game: {
    sessionId: '',
    dt: 1 / 120,
    running: false,
    paused: false,
    requestInFlight: false,
    rafId: 0,
    lastFrameTs: 0,
    accumulator: 0,
    latest: null,
    trailTop: [],
    trailSide: [],
    maxTrail: 900
  },
  input: {
    keys: Object.create(null),
    lockAssist: true
  },
  exporting: false
};

class DualViewRenderer {
  constructor(topCanvas, sideCanvas) {
    this.topCanvas = topCanvas;
    this.sideCanvas = sideCanvas;
    this.topCtx = topCanvas.getContext('2d');
    this.sideCtx = sideCanvas.getContext('2d');
    this.camTop = { x: 0, y: 0 };
    this.camSide = { x: 0, alt: 0 };
    this.resize();
  }

  resize() {
    this.resizeCanvas(this.topCanvas, this.topCtx);
    this.resizeCanvas(this.sideCanvas, this.sideCtx);
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, canvas.clientWidth);
    const h = Math.max(20, canvas.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(sample, trailTop, trailSide) {
    this.drawTop(sample, trailTop);
    this.drawSide(sample, trailSide);
  }

  drawTop(sample, trail) {
    const ctx = this.topCtx;
    const canvas = this.topCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Start session to render top-down view');
      return;
    }

    this.camTop.x = this.lerp(this.camTop.x, sample.position.x, 0.14);
    this.camTop.y = this.lerp(this.camTop.y, sample.position.y, 0.14);

    const topScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camTop.x, point.y - this.camTop.y], 1200);
    this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
      x: (point.x - this.camTop.x) * topScale + w * 0.5,
      y: h * 0.5 - (point.y - this.camTop.y) * topScale
    }), 'rgba(15, 106, 115, 0.45)');

    const craftX = w * 0.5;
    const craftY = h * 0.5;
    this.paintCraft(ctx, craftX, craftY, '#0f6a73');

    const velScale = 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.velocity.y * velScale,
      '#2b4a77'
    );

    const gravScale = 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.y * gravScale,
      '#9b4d1e'
    );

    this.paintLegend(ctx, w, [
      ['craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  drawSide(sample, trail) {
    const ctx = this.sideCtx;
    const canvas = this.sideCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Profile view appears here once running');
      return;
    }

    this.camSide.x = this.lerp(this.camSide.x, sample.position.x, 0.14);
    this.camSide.alt = this.lerp(this.camSide.alt, sample.altitude, 0.12);

    const sideScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - this.camSide.x, point.alt - this.camSide.alt], 800);

    const groundY = h * 0.5 + this.camSide.alt * sideScale;
    ctx.strokeStyle = 'rgba(120, 95, 66, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    this.paintTrail(ctx, trail, sideScale, w, h, (point) => ({
      x: (point.x - this.camSide.x) * sideScale + w * 0.5,
      y: h * 0.5 - (point.alt - this.camSide.alt) * sideScale
    }), 'rgba(88, 125, 47, 0.45)');

    const craftX = w * 0.5;
    const craftY = h * 0.5;
    this.paintCraft(ctx, craftX, craftY, '#587d2f');

    const velScale = 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.vertical_vel * velScale,
      '#2b4a77'
    );

    const gravScale = 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.z * gravScale,
      '#9b4d1e'
    );

    this.paintLegend(ctx, w, [
      ['craft', '#587d2f'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  paintBackdrop(ctx, w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#fffdf7');
    gradient.addColorStop(1, '#f6efe0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  paintGrid(ctx, w, h) {
    ctx.strokeStyle = 'rgba(30, 47, 63, 0.09)';
    ctx.lineWidth = 1;
    const spacing = 48;
    for (let x = 0; x <= w; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  paintMessage(ctx, w, h, text) {
    ctx.fillStyle = 'rgba(31, 42, 55, 0.66)';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, w * 0.5, h * 0.5);
    ctx.textAlign = 'start';
  }

  paintTrail(ctx, trail, scale, w, h, projector, color) {
    if (!trail || trail.length < 2) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 1) {
      const p = projector(trail[i], scale, w, h);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  paintCraft(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  paintArrow(ctx, x0, y0, x1, y1, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }
    const ux = dx / len;
    const uy = dy / len;
    const leftX = x1 - ux * 9 - uy * 4;
    const leftY = y1 - uy * 9 + ux * 4;
    const rightX = x1 - ux * 9 + uy * 4;
    const rightY = y1 - uy * 9 - ux * 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }

  paintLegend(ctx, w, entries) {
    let x = 12;
    const y = 16;
    ctx.font = '11px "IBM Plex Mono", monospace';
    for (const entry of entries) {
      const [label, color] = entry;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 8, 10, 10);
      x += 14;
      ctx.fillStyle = 'rgba(31, 42, 55, 0.78)';
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 16;
      if (x > w - 80) {
        break;
      }
    }
  }

  scaleFromTrail(trail, w, h, project, fallbackRange) {
    if (!trail || trail.length < 2) {
      return Math.min(w, h) / fallbackRange;
    }
    let maxRange = 1;
    for (let i = 0; i < trail.length; i += 1) {
      const [dx, dy] = project(trail[i]);
      maxRange = Math.max(maxRange, Math.abs(dx), Math.abs(dy));
    }
    const padded = Math.max(120, maxRange * 1.25);
    return Math.min(w, h) / (padded * 2);
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}

function ensureRecyclrMount() {
  if (state.mounted) {
    return;
  }
  Recyclr.mount(document, {
    defaults: {
      identifier: 'gx',
      history: 'off',
      dispatch: 'on'
    }
  });
  state.mounted = true;
}

function normalizeScenario(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const nameRaw = item.name ?? item.Name;
  const pathRaw = item.path ?? item.Path;
  const name = typeof nameRaw === 'string' && nameRaw.trim()
    ? nameRaw.trim()
    : (typeof pathRaw === 'string' && pathRaw.trim()
      ? pathRaw.trim().split('/').pop().replace(/\.json$/i, '')
      : '');
  if (!name) {
    return null;
  }

  const dt = Number.parseFloat(item.dt ?? item.Dt);
  const duration = Number.parseFloat(item.duration ?? item.Duration);
  const gravityModelRaw = item.gravity_model ?? item.GravityModel;
  const gravityModel = typeof gravityModelRaw === 'string' && gravityModelRaw.trim()
    ? gravityModelRaw.trim().toLowerCase()
    : 'coupling';

  return {
    name,
    path: typeof pathRaw === 'string' ? pathRaw : '',
    dt: Number.isFinite(dt) ? dt : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    gravityModel
  };
}

async function loadScenarios(options = {}) {
  const force = Boolean(options && options.force);
  if (state.scenariosLoading) {
    return state.scenarios;
  }
  if (!force && state.scenarios.length > 0) {
    return state.scenarios;
  }

  state.scenariosLoading = true;
  try {
    const res = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('failed to load scenarios');
    }
    const payload = await res.json();
    state.scenarios = Array.isArray(payload) ? payload.map(normalizeScenario).filter(Boolean) : [];
  } catch (_) {
    if (!state.scenarios.length) {
      state.scenarios = [];
    }
  } finally {
    state.scenariosLoading = false;
  }
  return state.scenarios;
}

function hydrateScenarioSelect(root) {
  const select = root.querySelector('[data-scenario-select]');
  if (!select) {
    return;
  }

  const preserve = select.value;
  select.innerHTML = '';

  if (!state.scenarios.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = state.scenariosLoading ? 'Loading scenarios...' : 'No scenarios available';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const item of state.scenarios) {
    const opt = document.createElement('option');
    const dtLabel = Number.isFinite(item.dt) && item.dt > 0 ? `${item.dt}` : '?';
    const durationLabel = Number.isFinite(item.duration) && item.duration > 0 ? `${item.duration}` : '?';
    opt.value = item.name;
    opt.textContent = `${item.name} • ${item.gravityModel} • dt=${dtLabel}s • duration=${durationLabel}s`;
    select.appendChild(opt);
  }

  if (preserve && Array.from(select.options).some((opt) => opt.value === preserve)) {
    select.value = preserve;
  } else if (select.options.length > 0) {
    select.value = select.options[0].value;
  }
}

function selectedScenario(root) {
  const selected = root.querySelector('[data-scenario-select]')?.value || '';
  if (selected) {
    return selected;
  }
  if (state.scenarios.length > 0) {
    return state.scenarios[0].name;
  }
  return 'free_fall';
}

function maybeInitLab() {
  const root = document.querySelector('[data-flight-lab-root]');
  if (!root) {
    if (state.labRoot) {
      void stopGameSession(true, 'session closed');
      state.labRoot = null;
      state.refs = null;
      state.renderer = null;
    }
    return;
  }

  if (state.labRoot === root) {
    hydrateScenarioSelect(root);
    if (!state.scenarios.length && !state.scenariosLoading) {
      void loadScenarios({ force: true }).then(() => {
        if (state.labRoot === root) {
          hydrateScenarioSelect(root);
        }
      });
    }
    return;
  }

  state.labRoot = root;
  const stats = Object.create(null);
  root.querySelectorAll('[data-stat]').forEach((node) => {
    const key = node.getAttribute('data-stat');
    if (key) {
      stats[key] = node;
    }
  });

  state.refs = {
    status: root.querySelector('[data-game-status]'),
    scenario: root.querySelector('[data-scenario-select]'),
    speed: root.querySelector('[data-game-speed]'),
    pauseButton: root.querySelector('[data-game-pause]'),
    stats,
    canvasTop: root.querySelector('[data-game-canvas-top]'),
    canvasSide: root.querySelector('[data-game-canvas-side]')
  };

  state.renderer = new DualViewRenderer(state.refs.canvasTop, state.refs.canvasSide);
  state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);

  window.addEventListener('resize', () => {
    if (state.renderer) {
      state.renderer.resize();
    }
  }, { once: true });

  hydrateScenarioSelect(root);
  if (!state.scenarios.length && !state.scenariosLoading) {
    void loadScenarios({ force: true }).then(() => {
      if (state.labRoot === root) {
        hydrateScenarioSelect(root);
      }
    });
  }
  setStatus('ready');
  updateHUD(state.game.latest);
}

function setStatus(message) {
  if (!state.refs?.status) {
    return;
  }
  state.refs.status.textContent = message;
}

function formatNumber(value, digits = 3, suffix = '') {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function setStat(key, value) {
  const node = state.refs?.stats?.[key];
  if (!node) {
    return;
  }
  node.textContent = value;
}

function updateHUD(sample) {
  if (!state.refs || !state.refs.stats) {
    return;
  }
  if (!sample) {
    for (const key of Object.keys(state.refs.stats)) {
      setStat(key, '-');
    }
    return;
  }

  setStat('time', `${formatNumber(sample.time, 2)} s`);
  setStat('step', `${sample.step}`);
  setStat('altitude', `${formatNumber(sample.altitude, 1)} m`);
  setStat('speed', `${formatNumber(sample.speed, 2)} m/s`);
  setStat('vertical', `${formatNumber(sample.vertical_vel, 2)} m/s`);
  setStat('model', sample.gravity_model || '-');

  setStat('c', formatNumber(sample.coupling_c, 4));
  setStat('k', formatNumber(sample.coupling_k, 4));
  setStat('phi', formatNumber(sample.coupling_phi, 4));
  setStat('phase', formatNumber(sample.phase_error, 4));
  setStat('lock', `${formatNumber(sample.lock_quality, 4)} (${sample.lock_flag ? 'lock' : 'open'})`);
  setStat('runaway', sample.runaway_flag ? 'flagged' : 'clear');

  setStat('power', `${formatNumber(sample.drive_power, 0)} W`);
  setStat('energy', `${formatNumber(sample.energy, 0)} W*s`);
  setStat('amp_target', formatNumber(sample.control_amp_target, 3));
  setStat('theta_target', formatNumber(sample.control_theta_target, 3));
  setStat('axis_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('lock_assist', sample.control_lock_assist ? 'on' : 'off');
}

function pushTrail(sample) {
  if (!sample || !sample.position) {
    return;
  }
  state.game.trailTop.push({
    x: sample.position.x,
    y: sample.position.y
  });
  state.game.trailSide.push({
    x: sample.position.x,
    alt: sample.altitude
  });

  while (state.game.trailTop.length > state.game.maxTrail) {
    state.game.trailTop.shift();
  }
  while (state.game.trailSide.length > state.game.maxTrail) {
    state.game.trailSide.shift();
  }
}

function clearTrails() {
  state.game.trailTop = [];
  state.game.trailSide = [];
}

async function apiPost(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const message = (await res.text()).trim();
    throw new Error(message || `request failed (${res.status})`);
  }
  return res.json();
}

function parseDownloadFilename(disposition, fallback) {
  if (!disposition) {
    return fallback;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (_) {
      return fallback;
    }
  }

  const quotedMatch = disposition.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  const bareMatch = disposition.match(/filename=([^;]+)/i);
  if (bareMatch && bareMatch[1]) {
    return bareMatch[1].trim();
  }

  return fallback;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportScenario(format = 'zip') {
  maybeInitLab();
  const root = state.labRoot;
  if (!root || state.exporting) {
    return;
  }

  if (!state.scenarios.length) {
    setStatus('loading scenarios...');
    await loadScenarios({ force: true });
    hydrateScenarioSelect(root);
  }

  const scenario = selectedScenario(root);
  const formatKey = String(format || 'zip').toLowerCase();
  const ext = formatKey === 'csv' ? 'csv' : formatKey === 'meta' ? 'meta.json' : 'zip';
  const fallbackName = `${scenario}-export.${ext}`;

  state.exporting = true;
  setStatus(`exporting ${scenario} (${formatKey})...`);
  try {
    const url = `/api/sim/export?scenario=${encodeURIComponent(scenario)}&format=${encodeURIComponent(formatKey)}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      const message = (await res.text()).trim();
      throw new Error(message || 'export failed');
    }

    const blob = await res.blob();
    const filename = parseDownloadFilename(res.headers.get('content-disposition'), fallbackName);
    triggerDownload(blob, filename);
    setStatus(`export ready • ${filename}`);
  } catch (err) {
    setStatus(`export failed: ${err.message || 'unknown error'}`);
  } finally {
    state.exporting = false;
  }
}

function simSpeedMultiplier() {
  const raw = Number.parseFloat(state.refs?.speed?.value || '1');
  if (!Number.isFinite(raw)) {
    return 1;
  }
  return Math.max(0.25, Math.min(8, raw));
}

async function startGameSession() {
  maybeInitLab();
  const root = state.labRoot;
  if (!root) {
    return;
  }

  if (!state.scenarios.length) {
    setStatus('loading scenarios...');
    await loadScenarios({ force: true });
    hydrateScenarioSelect(root);
  }

  await stopGameSession(true);

  const scenario = selectedScenario(root);
  setStatus(`starting ${scenario}...`);

  try {
    const payload = await apiPost('/api/game/start', { scenario });
    state.game.sessionId = payload.session_id || '';
    state.game.dt = Number.parseFloat(payload.dt) || Number.parseFloat(payload?.state?.dt) || (1 / 120);
    state.game.running = true;
    state.game.paused = false;
    state.game.requestInFlight = false;
    state.game.lastFrameTs = 0;
    state.game.accumulator = 0;
    state.game.latest = payload.state || null;
    clearTrails();
    pushTrail(state.game.latest);
    state.input.lockAssist = Boolean(state.game.latest?.control_lock_assist);
    if (state.refs?.pauseButton) {
      state.refs.pauseButton.textContent = 'Pause';
    }
    updateHUD(state.game.latest);
    if (state.renderer) {
      state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);
    }
    setStatus(`running ${scenario} • dt=${state.game.dt.toFixed(4)} s`);
    if (!state.game.rafId) {
      state.game.rafId = window.requestAnimationFrame(gameLoop);
    }
  } catch (err) {
    setStatus(`start failed: ${err.message || 'unknown error'}`);
  }
}

async function stopGameSession(sendStop = true, finalStatus = 'stopped') {
  const oldSession = state.game.sessionId;
  if (sendStop && oldSession) {
    try {
      await apiPost('/api/game/stop', { session_id: oldSession });
    } catch (_) {
      // best-effort close
    }
  }

  state.game.sessionId = '';
  state.game.running = false;
  state.game.paused = false;
  state.game.requestInFlight = false;
  state.game.lastFrameTs = 0;
  state.game.accumulator = 0;
  if (state.game.rafId) {
    window.cancelAnimationFrame(state.game.rafId);
    state.game.rafId = 0;
  }
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = 'Pause';
  }
  if (finalStatus) {
    setStatus(finalStatus);
  }
}

function togglePause() {
  if (!state.game.running) {
    return;
  }
  state.game.paused = !state.game.paused;
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = state.game.paused ? 'Resume' : 'Pause';
  }
  setStatus(state.game.paused ? 'paused' : 'running');
}

async function resetGameSession() {
  if (!state.labRoot) {
    return;
  }
  await startGameSession();
}

function currentControlPayload() {
  const keys = state.input.keys;
  const ampAxis = (keys.d ? 1 : 0) + (keys.a ? -1 : 0);
  const phiAxis = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const yawAxis = (keys.e ? 1 : 0) + (keys.q ? -1 : 0);
  return {
    amp_axis: ampAxis,
    phi_axis: phiAxis,
    yaw_axis: yawAxis,
    lock_assist: state.input.lockAssist
  };
}

async function requestStep(steps) {
  if (!state.game.running || state.game.requestInFlight || !state.game.sessionId) {
    return;
  }

  state.game.requestInFlight = true;
  try {
    const payload = await apiPost('/api/game/step', {
      session_id: state.game.sessionId,
      steps,
      controls: currentControlPayload()
    });
    const sample = payload?.state || null;
    if (!sample) {
      throw new Error('empty step response');
    }
    state.game.latest = sample;
    pushTrail(sample);
    updateHUD(sample);
    setStatus(`running • t=${formatNumber(sample.time, 2)}s • C=${formatNumber(sample.coupling_c, 3)}`);
  } catch (err) {
    setStatus(`session error: ${err.message || 'step failed'}`);
    await stopGameSession(false, 'session closed');
  } finally {
    state.game.requestInFlight = false;
  }
}

function gameLoop(ts) {
  state.game.rafId = 0;
  if (!state.game.running) {
    return;
  }

  if (!state.game.lastFrameTs) {
    state.game.lastFrameTs = ts;
  }

  const wallDt = Math.min(0.1, Math.max(0, (ts - state.game.lastFrameTs) / 1000));
  state.game.lastFrameTs = ts;

  if (!state.game.paused) {
    state.game.accumulator += wallDt * simSpeedMultiplier();
    state.game.accumulator = Math.min(state.game.accumulator, state.game.dt * 240);
    const stepsReady = Math.floor(state.game.accumulator / state.game.dt);
    if (stepsReady > 0 && !state.game.requestInFlight) {
      const steps = Math.min(stepsReady, 12);
      state.game.accumulator -= steps * state.game.dt;
      void requestStep(steps);
    }
  }

  if (state.renderer) {
    state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide);
  }
  state.game.rafId = window.requestAnimationFrame(gameLoop);
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-game-start]')) {
      event.preventDefault();
      void startGameSession();
      return;
    }

    if (event.target.closest('[data-game-pause]')) {
      event.preventDefault();
      togglePause();
      return;
    }

    if (event.target.closest('[data-game-reset]')) {
      event.preventDefault();
      void resetGameSession();
      return;
    }

    if (event.target.closest('[data-game-stop]')) {
      event.preventDefault();
      void stopGameSession(true, 'stopped');
      return;
    }

    const exportButton = event.target.closest('[data-export-sim]');
    if (exportButton) {
      event.preventDefault();
      const format = exportButton.getAttribute('data-export-format') || 'zip';
      void exportScenario(format);
      return;
    }

    if (event.target.closest('[data-paper-link]')) {
      window.setTimeout(() => {
        maybeInitLab();
      }, 50);
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }
    const key = (event.key || '').toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        state.input.lockAssist = !state.input.lockAssist;
      }
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      if (!event.repeat) {
        void resetGameSession();
      }
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      if (!event.repeat) {
        togglePause();
      }
      return;
    }
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      event.preventDefault();
      state.input.keys[key] = true;
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = (event.key || '').toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      event.preventDefault();
      state.input.keys[key] = false;
    }
  }, true);

  document.addEventListener('gx:updated', () => {
    window.setTimeout(() => {
      maybeInitLab();
    }, 0);
  });

  window.addEventListener('beforeunload', () => {
    if (state.game.sessionId && typeof navigator.sendBeacon === 'function') {
      const body = JSON.stringify({ session_id: state.game.sessionId });
      navigator.sendBeacon('/api/game/stop', body);
    }
  });
}

async function boot() {
  ensureRecyclrMount();
  setupEvents();
  await loadScenarios();
  maybeInitLab();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  void boot();
}

},{"recyclrjs":1}]},{},[2]);
