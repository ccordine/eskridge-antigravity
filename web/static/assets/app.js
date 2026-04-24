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
  stream: null,
  charts: null,
  labRoot: null,
  refs: null,
  mounted: false,
  streamVersion: 0
};

class LineChart {
  constructor(canvas, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.points = [];
    this.maxPoints = 2400;
    this.resize();
  }

  reset() {
    this.points = [];
  }

  push(t, v) {
    this.points.push({ t, v });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, this.canvas.clientWidth);
    const h = Math.max(20, this.canvas.clientHeight);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(31, 42, 55, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i += 1) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (this.points.length < 2) {
      return;
    }

    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of this.points) {
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }

    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      return;
    }

    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }

    const tStart = this.points[0].t;
    const tEnd = this.points[this.points.length - 1].t;
    const tRange = Math.max(1e-9, tEnd - tStart);

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i += 1) {
      const p = this.points[i];
      const x = ((p.t - tStart) / tRange) * w;
      const y = h - ((p.v - minV) / (maxV - minV)) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(31, 42, 55, 0.68)';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(maxV.toFixed(2), 8, 13);
    ctx.fillText(minV.toFixed(2), 8, h - 6);
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

async function loadScenarios() {
  try {
    const res = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('failed to load scenarios');
    }
    const payload = await res.json();
    state.scenarios = Array.isArray(payload) ? payload : [];
  } catch (_) {
    state.scenarios = [];
  }
}

function hydrateScenarioSelect(root) {
  const selects = root.querySelectorAll('[data-scenario-select]');
  if (!selects.length) {
    return;
  }

  const scenarios = state.scenarios;
  for (const sel of selects) {
    const preserve = sel.value;
    sel.innerHTML = '';

    if (!scenarios.length) {
      const opt = document.createElement('option');
      opt.value = 'free_fall';
      opt.textContent = 'free_fall';
      sel.appendChild(opt);
      continue;
    }

    scenarios.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `${item.name} • dt=${item.dt}s • duration=${item.duration}s`;
      sel.appendChild(opt);
    });

    if (preserve) {
      sel.value = preserve;
    }
  }
}

function fmt(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function setStatus(message) {
  if (!state.refs || !state.refs.status) {
    return;
  }
  state.refs.status.textContent = message;
}

function stopStream(reason) {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (reason) {
    setStatus(reason);
  }
}

function resetCharts() {
  if (!state.charts) {
    return;
  }
  Object.values(state.charts).forEach((chart) => chart.reset());
}

function maybeInitLab() {
  const root = document.querySelector('[data-lab-root]');
  if (!root) {
    if (state.labRoot) {
      stopStream('stream idle');
      state.labRoot = null;
      state.refs = null;
      state.charts = null;
    }
    return;
  }

  if (state.labRoot === root) {
    hydrateScenarioSelect(root);
    return;
  }

  state.labRoot = root;
  state.refs = {
    status: root.querySelector('[data-stream-status]'),
    statTime: root.querySelector('[data-stat="time"]'),
    statAlt: root.querySelector('[data-stat="altitude"]'),
    statVz: root.querySelector('[data-stat="vertical"]'),
    statC: root.querySelector('[data-stat="c"]'),
    statLock: root.querySelector('[data-stat="lock"]'),
    statEnergy: root.querySelector('[data-stat="energy"]')
  };

  state.charts = {
    altitude: new LineChart(root.querySelector('[data-chart="altitude"]'), '#0f6a73'),
    velocity: new LineChart(root.querySelector('[data-chart="vertical"]'), '#9b4d1e'),
    coupling: new LineChart(root.querySelector('[data-chart="c"]'), '#2b4a77'),
    lock: new LineChart(root.querySelector('[data-chart="lock"]'), '#587d2f'),
    power: new LineChart(root.querySelector('[data-chart="power"]'), '#7a3555'),
    energy: new LineChart(root.querySelector('[data-chart="energy"]'), '#374151')
  };

  window.addEventListener('resize', () => {
    if (!state.charts) {
      return;
    }
    Object.values(state.charts).forEach((chart) => chart.resize());
  }, { once: true });

  hydrateScenarioSelect(root);
  setStatus('ready');
}

function applySample(sample) {
  if (!state.charts || !state.refs) {
    return;
  }

  state.charts.altitude.push(sample.time, sample.altitude);
  state.charts.velocity.push(sample.time, sample.vertical_vel);
  state.charts.coupling.push(sample.time, sample.coupling_c);
  state.charts.lock.push(sample.time, sample.lock_quality);
  state.charts.power.push(sample.time, sample.drive_power);
  state.charts.energy.push(sample.time, sample.energy);

  state.refs.statTime.textContent = `${fmt(sample.time, 2)} s`;
  state.refs.statAlt.textContent = `${fmt(sample.altitude, 1)} m`;
  state.refs.statVz.textContent = `${fmt(sample.vertical_vel, 2)} m/s`;
  state.refs.statC.textContent = fmt(sample.coupling_c, 4);
  state.refs.statLock.textContent = fmt(sample.lock_quality, 4);
  state.refs.statEnergy.textContent = `${fmt(sample.energy, 0)} W*s`;
}

function startStream() {
  maybeInitLab();
  const root = state.labRoot;
  if (!root) {
    return;
  }

  const scenario = root.querySelector('[data-scenario-select]')?.value || 'free_fall';
  const speedRaw = root.querySelector('[data-stream-speed]')?.value || '1';
  const speed = Number.parseFloat(speedRaw);
  const playback = Number.isFinite(speed) ? speed : 1;

  stopStream('starting stream...');
  resetCharts();

  state.streamVersion += 1;
  const version = state.streamVersion;

  const url = `/api/sim/stream?scenario=${encodeURIComponent(scenario)}&speed=${encodeURIComponent(playback)}`;
  const es = new EventSource(url);
  state.stream = es;

  es.onmessage = (evt) => {
    if (version !== state.streamVersion) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(evt.data);
    } catch (_) {
      return;
    }

    if (payload.type === 'start') {
      setStatus(`running ${payload.scenario} at ${fmt(payload.playback_speed, 2)}x`);
      return;
    }

    if (payload.type === 'sample') {
      applySample(payload);
      return;
    }

    if (payload.type === 'done') {
      if (payload.error) {
        setStatus(`error: ${payload.error}`);
      } else {
        setStatus(`done • ${payload.sample_count} samples`);
      }
      stopStream();
    }
  };

  es.onerror = () => {
    if (version !== state.streamVersion) {
      return;
    }
    setStatus('stream interrupted');
  };
}

function drawCharts() {
  if (state.charts) {
    Object.values(state.charts).forEach((chart) => chart.draw());
  }
  window.requestAnimationFrame(drawCharts);
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    const runButton = event.target.closest('[data-run-sim]');
    if (runButton) {
      event.preventDefault();
      startStream();
      return;
    }

    if (event.target.closest('[data-stop-sim]')) {
      event.preventDefault();
      stopStream('stopped');
      return;
    }

    if (event.target.closest('[data-paper-link]')) {
      window.setTimeout(() => {
        maybeInitLab();
      }, 50);
    }
  }, true);

  document.addEventListener('gx:updated', () => {
    window.setTimeout(() => {
      maybeInitLab();
    }, 0);
  });

  window.addEventListener('beforeunload', () => {
    stopStream();
  });
}

async function boot() {
  ensureRecyclrMount();
  setupEvents();
  await loadScenarios();
  hydrateScenarioSelect(document);
  maybeInitLab();
  drawCharts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

},{"recyclrjs":1}]},{},[2]);
