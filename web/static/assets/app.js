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

const TWO_PI = Math.PI * 2;
const CRAFT_SCALE_MIN = 1.0;
const CRAFT_SCALE_MAX = 6.0;
const CRAFT_LAZAR_SPAN_M = 15.8;
const METERS_TO_FEET = 3.280839895;
const OSC_OMEGA_MIN = 40;
const OSC_OMEGA_MAX = 160;
const OSC_Q_MIN = 5;
const OSC_Q_MAX = 240;
const OSC_BETA_MIN = 0.2;
const OSC_BETA_MAX = 4.0;
const PLASMA_MIN = 0.0;
const PLASMA_MAX = 1.0;

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
    initialEnergy: NaN,
    trailTop: [],
    trailSide: [],
    trail3D: [],
    maxTrail: 900,
    mapMode: 'planetary',
    speedometerScale: 400
  },
  input: {
    keys: Object.create(null),
    lockAssist: true,
    activeInput: 'none',
    lastEffect: 'none',
    lastNudge: 'none',
    lastControl: {
      mode: 'manual',
      manualAmp: 0,
      manualPhi: 0,
      manualYaw: 0,
      manualPitch: 0,
      autoAmp: 0,
      autoPhi: 0,
      autoYaw: 0,
      autoPitch: 0,
      finalAmp: 0,
      finalPhi: 0,
      finalYaw: 0,
      finalPitch: 0
    }
  },
  exporting: false
};

class DualViewRenderer {
  constructor(topCanvas, sideCanvas, worldCanvas) {
    this.topCanvas = topCanvas;
    this.sideCanvas = sideCanvas;
    this.worldCanvas = worldCanvas;
    this.topCtx = topCanvas.getContext('2d');
    this.sideCtx = sideCanvas.getContext('2d');
    this.worldCtx = worldCanvas ? worldCanvas.getContext('2d') : null;
    this.camTop = { x: 0, y: 0 };
    this.camSide = { x: 0, alt: 0 };
    this.planetaryZoom = 2;
    this.planetaryFollow = 'follow';
    this.resize();
  }

  resize() {
    this.resizeCanvas(this.topCanvas, this.topCtx);
    this.resizeCanvas(this.sideCanvas, this.sideCtx);
    if (this.worldCanvas && this.worldCtx) {
      this.resizeCanvas(this.worldCanvas, this.worldCtx);
    }
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, canvas.clientWidth);
    const h = Math.max(20, canvas.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setPlanetaryCamera(zoom, followMode) {
    if (Number.isFinite(zoom)) {
      this.planetaryZoom = Math.max(0.25, Math.min(25, zoom));
    }
    if (followMode === 'global' || followMode === 'follow') {
      this.planetaryFollow = followMode;
    }
  }

  planetaryViewSettings() {
    const zoom = Number.isFinite(this.planetaryZoom) ? this.planetaryZoom : 1;
    const follow = this.planetaryFollow === 'follow';
    return { zoom, follow };
  }

  planetAtmosphereSpec(name, radius, shellHeightOverride = null) {
    const key = String(name || '').toLowerCase();
    if (!Number.isFinite(radius) || radius <= 0) {
      return null;
    }
    const shellHeight = Number.isFinite(shellHeightOverride) && shellHeightOverride > 0
      ? shellHeightOverride
      : null;
    switch (key) {
      case 'earth':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 100_000,
          minPx: 1.5,
          glowInner: 'rgba(118, 214, 255, 0.24)',
          glowOuter: 'rgba(118, 214, 255, 0.02)',
          line: 'rgba(156, 229, 255, 0.68)',
          fillTop: 'rgba(155, 227, 255, 0.16)',
          fillBottom: 'rgba(88, 168, 212, 0.04)',
          legend: '#8cdcff'
        };
      case 'moon':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 20_000,
          minPx: 1.1,
          glowInner: 'rgba(232, 241, 255, 0.12)',
          glowOuter: 'rgba(232, 241, 255, 0.01)',
          line: 'rgba(234, 239, 250, 0.34)',
          fillTop: 'rgba(244, 247, 255, 0.06)',
          fillBottom: 'rgba(220, 231, 245, 0.01)',
          legend: '#dfe8f6'
        };
      case 'mars':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 80_000,
          minPx: 1.4,
          glowInner: 'rgba(255, 184, 134, 0.18)',
          glowOuter: 'rgba(255, 184, 134, 0.02)',
          line: 'rgba(255, 194, 148, 0.58)',
          fillTop: 'rgba(255, 198, 158, 0.12)',
          fillBottom: 'rgba(194, 104, 72, 0.03)',
          legend: '#f6b38a'
        };
      case 'venus':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 160_000,
          minPx: 1.7,
          glowInner: 'rgba(255, 230, 172, 0.2)',
          glowOuter: 'rgba(255, 230, 172, 0.03)',
          line: 'rgba(255, 233, 184, 0.62)',
          fillTop: 'rgba(255, 240, 196, 0.14)',
          fillBottom: 'rgba(214, 170, 104, 0.04)',
          legend: '#f5ddb2'
        };
      case 'jupiter':
        return {
          bodyRadius: radius,
          shellHeight: shellHeight || 220_000,
          minPx: 1.2,
          glowInner: 'rgba(255, 214, 173, 0.14)',
          glowOuter: 'rgba(255, 214, 173, 0.02)',
          line: 'rgba(255, 221, 188, 0.46)',
          fillTop: 'rgba(255, 231, 208, 0.10)',
          fillBottom: 'rgba(204, 150, 107, 0.03)',
          legend: '#efc8a6'
        };
      default:
        return null;
    }
  }

  sampleAtmosphereSpec(sample) {
    if (!sample || !sample.atmosphere_enabled) {
      return null;
    }
    const radius = Number.parseFloat(sample.primary_radius);
    const scaleHeight = Number.parseFloat(sample.atmosphere_scale_height);
    const shellHeight = Number.isFinite(scaleHeight) && scaleHeight > 0
      ? Math.max(20_000, Math.min(radius * 0.06, scaleHeight * 10))
      : null;
    return this.planetAtmosphereSpec(sample.primary_name, radius, shellHeight);
  }

  atmosphereThicknessPx(screenRadius, atmosphere) {
    if (!atmosphere || !Number.isFinite(screenRadius) || screenRadius <= 0) {
      return 0;
    }
    const physical = screenRadius * (atmosphere.shellHeight / Math.max(atmosphere.bodyRadius, 1));
    return Math.max(atmosphere.minPx || 1.2, physical);
  }

  planetaryFollowScale(w, h, baseRange, zoom) {
    if (!Number.isFinite(baseRange) || baseRange <= 0) {
      return Math.min(w, h) / 1000;
    }
    const z = Number.isFinite(zoom) ? zoom : 1;
    return (Math.min(w, h) / (baseRange * 2)) * z;
  }

  planetaryFollowRange(sample, radius, minimumRange = 4000) {
    if (!sample || !Number.isFinite(radius) || radius <= 0) {
      return 50000;
    }
    const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
      ? (sample.position.x - sample.primary_position.x)
      : 0;
    const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
      ? (sample.position.y - sample.primary_position.y)
      : 0;
    const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
      ? (sample.position.z - sample.primary_position.z)
      : 0;
    const relNorm = Math.hypot(rx, ry, rz);
    const altitude = relNorm > radius ? (relNorm - radius) : 0;
    const floorRange = Math.max(minimumRange, radius * 0.001);
    const dynamicRange = (altitude * 6) + floorRange;
    return Math.max(floorRange, Math.min(250000, dynamicRange));
  }

  planetaryProfileScale(w, h, radius, craftDistance, zoom, localScale) {
    const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
    const d = Number.isFinite(craftDistance) && craftDistance > 0 ? craftDistance : r;
    const z = Number.isFinite(zoom) ? zoom : 1;
    const alt = Math.max(0, d - r);
    const nearScale = Number.isFinite(localScale) && localScale > 0
      ? localScale
      : this.planetaryFollowScale(w, h, 50000, z);
    const farScale = ((h * 0.44) / Math.max(d + r, 1)) * z;
    const blend = Math.max(0, Math.min(1, alt / Math.max(r * 2.5, 1)));
    let scale = (nearScale * (1 - blend)) + (farScale * blend);

    // Keep the planet surface line visible while ship remains centered.
    if (alt > 1) {
      const surfaceVisibleMax = (h * 0.47) / alt;
      if (Number.isFinite(surfaceVisibleMax) && surfaceVisibleMax > 0) {
        scale = Math.min(scale, surfaceVisibleMax);
      }
    }
    return Math.max(scale, Math.min(w, h) / (r * 6000));
  }

  planetaryShouldDrawBodyCircle(screenRadius, w, h, follow) {
    if (!Number.isFinite(screenRadius) || screenRadius <= 0.1) {
      return false;
    }
    if (!follow) {
      return true;
    }
    // In follow mode the apparent planet radius can be huge; skip full-disk fill for performance.
    return screenRadius < (Math.max(w, h) * 5);
  }

  planetaryCameraAnchor2D(vx, vy, follow) {
    if (!follow) {
      return { x: 0, y: 0 };
    }
    return { x: vx, y: vy };
  }

  planetaryFrameFromSample(sample) {
    const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
      ? (sample.position.x - sample.primary_position.x)
      : 0;
    const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
      ? (sample.position.y - sample.primary_position.y)
      : 0;
    const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
      ? (sample.position.z - sample.primary_position.z)
      : 0;
    const rel = { x: rx, y: ry, z: rz };
    const up = this.safeDirection(rel, { x: 0, y: 0, z: 1 });
    let tangent = this.cross3({ x: 0, y: 0, z: 1 }, up);
    if (this.norm3(tangent) <= 1e-6) {
      tangent = this.cross3({ x: 0, y: 1, z: 0 }, up);
    }
    tangent = this.safeDirection(tangent, { x: 1, y: 0, z: 0 });
    return { rel, up, tangent };
  }

  sampleLocalUp(sample) {
    const ux = Number.isFinite(sample?.local_up_x) ? sample.local_up_x : NaN;
    const uy = Number.isFinite(sample?.local_up_y) ? sample.local_up_y : NaN;
    const uz = Number.isFinite(sample?.local_up_z) ? sample.local_up_z : NaN;
    if (Number.isFinite(ux) && Number.isFinite(uy) && Number.isFinite(uz)) {
      return this.safeDirection({ x: ux, y: uy, z: uz }, { x: 0, y: 0, z: 1 });
    }
    return null;
  }

  projectToTangentPlane(v, frame) {
    return {
      x: this.dot3(v, frame.tangent),
      y: this.dot3(v, this.cross3(frame.up, frame.tangent))
    };
  }

  projectToSidePlane(v, frame, forward) {
    return {
      x: this.dot3(v, forward),
      y: this.dot3(v, frame.up)
    };
  }

  craftWarpVector(sample) {
    if (!sample) {
      return null;
    }
    const wx = Number.isFinite(sample.control_warp_x) ? sample.control_warp_x : NaN;
    const wy = Number.isFinite(sample.control_warp_y) ? sample.control_warp_y : NaN;
    const wz = Number.isFinite(sample.control_warp_z) ? sample.control_warp_z : NaN;
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
      return null;
    }
    const n = Math.hypot(wx, wy, wz);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    return { x: wx / n, y: wy / n, z: wz / n };
  }

  craftLocalUp(sample, mode) {
    if (mode === 'planetary' && sample) {
      return this.sampleLocalUp(sample) || this.planetaryFrameFromSample(sample).up;
    }
    return { x: 0, y: 0, z: 1 };
  }

  localFrameFromSample(sample, mode) {
    const up = this.craftLocalUp(sample, mode);
    let forwardRef = { x: 1, y: 0, z: 0 };
    let forward = this.sub3(forwardRef, this.scale3(up, this.dot3(forwardRef, up)));
    if (this.norm3(forward) <= 1e-6) {
      forwardRef = { x: 0, y: 1, z: 0 };
      forward = this.sub3(forwardRef, this.scale3(up, this.dot3(forwardRef, up)));
    }
    forward = this.safeDirection(forward, { x: 1, y: 0, z: 0 });
    const right = this.safeDirection(this.cross3(up, forward), { x: 0, y: 1, z: 0 });
    return { up, forward, right };
  }

  sampleOrientation(sample) {
    const w = Number.parseFloat(sample?.orientation_w);
    const x = Number.parseFloat(sample?.orientation_x);
    const y = Number.parseFloat(sample?.orientation_y);
    const z = Number.parseFloat(sample?.orientation_z);
    if (!Number.isFinite(w) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    const n = Math.hypot(w, x, y, z);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    return { w: w / n, x: x / n, y: y / n, z: z / n };
  }

  quatMul(a, b) {
    return {
      w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
      x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
      y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
      z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w)
    };
  }

  quatConj(q) {
    return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
  }

  quatRotate(q, v) {
    const p = { w: 0, x: v.x, y: v.y, z: v.z };
    const r = this.quatMul(this.quatMul(q, p), this.quatConj(q));
    return { x: r.x, y: r.y, z: r.z };
  }

  sampleBodyAxes(sample) {
    const q = this.sampleOrientation(sample);
    if (!q) {
      return null;
    }
    return {
      forward: this.safeDirection(this.quatRotate(q, { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 }),
      right: this.safeDirection(this.quatRotate(q, { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 }),
      up: this.safeDirection(this.quatRotate(q, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 1 })
    };
  }

  warpTiltVector(sample, localUp) {
    const warpVec = this.craftWarpVector(sample);
    if (!warpVec) {
      return null;
    }
    const up = this.safeDirection(localUp || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    const vertical = this.dot3(warpVec, up);
    const tilt = this.sub3(warpVec, this.scale3(up, vertical));
    return {
      warp: warpVec,
      up,
      vertical,
      tilt,
      tiltMag: this.norm3(tilt)
    };
  }

  topAttitudeFromWarpTilt(sample, mode) {
    const tilt = this.warpTiltVector(sample, this.craftLocalUp(sample, mode));
    if (!tilt || !Number.isFinite(tilt.tiltMag) || tilt.tiltMag <= 1e-6) {
      return null;
    }
    return this.normalizeAttitude2D(tilt.tilt.x, tilt.tilt.y, tilt.tiltMag);
  }

  sideAttitudeFromWarpTilt(sample, mode) {
    const tilt = this.warpTiltVector(sample, this.craftLocalUp(sample, mode));
    if (!tilt) {
      return null;
    }

    let sideForward = this.sub3({ x: 1, y: 0, z: 0 }, this.scale3(tilt.up, tilt.up.x));
    if (this.norm3(sideForward) <= 1e-6) {
      sideForward = this.sub3({ x: 0, y: 0, z: 1 }, this.scale3(tilt.up, tilt.up.z));
    }
    if (this.norm3(sideForward) <= 1e-6) {
      sideForward = this.sub3({ x: 0, y: 1, z: 0 }, this.scale3(tilt.up, tilt.up.y));
    }
    sideForward = this.safeDirection(sideForward, { x: 1, y: 0, z: 0 });

    // In profile view, the low side of the craft should indicate the
    // direction of induced fall/drift around the planet.
    const visibleTilt = -this.dot3(tilt.warp, sideForward);
    if (!Number.isFinite(visibleTilt) || Math.abs(visibleTilt) <= 1e-6) {
      return null;
    }
    return this.normalizeAttitude2D(tilt.vertical, visibleTilt, Math.abs(visibleTilt));
  }

  topAttitudeFromOrientation(sample, mode) {
    const axes = this.sampleBodyAxes(sample);
    if (!axes) {
      return this.topAttitudeFromWarpTilt(sample, mode);
    }
    const frame = this.localFrameFromSample(sample, mode);
    let heading = {
      x: this.dot3(axes.forward, frame.forward),
      y: this.dot3(axes.forward, frame.right)
    };
    if (Math.hypot(heading.x, heading.y) <= 1e-6) {
      heading = {
        x: this.dot3(axes.right, frame.forward),
        y: this.dot3(axes.right, frame.right)
      };
    }
    const headingNorm = this.normalizeAttitude2D(heading.x, heading.y, 0);
    const tilt = {
      x: this.dot3(axes.up, frame.forward),
      y: this.dot3(axes.up, frame.right)
    };
    const tiltMag = Math.hypot(tilt.x, tilt.y);
    const tiltNorm = tiltMag > 1e-6 ? { x: tilt.x / tiltMag, y: tilt.y / tiltMag } : { x: 0, y: 0 };
    return {
      headingX: headingNorm ? headingNorm.x : 1,
      headingY: headingNorm ? headingNorm.y : 0,
      tiltX: tiltNorm.x,
      tiltY: tiltNorm.y,
      strength: Math.max(0, Math.min(1, tiltMag))
    };
  }

  sideAttitudeFromOrientation(sample, mode) {
    const axes = this.sampleBodyAxes(sample);
    if (!axes) {
      return this.sideAttitudeFromWarpTilt(sample, mode);
    }
    const localUp = this.craftLocalUp(sample, mode);
    let sideForward = this.sub3({ x: 1, y: 0, z: 0 }, this.scale3(localUp, localUp.x));
    if (this.norm3(sideForward) <= 1e-6) {
      sideForward = this.sub3({ x: 0, y: 0, z: 1 }, this.scale3(localUp, localUp.z));
    }
    if (this.norm3(sideForward) <= 1e-6) {
      sideForward = this.sub3({ x: 0, y: 1, z: 0 }, this.scale3(localUp, localUp.y));
    }
    sideForward = this.safeDirection(sideForward, { x: 1, y: 0, z: 0 });
    const vertical = this.dot3(axes.up, localUp);
    const visibleTilt = -this.dot3(axes.up, sideForward);
    return {
      headingX: vertical,
      headingY: visibleTilt,
      tiltX: vertical,
      tiltY: visibleTilt,
      strength: Math.max(0, Math.min(1, Math.abs(visibleTilt))),
      angle: Math.atan2(visibleTilt, Math.max(0.05, Math.abs(vertical)))
    };
  }

  normalizeAttitude2D(vx, vy, strengthHint) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      return null;
    }
    const n = Math.hypot(vx, vy);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return null;
    }
    const strength = Number.isFinite(strengthHint) ? strengthHint : n;
    return {
      x: vx / n,
      y: vy / n,
      strength: Math.max(0, Math.min(1, strength))
    };
  }

  draw(sample, trailTop, trailSide, trail3D, mapMode) {
    this.drawTop(sample, trailTop, mapMode);
    this.drawSide(sample, trailSide, mapMode);
    this.drawWorld(sample, trail3D, mapMode);
  }

  drawTop(sample, trail, mapMode) {
    const ctx = this.topCtx;
    const canvas = this.topCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'local' ? 'local' : 'planetary';

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Start session to render top-down view');
      return;
    }

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    const atmosphere = mode === 'planetary' ? this.sampleAtmosphereSpec(sample) : null;
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let topScale = 1;
    let craftAttitude = null;
    const craftTiltAttitude = this.topAttitudeFromOrientation(sample, mode);

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      const radius = sample.primary_radius;
      const settings = this.planetaryViewSettings();
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
        ? (sample.position.y - sample.primary_position.y)
        : 0;
      const craftPlane = { x: rx, y: ry };
      const anchor = this.planetaryCameraAnchor2D(craftPlane.x, craftPlane.y, settings.follow);
      if (settings.follow) {
        const followRange = this.planetaryFollowRange(sample, radius, 6000);
        topScale = this.planetaryFollowScale(w, h, followRange, settings.zoom);
      } else {
        topScale = this.scaleFromPlanetaryTrail(trail, w, h, radius, (point) => {
          const px = Number.isFinite(point.rx) ? point.rx : 0;
          const py = Number.isFinite(point.ry) ? point.ry : 0;
          return [px - anchor.x, py - anchor.y];
        }, 0.6) * settings.zoom;
      }

      const planetCenterX = w * 0.5 - (anchor.x * topScale);
      const planetCenterY = h * 0.5 + (anchor.y * topScale);
      const planetScreenRadius = radius * topScale;
      if (this.planetaryShouldDrawBodyCircle(planetScreenRadius, w, h, settings.follow)) {
        this.paintPlanetCircle(ctx, planetCenterX, planetCenterY, planetScreenRadius, atmosphere);
      } else {
        this.paintPlanetTopFallback(ctx, w, h, planetCenterX, planetCenterY, atmosphere);
      }

      this.paintTrail(ctx, trail, topScale, w, h, (point) => {
        const p = {
          x: Number.isFinite(point.rx) ? point.rx : 0,
          y: Number.isFinite(point.ry) ? point.ry : 0
        };
        return {
          x: ((p.x - anchor.x) * topScale) + w * 0.5,
          y: h * 0.5 - ((p.y - anchor.y) * topScale)
        };
      }, 'rgba(15, 106, 115, 0.45)');

      const craftProjected = { x: rx, y: ry };
      craftX = w * 0.5 + ((craftProjected.x - anchor.x) * topScale);
      craftY = h * 0.5 - ((craftProjected.y - anchor.y) * topScale);

      craftAttitude = craftTiltAttitude;
    } else {
      const anchorX = Number.isFinite(sample.position?.x) ? sample.position.x : 0;
      const anchorY = Number.isFinite(sample.position?.y) ? sample.position.y : 0;
      topScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - anchorX, point.y - anchorY], 1200);
      this.paintTrail(ctx, trail, topScale, w, h, (point) => ({
        x: (point.x - anchorX) * topScale + w * 0.5,
        y: h * 0.5 - (point.y - anchorY) * topScale
      }), 'rgba(15, 106, 115, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;
      craftAttitude = craftTiltAttitude;
    }

    this.paintCraft(ctx, craftX, craftY, '#0f6a73', 'top', shipType, craftAttitude);

    const velScale = mode === 'planetary' ? Math.max(14, topScale * sample.primary_radius * 0.05) : 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.velocity.x * velScale,
      craftY - sample.velocity.y * velScale,
      '#2b4a77'
    );

    const gravScale = mode === 'planetary' ? Math.max(22, topScale * sample.primary_radius * 0.08) : 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + sample.effective_g.x * gravScale,
      craftY - sample.effective_g.y * gravScale,
      '#9b4d1e'
    );

    const legend = [
      ['craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ];
    if (mode === 'planetary') {
      legend.unshift([String(sample.primary_name || 'planet').toLowerCase(), '#35617f']);
      if (atmosphere) {
        legend.splice(1, 0, ['atmosphere', atmosphere.legend]);
      }
    }
    this.paintLegend(ctx, w, legend);
  }

  drawSide(sample, trail, mapMode) {
    const ctx = this.sideCtx;
    const canvas = this.sideCanvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'local' ? 'local' : 'planetary';

    ctx.clearRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    this.paintGrid(ctx, w, h);

    if (!sample) {
      this.paintMessage(ctx, w, h, 'Profile view appears here once running');
      return;
    }

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    const atmosphere = mode === 'planetary' ? this.sampleAtmosphereSpec(sample) : null;
    let craftX = w * 0.5;
    let craftY = h * 0.5;
    let sideScale = 1;
    let craftAttitude = null;
    const craftTiltAttitude = this.sideAttitudeFromOrientation(sample, mode);
    let velSideX = Number.isFinite(sample.velocity?.x) ? sample.velocity.x : 0;
    let velSideY = mode === 'planetary'
      ? (Number.isFinite(sample.velocity?.z) ? sample.velocity.z : 0)
      : (Number.isFinite(sample.vertical_vel) ? sample.vertical_vel : 0);
    let gravSideX = Number.isFinite(sample.effective_g?.x) ? sample.effective_g.x : 0;
    let gravSideY = Number.isFinite(sample.effective_g?.z) ? sample.effective_g.z : 0;

    if (mode === 'planetary' && Number.isFinite(sample.primary_radius) && sample.primary_radius > 0) {
      const radius = sample.primary_radius;
      const settings = this.planetaryViewSettings();
      const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
        ? (sample.position.x - sample.primary_position.x)
        : 0;
      const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
        ? (sample.position.y - sample.primary_position.y)
        : 0;
      const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
        ? (sample.position.z - sample.primary_position.z)
        : 0;
      const craftProjected = { x: rx, y: rz };
      const anchor = { x: craftProjected.x, y: craftProjected.y };
      const followRange = this.planetaryFollowRange(sample, radius, 4000);
      const localScale = this.planetaryFollowScale(w, h, followRange, settings.zoom);
      const craftDistance = Math.hypot(rx, ry, rz);
      sideScale = this.planetaryProfileScale(w, h, radius, craftDistance, settings.zoom, localScale);

      const planetCenterX = w * 0.5 - (anchor.x * sideScale);
      const planetCenterY = h * 0.5 + (anchor.y * sideScale);
      const planetScreenRadius = radius * sideScale;
      const drawPlanetDisk = this.planetaryShouldDrawBodyCircle(planetScreenRadius, w, h, true);
      if (drawPlanetDisk) {
        this.paintPlanetCircle(ctx, planetCenterX, planetCenterY, planetScreenRadius, atmosphere);
      } else {
        const localSurfaceY = h * 0.5 - ((radius - anchor.y) * sideScale);
        this.paintPlanetHorizonBand(ctx, w, h, planetCenterX, planetCenterY, planetScreenRadius, localSurfaceY, atmosphere);
      }
      this.paintTrail(ctx, trail, sideScale, w, h, (point) => {
        const projected = {
          x: Number.isFinite(point.rx) ? point.rx : 0,
          y: Number.isFinite(point.rz) ? point.rz : 0
        };
        return {
          x: ((projected.x - anchor.x) * sideScale) + w * 0.5,
          y: h * 0.5 - ((projected.y - anchor.y) * sideScale)
        };
      }, 'rgba(88, 125, 47, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;

      const velocityProjected = {
        x: Number.isFinite(sample.velocity?.x) ? sample.velocity.x : 0,
        z: Number.isFinite(sample.velocity?.z) ? sample.velocity.z : 0
      };
      const gravityProjected = {
        x: Number.isFinite(sample.effective_g?.x) ? sample.effective_g.x : 0,
        z: Number.isFinite(sample.effective_g?.z) ? sample.effective_g.z : 0
      };
      craftAttitude = craftTiltAttitude;
      velSideX = velocityProjected.x;
      velSideY = velocityProjected.z;
      gravSideX = gravityProjected.x;
      gravSideY = gravityProjected.z;
    } else {
      const anchorX = Number.isFinite(sample.position?.x) ? sample.position.x : 0;
      const anchorAlt = Number.isFinite(sample.altitude) ? sample.altitude : 0;
      sideScale = this.scaleFromTrail(trail, w, h, (point) => [point.x - anchorX, point.alt - anchorAlt], 800);

      const groundY = h * 0.5 + anchorAlt * sideScale;
      ctx.strokeStyle = 'rgba(120, 95, 66, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.stroke();

      this.paintTrail(ctx, trail, sideScale, w, h, (point) => ({
        x: (point.x - anchorX) * sideScale + w * 0.5,
        y: h * 0.5 - (point.alt - anchorAlt) * sideScale
      }), 'rgba(88, 125, 47, 0.45)');
      craftX = w * 0.5;
      craftY = h * 0.5;
      craftAttitude = craftTiltAttitude;
    }

    this.paintCraft(ctx, craftX, craftY, '#587d2f', 'side', shipType, craftAttitude);

    const velScale = mode === 'planetary' ? Math.max(14, sideScale * sample.primary_radius * 0.05) : 1.9;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + velSideX * velScale,
      craftY - velSideY * velScale,
      '#2b4a77'
    );

    const gravScale = mode === 'planetary' ? Math.max(22, sideScale * sample.primary_radius * 0.08) : 18;
    this.paintArrow(
      ctx,
      craftX,
      craftY,
      craftX + gravSideX * gravScale,
      craftY - gravSideY * gravScale,
      '#9b4d1e'
    );

    const legend = [
      ['craft', '#587d2f'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ];
    if (mode === 'planetary') {
      legend.unshift([String(sample.primary_name || 'planet').toLowerCase(), '#35617f']);
      if (atmosphere) {
        legend.splice(1, 0, ['atmosphere', atmosphere.legend]);
      }
    }
    this.paintLegend(ctx, w, legend);
  }

  drawWorld(sample, trail, mapMode) {
    const ctx = this.worldCtx;
    const canvas = this.worldCanvas;
    if (!ctx || !canvas) {
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mode = mapMode === 'planetary' ? 'planetary' : 'local';

    this.paintWorldBackdrop(ctx, w, h, mode);

    if (!sample) {
      this.paintMessage(ctx, w, h, '3D view appears here once running');
      return;
    }

    if (mode === 'planetary') {
      this.drawWorldPlanetary(ctx, w, h, sample, trail);
    } else {
      this.drawWorldLocal(ctx, w, h, sample, trail);
    }
  }

  drawWorldLocal(ctx, w, h, sample, trail) {
    const craft = { x: 0, y: 0, z: Number.parseFloat(sample.altitude) || 0 };
    const forward = this.safeDirection({
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.vertical_vel) || 0
    }, { x: 1, y: 0, z: 0 });
    const up = { x: 0, y: 0, z: 1 };
    const camPos = this.add3(craft, this.add3(this.scale3(up, 90), this.scale3(forward, -220)));
    const target = this.add3(craft, this.scale3(forward, 140));
    const projector = this.makeProjector(camPos, target, up, w, h, 62);

    this.paintWorldGroundGrid(ctx, projector, 1500, 150, 'rgba(121, 102, 69, 0.46)');
    this.paintWorldHorizon(ctx, projector, 2200, 'rgba(72, 93, 121, 0.36)');

    const localTrail = Array.isArray(trail)
      ? trail.map((point) => ({
        x: (Number.parseFloat(point.x) || 0) - (Number.parseFloat(sample.position?.x) || 0),
        y: (Number.parseFloat(point.y) || 0) - (Number.parseFloat(sample.position?.y) || 0),
        z: Number.parseFloat(point.alt) || 0
      }))
      : [];
    this.paintWorldTrail(ctx, localTrail, projector, 'rgba(66, 135, 144, 0.72)', 2.2);

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    this.paintWorldShip(ctx, projector, craft, shipType, '#0f6a73', sample, camPos);

    const vel3 = {
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.vertical_vel) || 0
    };
    const g3 = {
      x: Number.parseFloat(sample.effective_g?.x) || 0,
      y: Number.parseFloat(sample.effective_g?.y) || 0,
      z: Number.parseFloat(sample.effective_g?.z) || 0
    };
    const velScale = Math.min(260, this.norm3(vel3) * 9);
    const gravScale = Math.min(180, this.norm3(g3) * 18);
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(vel3, { x: 1, y: 0, z: 0 }), velScale), '#2b4a77');
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(g3, { x: 0, y: 0, z: -1 }), gravScale), '#9b4d1e');

    this.paintLegend(ctx, w, [
      ['3d craft', '#0f6a73'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e'],
      ['flat map', '#796645']
    ]);
  }

  drawWorldPlanetary(ctx, w, h, sample, trail) {
    if (!Number.isFinite(sample.primary_radius) || sample.primary_radius <= 0) {
      this.drawWorldLocal(ctx, w, h, sample, trail);
      return;
    }

    const craft = {
      x: (Number.parseFloat(sample.position?.x) || 0) - (Number.parseFloat(sample.primary_position?.x) || 0),
      y: (Number.parseFloat(sample.position?.y) || 0) - (Number.parseFloat(sample.primary_position?.y) || 0),
      z: (Number.parseFloat(sample.position?.z) || 0) - (Number.parseFloat(sample.primary_position?.z) || 0)
    };
    const up = this.safeDirection(craft, { x: 0, y: 0, z: 1 });
    const vel = {
      x: Number.parseFloat(sample.velocity?.x) || 0,
      y: Number.parseFloat(sample.velocity?.y) || 0,
      z: Number.parseFloat(sample.velocity?.z) || 0
    };
    const vDotUp = this.dot3(vel, up);
    const velTangent = this.sub3(vel, this.scale3(up, vDotUp));
    const forward = this.safeDirection(velTangent, this.crossFallback(up));

    const radius = Number.parseFloat(sample.primary_radius) || 1;
    const atmosphere = this.sampleAtmosphereSpec(sample);
    const settings = this.planetaryViewSettings();
    const zoomInv = 1 / Math.max(0.25, settings.zoom);
    let camPos;
    let target;
    if (settings.follow) {
      camPos = this.add3(craft, this.add3(
        this.scale3(up, ((radius * 0.24) + 180000) * zoomInv),
        this.scale3(forward, -((radius * 0.52) + 260000) * zoomInv)
      ));
      target = this.add3(craft, this.scale3(forward, radius * 0.04));
    } else {
      camPos = {
        x: (radius * 1.6) * zoomInv,
        y: (-radius * 1.4) * zoomInv,
        z: (radius * 1.1) * zoomInv
      };
      target = craft;
    }
    const projector = this.makeProjector(camPos, target, up, w, h, 60);

    this.paintWorldGlobe(ctx, projector, radius, atmosphere);

    const globeTrail = Array.isArray(trail)
      ? trail.map((point) => ({
        x: Number.parseFloat(point.rx) || 0,
        y: Number.parseFloat(point.ry) || 0,
        z: Number.parseFloat(point.rz) || 0
      }))
      : [];
    this.paintWorldTrail(ctx, globeTrail, projector, 'rgba(72, 151, 128, 0.78)', 2.1);

    const shipType = String(sample.ship_type || 'saucer').toLowerCase();
    this.paintWorldShip(ctx, projector, craft, shipType, '#3c7b62', sample, camPos);

    const velScale = radius * 0.028;
    const gravScale = radius * 0.022;
    const g3 = {
      x: Number.parseFloat(sample.effective_g?.x) || 0,
      y: Number.parseFloat(sample.effective_g?.y) || 0,
      z: Number.parseFloat(sample.effective_g?.z) || 0
    };
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(vel, forward), velScale), '#2b4a77');
    this.paintWorldVector(ctx, projector, craft, this.scale3(this.safeDirection(g3, this.scale3(up, -1)), gravScale), '#9b4d1e');

    this.paintLegend(ctx, w, [
      [`${String(sample.primary_name || 'planet').toLowerCase()} globe`, '#35617f'],
      ...(atmosphere ? [['atmosphere', atmosphere.legend]] : []),
      ['craft', '#3c7b62'],
      ['velocity', '#2b4a77'],
      ['gravity', '#9b4d1e']
    ]);
  }

  paintWorldBackdrop(ctx, w, h, mode) {
    ctx.clearRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (mode === 'planetary') {
      gradient.addColorStop(0, '#101f31');
      gradient.addColorStop(1, '#223950');
    } else {
      gradient.addColorStop(0, '#f2fbff');
      gradient.addColorStop(1, '#e6efe0');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  paintWorldTrail(ctx, points, projector, color, width) {
    if (!Array.isArray(points) || points.length < 2) {
      return;
    }
    const segCount = points.length - 1;
    const coreWidth = Number.isFinite(width) && width > 0 ? width : 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < points.length; i += 1) {
      const a = projector(points[i - 1]);
      const b = projector(points[i]);
      if (!a || !b) {
        continue;
      }
      const age = i / segCount;
      const glowAlpha = 0.02 + (Math.pow(age, 1.8) * 0.2);
      const coreAlpha = 0.04 + (Math.pow(age, 1.6) * 0.74);

      ctx.strokeStyle = this.trailColorWithAlpha(color, glowAlpha);
      ctx.lineWidth = coreWidth * (1.9 + (age * 0.7));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = this.trailColorWithAlpha(color, coreAlpha);
      ctx.lineWidth = coreWidth * (0.45 + (age * 0.72));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  paintWorldVector(ctx, projector, origin, vec, color) {
    const a = projector(origin);
    const b = projector(this.add3(origin, vec));
    if (!a || !b) {
      return;
    }
    this.paintArrow(ctx, a.x, a.y, b.x, b.y, color);
  }

  paintWorldSegment(ctx, projector, from, to, color, width = 1) {
    const a = projector(from);
    const b = projector(to);
    if (!a || !b) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  paintWorldGroundGrid(ctx, projector, range, spacing, color) {
    for (let x = -range; x <= range; x += spacing) {
      this.paintWorldSegment(
        ctx,
        projector,
        { x, y: -range, z: 0 },
        { x, y: range, z: 0 },
        color
      );
    }
    for (let y = -range; y <= range; y += spacing) {
      this.paintWorldSegment(
        ctx,
        projector,
        { x: -range, y, z: 0 },
        { x: range, y, z: 0 },
        color
      );
    }
  }

  paintWorldHorizon(ctx, projector, range, color) {
    this.paintWorldSegment(
      ctx,
      projector,
      { x: -range, y: 0, z: 0 },
      { x: range, y: 0, z: 0 },
      color,
      1.6
    );
  }

  paintWorldGlobe(ctx, projector, radius, atmosphere = null) {
    const center = projector({ x: 0, y: 0, z: 0 });
    if (!center) {
      return;
    }
    const rightEdge = projector({ x: radius, y: 0, z: 0 });
    if (!rightEdge) {
      return;
    }
    const screenRadius = Math.hypot(rightEdge.x - center.x, rightEdge.y - center.y);
    if (!Number.isFinite(screenRadius) || screenRadius <= 1) {
      return;
    }
    if (atmosphere) {
      const outerEdge = projector({ x: radius + atmosphere.shellHeight, y: 0, z: 0 });
      const outerRadius = outerEdge
        ? Math.hypot(outerEdge.x - center.x, outerEdge.y - center.y)
        : (screenRadius + this.atmosphereThicknessPx(screenRadius, atmosphere));
      this.paintAtmosphereAnnulus(ctx, center.x, center.y, screenRadius, outerRadius, atmosphere);
    }
    const radial = ctx.createRadialGradient(
      center.x - (screenRadius * 0.25),
      center.y - (screenRadius * 0.3),
      screenRadius * 0.25,
      center.x,
      center.y,
      screenRadius
    );
    radial.addColorStop(0, 'rgba(105, 174, 195, 0.93)');
    radial.addColorStop(1, 'rgba(42, 84, 118, 0.96)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18, 55, 82, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  paintWorldShip(ctx, projector, point, shipType, color, sample = null, cameraPos = null) {
    const p = projector(point);
    if (!p) {
      return;
    }
    const span = Number.parseFloat(sample?.craft_span_m);
    const scaleFactor = Number.isFinite(span) && span > 0 ? Math.sqrt(span / CRAFT_LAZAR_SPAN_M) : 1;
    const size = Math.max(4, Math.min(14, (360 / Math.max(80, p.depth)) * scaleFactor));
    const type = String(shipType || 'saucer').toLowerCase();
    const axes = this.sampleBodyAxes(sample);
    const viewDir = cameraPos ? this.safeDirection(this.sub3(point, cameraPos), { x: 1, y: 0, z: 0 }) : { x: 1, y: 0, z: 0 };
    const offset = Math.max(6, (Number.isFinite(span) ? span : CRAFT_LAZAR_SPAN_M) * 0.35);
    const forwardTip = axes ? projector(this.add3(point, this.scale3(axes.forward, offset))) : null;
    const projectedHeading = forwardTip
      ? this.normalizeAttitude2D(forwardTip.x - p.x, p.y - forwardTip.y, 1)
      : null;
    const headingAngle = projectedHeading ? Math.atan2(-projectedHeading.y, projectedHeading.x) : 0;
    const tiltTip = axes ? projector(this.add3(point, this.scale3(axes.up, offset))) : null;
    const projectedTilt = tiltTip
      ? this.normalizeAttitude2D(tiltTip.x - p.x, p.y - tiltTip.y, 1)
      : null;
    const faceRatio = axes ? Math.abs(this.dot3(axes.up, viewDir)) : 1;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.translate(p.x, p.y);
    if (projectedHeading) {
      ctx.rotate(headingAngle);
    }
    if (type === 'egg') {
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.6, size * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }

    if (type === 'pyramid') {
      ctx.beginPath();
      ctx.moveTo(0, -(size * 0.92));
      ctx.lineTo(-(size * 0.86), size * 0.74);
      ctx.lineTo(size * 0.86, size * 0.74);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }

    if (type === 'flat_triangle') {
      ctx.beginPath();
      ctx.moveTo(0, -(size * 0.46));
      ctx.lineTo(-(size * 1.15), size * 0.34);
      ctx.lineTo(size * 1.15, size * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (projectedTilt) {
        this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8);
      }
      return;
    }
    const minor = Math.max(size * 0.26, size * Math.max(0.36, faceRatio));
    ctx.beginPath();
    ctx.ellipse(0, 0, size, minor, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.beginPath();
    ctx.ellipse(0, -(size * 0.16), size * 0.46, Math.max(size * 0.16, minor * 0.42), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (projectedTilt) {
      this.paintCraftTiltIndicator(ctx, p.x, p.y, projectedTilt.x, projectedTilt.y, 'rgba(12, 52, 60, 0.72)', 8.5);
    }
  }

  makeProjector(cameraPos, target, upHint, w, h, fovDeg) {
    const forward = this.safeDirection(this.sub3(target, cameraPos), { x: 1, y: 0, z: 0 });
    let right = this.cross3(forward, upHint);
    if (this.norm3(right) <= 1e-6) {
      right = this.cross3(forward, { x: 0, y: 0, z: 1 });
    }
    right = this.safeDirection(right, { x: 1, y: 0, z: 0 });
    const up = this.safeDirection(this.cross3(right, forward), { x: 0, y: 0, z: 1 });
    const near = 1;
    const focal = (Math.min(w, h) * 0.5) / Math.tan((fovDeg * Math.PI) / 360);

    const project = (point) => {
      const rel = this.sub3(point, cameraPos);
      const cx = this.dot3(rel, right);
      const cy = this.dot3(rel, up);
      const cz = this.dot3(rel, forward);
      if (!Number.isFinite(cz) || cz <= near) {
        return null;
      }
      return {
        x: (w * 0.5) + (cx * focal / cz),
        y: (h * 0.5) - (cy * focal / cz),
        depth: cz
      };
    };
    return project;
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

  trailColorWithAlpha(color, alpha) {
    const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
    const match = String(color || '').match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${a.toFixed(3)})`;
    }
    return color;
  }

  paintTrail(ctx, trail, scale, w, h, projector, color) {
    if (!trail || trail.length < 2) {
      return;
    }
    const segCount = trail.length - 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i += 1) {
      const a = projector(trail[i - 1], scale, w, h);
      const b = projector(trail[i], scale, w, h);
      if (!a || !b) {
        continue;
      }
      const age = i / segCount;
      const glowAlpha = 0.02 + (Math.pow(age, 1.8) * 0.16);
      const coreAlpha = 0.05 + (Math.pow(age, 1.5) * 0.64);

      ctx.strokeStyle = this.trailColorWithAlpha(color, glowAlpha);
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = this.trailColorWithAlpha(color, coreAlpha);
      ctx.lineWidth = 1.55 + (age * 0.65);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  paintAtmosphereAnnulus(ctx, x, y, innerRadius, outerRadius, atmosphere) {
    if (!atmosphere || !Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) || outerRadius <= innerRadius) {
      return;
    }
    const glow = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glow.addColorStop(0.45, atmosphere.glowInner);
    glow.addColorStop(1, atmosphere.glowOuter);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = atmosphere.line;
    ctx.lineWidth = Math.max(1, (outerRadius - innerRadius) * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, outerRadius - ((outerRadius - innerRadius) * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  }

  paintPlanetCircle(ctx, x, y, radius, atmosphere = null) {
    if (!Number.isFinite(radius) || radius <= 0.2) {
      return;
    }
    const atmosphereThickness = this.atmosphereThicknessPx(radius, atmosphere);
    if (atmosphereThickness > 0) {
      this.paintAtmosphereAnnulus(ctx, x, y, radius, radius + atmosphereThickness, atmosphere);
    }
    const radial = ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.35,
      radius * 0.2,
      x,
      y,
      radius
    );
    radial.addColorStop(0, 'rgba(94, 154, 180, 0.82)');
    radial.addColorStop(1, 'rgba(53, 97, 127, 0.90)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(19, 54, 78, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  paintPlanetHorizonBand(ctx, w, h, centerX, centerY, radius, surfaceYFallback, atmosphere = null) {
    const fallbackY = Number.isFinite(surfaceYFallback) ? Math.max(-h, Math.min(h * 2, surfaceYFallback)) : (h * 0.5);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= 1) {
      this.paintPlanetHorizonFlat(ctx, w, h, fallbackY, atmosphere);
      return;
    }

    const segments = Math.max(28, Math.min(120, Math.floor(w / 10)));
    const limb = [];
    for (let i = 0; i <= segments; i += 1) {
      const x = (w * i) / segments;
      const dx = x - centerX;
      const inside = (radius * radius) - (dx * dx);
      if (inside <= 0) {
        continue;
      }
      const y = centerY - Math.sqrt(inside);
      if (Number.isFinite(y)) {
        limb.push({ x, y });
      }
    }

    if (limb.length < 2) {
      this.paintPlanetHorizonFlat(ctx, w, h, fallbackY, atmosphere);
      return;
    }

    const atmosphereThickness = this.atmosphereThicknessPx(radius, atmosphere);
    if (atmosphereThickness > 0) {
      const outerRadius = radius + atmosphereThickness;
      const outerLimb = [];
      for (let i = 0; i <= segments; i += 1) {
        const x = (w * i) / segments;
        const dx = x - centerX;
        const inside = (outerRadius * outerRadius) - (dx * dx);
        if (inside <= 0) {
          continue;
        }
        const y = centerY - Math.sqrt(inside);
        if (Number.isFinite(y)) {
          outerLimb.push({ x, y });
        }
      }
      if (outerLimb.length >= 2) {
        const skyFill = ctx.createLinearGradient(0, outerLimb[0].y, 0, limb[Math.floor(limb.length * 0.5)].y);
        skyFill.addColorStop(0, atmosphere.fillTop);
        skyFill.addColorStop(1, atmosphere.fillBottom);
        ctx.fillStyle = skyFill;
        ctx.beginPath();
        ctx.moveTo(outerLimb[0].x, outerLimb[0].y);
        for (let i = 1; i < outerLimb.length; i += 1) {
          ctx.lineTo(outerLimb[i].x, outerLimb[i].y);
        }
        for (let i = limb.length - 1; i >= 0; i -= 1) {
          ctx.lineTo(limb[i].x, limb[i].y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = atmosphere.line;
        ctx.lineWidth = Math.max(1, atmosphereThickness * 0.3);
        ctx.beginPath();
        ctx.moveTo(outerLimb[0].x, outerLimb[0].y);
        for (let i = 1; i < outerLimb.length; i += 1) {
          ctx.lineTo(outerLimb[i].x, outerLimb[i].y);
        }
        ctx.stroke();
      }
    }

    const mid = limb[Math.floor(limb.length * 0.5)];
    const yMid = Number.isFinite(mid?.y) ? mid.y : fallbackY;
    const fill = ctx.createLinearGradient(0, yMid, 0, h);
    fill.addColorStop(0, 'rgba(94, 154, 180, 0.28)');
    fill.addColorStop(1, 'rgba(53, 97, 127, 0.82)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(limb[0].x, h);
    ctx.lineTo(limb[0].x, limb[0].y);
    for (let i = 1; i < limb.length; i += 1) {
      ctx.lineTo(limb[i].x, limb[i].y);
    }
    ctx.lineTo(limb[limb.length - 1].x, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.86)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(limb[0].x, limb[0].y);
    for (let i = 1; i < limb.length; i += 1) {
      ctx.lineTo(limb[i].x, limb[i].y);
    }
    ctx.stroke();
  }

  paintPlanetHorizonFlat(ctx, w, h, y, atmosphere = null) {
    const yy = Math.max(-h, Math.min(h * 2, y));
    const atmosphereThickness = this.atmosphereThicknessPx(Math.max(w, h) * 0.3, atmosphere);
    if (atmosphere && atmosphereThickness > 0) {
      const sky = ctx.createLinearGradient(0, yy - atmosphereThickness, 0, yy);
      sky.addColorStop(0, atmosphere.fillTop);
      sky.addColorStop(1, atmosphere.fillBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, yy - atmosphereThickness, w, atmosphereThickness);
      ctx.strokeStyle = atmosphere.line;
      ctx.lineWidth = Math.max(1, atmosphereThickness * 0.26);
      ctx.beginPath();
      ctx.moveTo(0, yy - (atmosphereThickness * 0.45));
      ctx.lineTo(w, yy - (atmosphereThickness * 0.45));
      ctx.stroke();
    }
    const fill = ctx.createLinearGradient(0, yy, 0, h);
    fill.addColorStop(0, 'rgba(94, 154, 180, 0.24)');
    fill.addColorStop(1, 'rgba(53, 97, 127, 0.76)');
    ctx.fillStyle = fill;
    ctx.fillRect(0, yy, w, h - yy);

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.78)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }

  paintPlanetTopFallback(ctx, w, h, centerX, centerY, atmosphere = null) {
    const radius = Math.max(w, h) * 1.15;
    const atmosphereThickness = this.atmosphereThicknessPx(Math.max(w, h) * 0.9, atmosphere);
    const radial = ctx.createRadialGradient(
      centerX - (radius * 0.18),
      centerY - (radius * 0.22),
      radius * 0.18,
      centerX,
      centerY,
      radius
    );
    radial.addColorStop(0, 'rgba(105, 174, 195, 0.58)');
    radial.addColorStop(1, 'rgba(42, 84, 118, 0.52)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(19, 54, 78, 0.52)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(w, h) * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    if (atmosphere && atmosphereThickness > 0) {
      ctx.strokeStyle = atmosphere.line;
      ctx.lineWidth = Math.max(1, atmosphereThickness * 0.32);
      ctx.beginPath();
      ctx.arc(centerX, centerY, (Math.max(w, h) * 0.9) + (atmosphereThickness * 0.45), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  paintCraft(ctx, x, y, color, view, shipType, attitude) {
    const type = String(shipType || 'saucer').toLowerCase();
    const mode = view === 'side' ? 'side' : 'top';
    const headingAtt = this.normalizeAttitude2D(
      Number.isFinite(attitude?.headingX) ? attitude.headingX : (Number.isFinite(attitude?.x) ? attitude.x : NaN),
      Number.isFinite(attitude?.headingY) ? attitude.headingY : (Number.isFinite(attitude?.y) ? attitude.y : NaN),
      1
    );
    const tiltAtt = this.normalizeAttitude2D(
      Number.isFinite(attitude?.tiltX) ? attitude.tiltX : (Number.isFinite(attitude?.x) ? attitude.x : NaN),
      Number.isFinite(attitude?.tiltY) ? attitude.tiltY : (Number.isFinite(attitude?.y) ? attitude.y : NaN),
      Number.isFinite(attitude?.strength) ? attitude.strength : NaN
    );
    const heading = headingAtt ? Math.atan2(-headingAtt.y, headingAtt.x) : 0;
    const tiltRatio = Number.isFinite(attitude?.strength) ? Math.max(0, Math.min(1, attitude.strength)) : (tiltAtt ? tiltAtt.strength : 0);
    const sideTiltAngle = Number.isFinite(attitude?.angle)
      ? Math.max(-Math.PI / 3, Math.min(Math.PI / 3, attitude.angle))
      : (tiltAtt
        ? Math.max(-Math.PI / 3, Math.min(Math.PI / 3, Math.atan2(tiltAtt.y, Math.max(0.05, Math.abs(tiltAtt.x)))))
        : 0);

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (mode === 'top') {
      if (headingAtt && (type === 'egg' || type === 'pyramid' || type === 'flat_triangle')) {
        ctx.rotate(heading);
      }

      if (type === 'sphere') {
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'egg') {
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.6, 7.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'pyramid') {
        ctx.beginPath();
        ctx.moveTo(0, -8.2);
        ctx.lineTo(-6.8, 6.4);
        ctx.lineTo(6.8, 6.4);
        ctx.closePath();
        ctx.fill();
      } else if (type === 'flat_triangle') {
        ctx.beginPath();
        ctx.moveTo(0, -5.9);
        ctx.lineTo(-8.4, 3.6);
        ctx.lineTo(8.4, 3.6);
        ctx.closePath();
        ctx.fill();
      } else {
        if (headingAtt) {
          ctx.rotate(heading);
        }
        const major = 7;
        const minor = Math.max(3.9, major * (1 - (0.42 * tiltRatio)));
        ctx.beginPath();
        ctx.ellipse(0, 0, major, minor, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
        const hx = tiltAtt ? (-tiltAtt.x * 2.1) : 0;
        const hy = tiltAtt ? (tiltAtt.y * 2.1) : -1.2;
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 10);
      }
      return;
    }

    if (tiltAtt && type !== 'sphere') {
      ctx.rotate(-sideTiltAngle);
    }

    if (type === 'sphere') {
      ctx.beginPath();
      ctx.arc(0, 0, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8);
      }
      return;
    }

    if (type === 'egg') {
      ctx.beginPath();
      ctx.ellipse(0.6, 0, 4.7, 6.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    if (type === 'pyramid') {
      ctx.beginPath();
      ctx.moveTo(0, -6.8);
      ctx.lineTo(-7.4, 6.2);
      ctx.lineTo(7.4, 6.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    if (type === 'flat_triangle') {
      ctx.beginPath();
      ctx.moveTo(-9, 2.5);
      ctx.lineTo(9, 2.5);
      ctx.lineTo(0, -2.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (tiltAtt) {
        this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
      }
      return;
    }

    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.stroke();
    ctx.restore();
    if (tiltAtt) {
      this.paintCraftTiltIndicator(ctx, x, y, tiltAtt.x, tiltAtt.y, 'rgba(21, 47, 73, 0.72)', 8.5);
    }
  }

  paintCraftTiltIndicator(ctx, x, y, vx, vy, color, length = 9) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      return;
    }
    const n = Math.hypot(vx, vy);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return;
    }
    const ux = vx / n;
    const uy = vy / n;
    this.paintArrow(
      ctx,
      x,
      y,
      x + (ux * length),
      y - (uy * length),
      color
    );
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

  scaleFromPlanetaryTrail(trail, w, h, bodyRadius, project, minimumRadiusPad) {
    let maxRange = Number.isFinite(bodyRadius) && bodyRadius > 0 ? bodyRadius * (1 + minimumRadiusPad) : 1;
    if (Array.isArray(trail) && trail.length > 0) {
      for (let i = 0; i < trail.length; i += 1) {
        const [dx, dy] = project(trail[i]);
        const r = Math.hypot(dx, dy);
        if (Number.isFinite(r)) {
          maxRange = Math.max(maxRange, r * 1.04);
        }
      }
    }
    if (!Number.isFinite(maxRange) || maxRange <= 1) {
      maxRange = 1;
    }
    return Math.min(w, h) / (maxRange * 2.2);
  }

  add3(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  sub3(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  scale3(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  dot3(a, b) {
    return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
  }

  cross3(a, b) {
    return {
      x: (a.y * b.z) - (a.z * b.y),
      y: (a.z * b.x) - (a.x * b.z),
      z: (a.x * b.y) - (a.y * b.x)
    };
  }

  norm3(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  safeDirection(v, fallback) {
    const n = this.norm3(v);
    if (!Number.isFinite(n) || n <= 1e-9) {
      return fallback;
    }
    return this.scale3(v, 1 / n);
  }

  crossFallback(up) {
    let guess = this.cross3(up, { x: 0, y: 0, z: 1 });
    if (this.norm3(guess) <= 1e-6) {
      guess = this.cross3(up, { x: 0, y: 1, z: 0 });
    }
    return this.safeDirection(guess, { x: 1, y: 0, z: 0 });
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

function normalizePaperNavSelection(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return;
  }
  const mapping = '#paper-fragment@outerHTML->#paper-content@innerHTML';
  scope.querySelectorAll('a[data-paper-link]').forEach((link) => {
    if (!link || typeof link.getAttribute !== 'function' || typeof link.setAttribute !== 'function') {
      return;
    }
    const current = link.getAttribute('data-gx-select') || '';
    if (current !== mapping) {
      link.setAttribute('data-gx-select', mapping);
    }
  });
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
  const couplerEnabled = Boolean(item.coupler_enabled ?? item.CouplerEnabled);

  return {
    name,
    path: typeof pathRaw === 'string' ? pathRaw : '',
    dt: Number.isFinite(dt) ? dt : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    gravityModel,
    couplerEnabled
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
    const couplerLabel = item.couplerEnabled ? 'coupler:on' : 'coupler:off';
    opt.value = item.name;
    opt.textContent = `${item.name} • ${item.gravityModel} • ${couplerLabel} • dt=${dtLabel}s • duration=${durationLabel}s`;
    select.appendChild(opt);
  }

  if (preserve && Array.from(select.options).some((opt) => opt.value === preserve)) {
    select.value = preserve;
  } else if (select.options.length > 0) {
    const freePlay = Array.from(select.options).find((opt) => opt.value === 'free_play');
    select.value = freePlay ? freePlay.value : select.options[0].value;
  }
}

function selectedScenario(root) {
  const selected = root.querySelector('[data-scenario-select]')?.value || '';
  if (selected) {
    return selected;
  }
  if (state.scenarios.some((item) => item.name === 'free_play')) {
    return 'free_play';
  }
  if (state.scenarios.length > 0) {
    return state.scenarios[0].name;
  }
  return 'free_play';
}

function selectedShipType() {
  const ship = String(state.refs?.shipType?.value || 'saucer').toLowerCase();
  if (ship === 'sphere' || ship === 'egg' || ship === 'pyramid' || ship === 'flat_triangle') {
    return ship;
  }
  if (ship === 'flat-triangle' || ship === 'flat triangle' || ship === 'triangle' || ship === 'delta') {
    return 'flat_triangle';
  }
  return 'saucer';
}

function selectedWarpDrive() {
  const drive = String(state.refs?.warpDrive?.value || 'standard').toLowerCase();
  if (drive === 'off') {
    return 'off';
  }
  if (drive === 'scenario_default' || drive === 'default' || drive === 'scenario') {
    return 'scenario_default';
  }
  return 'standard';
}

function warpDriveLabel(value) {
  switch (String(value || '').toLowerCase()) {
    case 'off':
      return 'coupler off';
    case 'scenario_default':
      return 'scenario default';
    default:
      return 'standard warp';
  }
}

function currentCraftScale() {
  const raw = readNumberInput(state.refs?.craftScale, CRAFT_SCALE_MIN);
  const value = clampNumber(raw, CRAFT_SCALE_MIN, CRAFT_SCALE_MAX, CRAFT_SCALE_MIN);
  return value;
}

function craftSpanMetersFromScale(scale) {
  const s = clampNumber(scale, CRAFT_SCALE_MIN, CRAFT_SCALE_MAX, CRAFT_SCALE_MIN);
  return CRAFT_LAZAR_SPAN_M * s;
}

function updateCraftScaleReadout() {
  const scale = currentCraftScale();
  if (state.refs?.craftScale) {
    state.refs.craftScale.value = scale.toFixed(2);
  }
  const readout = state.refs?.craftScaleReadout;
  if (!readout) {
    return;
  }
  const spanM = craftSpanMetersFromScale(scale);
  const spanFt = spanM * METERS_TO_FEET;
  readout.textContent = `${formatNumber(scale, 2)}x • ${formatNumber(spanM, 1)} m (${formatNumber(spanFt, 1)} ft)`;
}

function currentMapMode() {
  const mode = String(state.refs?.mapMode?.value || state.game.mapMode || 'planetary').toLowerCase();
  if (mode === 'local') {
    return 'local';
  }
  return 'planetary';
}

function selectedPlanetPreset() {
  const preset = String(state.refs?.planetPreset?.value || 'earth').toLowerCase();
  if (preset === 'earth' || preset === 'moon' || preset === 'mars' || preset === 'venus' || preset === 'jupiter') {
    return preset;
  }
  return 'earth';
}

function currentPlanetaryCameraMode() {
  const mode = String(state.refs?.planetaryCamera?.value || 'follow').toLowerCase();
  if (mode === 'global') {
    return 'global';
  }
  return 'follow';
}

function currentPlanetaryZoom() {
  const raw = readNumberInput(state.refs?.planetaryZoom, 2.0);
  return clampNumber(raw, 0.25, 25, 2.0);
}

function isGuideModalOpen() {
  const modal = state.refs?.guideModal;
  return Boolean(modal && !modal.classList.contains('hidden'));
}

function openGuideModal() {
  const modal = state.refs?.guideModal;
  if (!modal) {
    return;
  }
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeGuideModal() {
  const modal = state.refs?.guideModal;
  if (!modal) {
    return;
  }
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
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
    document.body.classList.remove('overflow-hidden');
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
  const controlReadouts = Object.create(null);
  root.querySelectorAll('[data-control-readout]').forEach((node) => {
    const key = node.getAttribute('data-control-readout');
    if (key) {
      controlReadouts[key] = node;
    }
  });

  state.refs = {
    status: root.querySelector('[data-game-status]'),
    scenario: root.querySelector('[data-scenario-select]'),
    warpDrive: root.querySelector('[data-warp-drive]'),
    shipType: root.querySelector('[data-ship-type]'),
    craftScale: root.querySelector('[data-craft-scale]'),
    craftScaleReadout: root.querySelector('[data-craft-scale-readout]'),
    planetPreset: root.querySelector('[data-planet-preset]'),
    mapMode: root.querySelector('[data-map-mode]'),
    planetaryCamera: root.querySelector('[data-planetary-camera]'),
    planetaryZoom: root.querySelector('[data-planetary-zoom]'),
    speed: root.querySelector('[data-game-speed]'),
    startGround: root.querySelector('[data-game-start-ground]'),
    holdAmpEnabled: root.querySelector('[data-hold-amp-enabled]'),
    holdAmpTarget: root.querySelector('[data-hold-amp-target]'),
    holdPhiEnabled: root.querySelector('[data-hold-phi-enabled]'),
    holdPhiTarget: root.querySelector('[data-hold-phi-target]'),
    holdYawEnabled: root.querySelector('[data-hold-yaw-enabled]'),
    holdYawTarget: root.querySelector('[data-hold-yaw-target]'),
    holdPitchEnabled: root.querySelector('[data-hold-pitch-enabled]'),
    holdPitchTarget: root.querySelector('[data-hold-pitch-target]'),
    oscOmegaTarget: root.querySelector('[data-osc-omega-target]'),
    oscQTarget: root.querySelector('[data-osc-q-target]'),
    oscBetaTarget: root.querySelector('[data-osc-beta-target]'),
    plasmaTarget: root.querySelector('[data-plasma-target]'),
    autoTrim: root.querySelector('[data-auto-trim]'),
    autoWeight: root.querySelector('[data-auto-weight]'),
    autoVertical: root.querySelector('[data-auto-vertical]'),
    energyHorizon: root.querySelector('[data-energy-horizon]'),
    pauseButton: root.querySelector('[data-game-pause]'),
    guideModal: root.querySelector('[data-guide-modal]'),
    controlReadouts,
    stats,
    canvasTop: root.querySelector('[data-game-canvas-top]'),
    canvasSide: root.querySelector('[data-game-canvas-side]'),
    canvas3D: root.querySelector('[data-game-canvas-3d]'),
    speedometerCanvas: root.querySelector('[data-game-speedometer]')
  };

  state.game.mapMode = currentMapMode();

  state.renderer = new DualViewRenderer(state.refs.canvasTop, state.refs.canvasSide, state.refs.canvas3D);
  state.renderer.setPlanetaryCamera(currentPlanetaryZoom(), currentPlanetaryCameraMode());
  state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());

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
  updateControlBarReadouts();
  updateCraftScaleReadout();
  setStatus('ready');
  updateHUD(state.game.latest);
  closeGuideModal();
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

function formatCompactNumber(value, maxDigits = 2) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(Math.min(maxDigits, 1));
  }
  return value.toFixed(maxDigits);
}

function formatPower(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return `${(value / 1e9).toFixed(3)} GW`;
  }
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(3)} MW`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(3)} kW`;
  }
  return `${value.toFixed(1)} W`;
}

function formatPowerCompact(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return `${formatCompactNumber(value / 1e9, 2)} GW`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(value / 1e6, 2)} MW`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(value / 1e3, 2)} kW`;
  }
  return `${formatCompactNumber(value, 1)} W`;
}

function formatEnergy(valueJ) {
  if (!Number.isFinite(valueJ)) {
    return '-';
  }
  const abs = Math.abs(valueJ);
  if (abs >= 1e9) {
    return `${(valueJ / 1e9).toFixed(3)} GJ`;
  }
  if (abs >= 1e6) {
    return `${(valueJ / 1e6).toFixed(3)} MJ`;
  }
  if (abs >= 1e3) {
    return `${(valueJ / 1e3).toFixed(3)} kJ`;
  }
  return `${valueJ.toFixed(1)} J`;
}

function formatDistanceCompact(valueM) {
  if (!Number.isFinite(valueM)) {
    return '-';
  }
  const abs = Math.abs(valueM);
  if (abs >= 1e9) {
    return `${formatCompactNumber(valueM / 1e9, 2)} Gm`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueM / 1e6, 2)} Mm`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueM / 1e3, 2)} km`;
  }
  return `${formatCompactNumber(valueM, 1)} m`;
}

function formatVelocityCompact(valueMps) {
  if (!Number.isFinite(valueMps)) {
    return '-';
  }
  const abs = Math.abs(valueMps);
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueMps / 1e6, 2)} Mm/s`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueMps / 1e3, 2)} km/s`;
  }
  return `${formatCompactNumber(valueMps, 1)} m/s`;
}

function formatKmhCompact(valueMps) {
  if (!Number.isFinite(valueMps)) {
    return '-';
  }
  const kmh = valueMps * 3.6;
  const abs = Math.abs(kmh);
  if (abs >= 1e6) {
    return `${formatCompactNumber(kmh / 1e6, 2)}M km/h`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(kmh / 1e3, 2)}k km/h`;
  }
  return `${formatCompactNumber(kmh, 1)} km/h`;
}

function formatSpecificPowerCompact(valueWkg) {
  if (!Number.isFinite(valueWkg)) {
    return '-';
  }
  const abs = Math.abs(valueWkg);
  if (abs >= 1e9) {
    return `${formatCompactNumber(valueWkg / 1e9, 2)} GW/kg`;
  }
  if (abs >= 1e6) {
    return `${formatCompactNumber(valueWkg / 1e6, 2)} MW/kg`;
  }
  if (abs >= 1e3) {
    return `${formatCompactNumber(valueWkg / 1e3, 2)} kW/kg`;
  }
  return `${formatCompactNumber(valueWkg, 2)} W/kg`;
}

function formatPercentCompact(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${formatCompactNumber(value * 100, 2)}%`;
}

function clampNumber(value, min, max, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value) {
  return clampNumber(value, -1, 1, 0);
}

function readNumberInput(node, fallback) {
  const raw = Number.parseFloat(node?.value ?? '');
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return raw;
}

function wrapRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let out = value;
  while (out > Math.PI) {
    out -= TWO_PI;
  }
  while (out < -Math.PI) {
    out += TWO_PI;
  }
  return out;
}

function wrapPositiveRadians(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let out = value;
  while (out < 0) {
    out += TWO_PI;
  }
  while (out >= TWO_PI) {
    out -= TWO_PI;
  }
  return out;
}

function phaseCycle(value) {
  return wrapPositiveRadians(value) / TWO_PI;
}

function updateControlEffect(prev, next) {
  if (!next) {
    state.input.lastEffect = 'none';
    return;
  }
  if (!prev) {
    state.input.lastEffect = `session start @ t=${formatNumber(next.time, 2)}s`;
    return;
  }

  const changed = [];
  const eps = 1e-6;
  if (Math.abs((next.control_amp_target || 0) - (prev.control_amp_target || 0)) > eps) {
    changed.push('amp');
  }
  if (Math.abs((next.control_theta_target || 0) - (prev.control_theta_target || 0)) > eps) {
    changed.push('phase');
  }
  if (Math.abs((next.control_omega_target || 0) - (prev.control_omega_target || 0)) > eps) {
    changed.push('omega');
  }
  if (Math.abs((next.control_q_target || 0) - (prev.control_q_target || 0)) > eps) {
    changed.push('Q');
  }
  if (Math.abs((next.control_beta_target || 0) - (prev.control_beta_target || 0)) > eps) {
    changed.push('pump');
  }
  if (Math.abs((next.control_plasma_target || 0) - (prev.control_plasma_target || 0)) > eps) {
    changed.push('plasma');
  }
  if (Math.abs((next.control_axis_yaw || 0) - (prev.control_axis_yaw || 0)) > eps) {
    changed.push('yaw');
  }
  if (Math.abs((next.control_axis_pitch || 0) - (prev.control_axis_pitch || 0)) > eps) {
    changed.push('pitch');
  }
  if (changed.length === 0) {
    state.input.lastEffect = `no target change @ t=${formatNumber(next.time, 2)}s`;
    return;
  }
  state.input.lastEffect = `${changed.join(', ')} changed @ t=${formatNumber(next.time, 2)}s`;
}

function localVerticalMetrics(sample) {
  if (!sample || !sample.g_raw || !sample.effective_g) {
    return null;
  }

  let ux = Number.isFinite(sample.local_up_x) ? sample.local_up_x : NaN;
  let uy = Number.isFinite(sample.local_up_y) ? sample.local_up_y : NaN;
  let uz = Number.isFinite(sample.local_up_z) ? sample.local_up_z : NaN;
  if (!Number.isFinite(ux) || !Number.isFinite(uy) || !Number.isFinite(uz)) {
    if (!sample.position || !sample.primary_position) {
      return null;
    }
    const rx = sample.position.x - sample.primary_position.x;
    const ry = sample.position.y - sample.primary_position.y;
    const rz = sample.position.z - sample.primary_position.z;
    const rMag = Math.hypot(rx, ry, rz);
    if (!Number.isFinite(rMag) || rMag <= 1e-9) {
      return null;
    }
    ux = rx / rMag;
    uy = ry / rMag;
    uz = rz / rMag;
  }
  const uMag = Math.hypot(ux, uy, uz);
  if (!Number.isFinite(uMag) || uMag <= 1e-9) {
    return null;
  }
  ux /= uMag;
  uy /= uMag;
  uz /= uMag;

  const downRaw = -(sample.g_raw.x * ux + sample.g_raw.y * uy + sample.g_raw.z * uz);
  const downEff = -(sample.effective_g.x * ux + sample.effective_g.y * uy + sample.effective_g.z * uz);
  const ratio = Math.abs(downRaw) > 1e-9 ? downEff / downRaw : NaN;
  return { downRaw, downEff, ratio };
}

function drawSpeedometer(sample) {
  const canvas = state.refs?.speedometerCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(120, canvas.clientWidth);
  const h = Math.max(120, canvas.clientHeight);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const speed = Number.parseFloat(sample?.speed);
  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const minScale = 120;
  const prevScale = Number.isFinite(state.game.speedometerScale) ? state.game.speedometerScale : 400;
  const targetScale = Math.max(minScale, Math.min(6000, Math.max(speedMps * 1.25, prevScale * 0.994)));
  state.game.speedometerScale = targetScale;
  const maxMps = targetScale;
  const ratio = Math.max(0, Math.min(1, speedMps / Math.max(maxMps, 1)));

  const cx = w * 0.5;
  const cy = h * 0.82;
  const r = Math.min(w * 0.42, h * 0.75);
  const compactDial = h < 120 || w < 180;
  const start = Math.PI * 0.78;
  const end = Math.PI * 0.22;
  const sweep = end - start;

  const dial = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r * 1.05);
  dial.addColorStop(0, 'rgba(20, 37, 52, 0.96)');
  dial.addColorStop(0.7, 'rgba(11, 23, 34, 0.98)');
  dial.addColorStop(1, 'rgba(6, 14, 21, 0.99)');
  ctx.fillStyle = dial;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.06, Math.PI, 0);
  ctx.lineTo(cx + (r * 1.06), cy);
  ctx.lineTo(cx - (r * 1.06), cy);
  ctx.closePath();
  ctx.fill();

  const sweepGlow = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  sweepGlow.addColorStop(0, 'rgba(41, 132, 148, 0.08)');
  sweepGlow.addColorStop(Math.max(0.12, ratio * 0.85), 'rgba(73, 207, 224, 0.38)');
  sweepGlow.addColorStop(Math.min(1, ratio + 0.08), 'rgba(255, 151, 87, 0.44)');
  sweepGlow.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
  ctx.strokeStyle = sweepGlow;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, start, end, false);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(144, 201, 214, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, false);
  ctx.stroke();

  const tickCount = compactDial ? 6 : 8;
  const tickFont = compactDial ? 9 : 11;
  const speedFont = compactDial ? 13 : 17;
  const metaFont = compactDial ? 10 : 12;
  ctx.font = `${tickFont}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(228, 240, 243, 0.78)';
  for (let i = 0; i <= tickCount; i += 1) {
    const t = i / tickCount;
    const a = start + (sweep * t);
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const x0 = cx + (cosA * r * 0.78);
    const y0 = cy + (sinA * r * 0.78);
    const x1 = cx + (cosA * r * 0.96);
    const y1 = cy + (sinA * r * 0.96);
    ctx.strokeStyle = 'rgba(171, 214, 222, 0.7)';
    ctx.lineWidth = i % 2 === 0 ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    if (i % 2 === 0) {
      const labelMps = Math.round((maxMps * t) / 10) * 10;
      const lx = cx + (cosA * r * 0.62);
      const ly = cy + (sinA * r * 0.62);
      ctx.textAlign = 'center';
      ctx.fillText(`${labelMps}`, lx, ly + 3);
    }
  }

  const needleAngle = start + (sweep * ratio);
  const needleX = cx + (Math.cos(needleAngle) * r * 0.86);
  const needleY = cy + (Math.sin(needleAngle) * r * 0.86);
  ctx.strokeStyle = 'rgba(255, 149, 83, 0.98)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(needleX, needleY);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 149, 83, 0.98)';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(245, 250, 251, 0.92)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, TWO_PI);
  ctx.fill();

  const kmh = speedMps * 3.6;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(242, 247, 248, 0.92)';
  ctx.font = `600 ${speedFont}px "IBM Plex Mono", monospace`;
  ctx.fillText(`${formatNumber(speedMps, 1)} m/s`, cx, h * 0.56);
  ctx.font = `${metaFont}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(181, 213, 219, 0.8)';
  ctx.fillText(`${formatNumber(kmh, 1)} km/h`, cx, h * 0.63);
  if (!compactDial) {
    ctx.fillText(`scale ${formatNumber(maxMps, 0)} m/s`, cx, h * 0.70);
  }
  ctx.textAlign = 'start';
}

function setStat(key, value) {
  const node = state.refs?.stats?.[key];
  if (!node) {
    return;
  }
  node.textContent = value;
}

function setInputNumber(node, value, digits = 3) {
  if (!node || !Number.isFinite(value)) {
    return;
  }
  node.value = value.toFixed(digits);
}

function currentOscillatorTargets(sample = state.game.latest) {
  return {
    omega: clampNumber(
      readNumberInput(state.refs?.oscOmegaTarget, Number.parseFloat(sample?.control_omega_target)),
      OSC_OMEGA_MIN,
      OSC_OMEGA_MAX,
      80
    ),
    q: clampNumber(
      readNumberInput(state.refs?.oscQTarget, Number.parseFloat(sample?.control_q_target)),
      OSC_Q_MIN,
      OSC_Q_MAX,
      45
    ),
    beta: clampNumber(
      readNumberInput(state.refs?.oscBetaTarget, Number.parseFloat(sample?.control_beta_target)),
      OSC_BETA_MIN,
      OSC_BETA_MAX,
      1.2
    )
  };
}

function currentPlasmaTarget(sample = state.game.latest) {
  return clampNumber(
    readNumberInput(state.refs?.plasmaTarget, Number.parseFloat(sample?.control_plasma_target)),
    PLASMA_MIN,
    PLASMA_MAX,
    0
  );
}

function oscillatorTargetSummary(sample = state.game.latest) {
  const osc = currentOscillatorTargets(sample);
  const plasma = currentPlasmaTarget(sample);
  return `osc:[omega ${formatNumber(osc.omega, 1)} Q ${formatNumber(osc.q, 1)} beta ${formatNumber(osc.beta, 3)} plasma ${formatNumber(plasma, 2)}]`;
}

function updateControlBarReadouts() {
  if (!state.refs?.controlReadouts) {
    return;
  }
  const amp = readNumberInput(state.refs?.holdAmpTarget, NaN);
  const phi = readNumberInput(state.refs?.holdPhiTarget, NaN);
  const yaw = readNumberInput(state.refs?.holdYawTarget, NaN);
  const pitch = readNumberInput(state.refs?.holdPitchTarget, NaN);
  const osc = currentOscillatorTargets();

  if (state.refs.controlReadouts.amp) {
    state.refs.controlReadouts.amp.textContent = formatNumber(amp, 3);
  }
  if (state.refs.controlReadouts.phi) {
    state.refs.controlReadouts.phi.textContent = formatNumber(phi, 3);
  }
  if (state.refs.controlReadouts.yaw) {
    state.refs.controlReadouts.yaw.textContent = formatNumber(yaw, 3);
  }
  if (state.refs.controlReadouts.pitch) {
    state.refs.controlReadouts.pitch.textContent = formatNumber(pitch, 3);
  }
  if (state.refs.controlReadouts.omega) {
    state.refs.controlReadouts.omega.textContent = formatNumber(osc.omega, 2);
  }
  if (state.refs.controlReadouts.q) {
    state.refs.controlReadouts.q.textContent = formatNumber(osc.q, 1);
  }
  if (state.refs.controlReadouts.beta) {
    state.refs.controlReadouts.beta.textContent = formatNumber(osc.beta, 3);
  }
  if (state.refs.controlReadouts.plasma) {
    state.refs.controlReadouts.plasma.textContent = formatNumber(currentPlasmaTarget(), 3);
  }
}

function centerControlBars() {
  if (state.refs?.holdYawTarget) {
    state.refs.holdYawTarget.value = '0';
  }
  if (state.refs?.holdPitchTarget) {
    state.refs.holdPitchTarget.value = '0';
  }
  updateControlBarReadouts();
  setStatus('warp setpoint centered');
}

function syncControlBarsToSample(sample) {
  if (!sample) {
    return;
  }
  setInputNumber(state.refs?.holdAmpTarget, Number.parseFloat(sample.control_amp_target), 3);
  setInputNumber(state.refs?.holdPhiTarget, Number.parseFloat(sample.control_theta_target), 3);
  setInputNumber(state.refs?.oscOmegaTarget, Number.parseFloat(sample.control_omega_target), 1);
  setInputNumber(state.refs?.oscQTarget, Number.parseFloat(sample.control_q_target), 0);
  setInputNumber(state.refs?.oscBetaTarget, Number.parseFloat(sample.control_beta_target), 2);
  setInputNumber(state.refs?.plasmaTarget, Number.parseFloat(sample.control_plasma_target), 2);
  setInputNumber(state.refs?.holdYawTarget, Number.parseFloat(sample.control_axis_yaw), 3);
  setInputNumber(state.refs?.holdPitchTarget, Number.parseFloat(sample.control_axis_pitch), 3);
  updateControlBarReadouts();
}

function nudgeRangeInput(node, step, min, max, digits = 3) {
  if (!node || !Number.isFinite(step)) {
    return NaN;
  }
  const curr = readNumberInput(node, 0);
  const next = clampNumber(curr + step, min, max, curr);
  node.value = next.toFixed(digits);
  return next;
}

function nudgeControlBarsFromKey(key, shift = false) {
  const coarse = shift ? 3 : 1;
  let result = NaN;
  let label = '';
  switch (key) {
    case 'a':
      result = nudgeRangeInput(state.refs?.holdAmpTarget, -0.2 * coarse, 0, 24, 3);
      label = 'amp';
      break;
    case 'd':
      result = nudgeRangeInput(state.refs?.holdAmpTarget, 0.2 * coarse, 0, 24, 3);
      label = 'amp';
      break;
    case 's':
      result = nudgeRangeInput(state.refs?.holdPhiTarget, -0.08 * coarse, -Math.PI, Math.PI, 3);
      label = 'phase';
      break;
    case 'w':
      result = nudgeRangeInput(state.refs?.holdPhiTarget, 0.08 * coarse, -Math.PI, Math.PI, 3);
      label = 'phase';
      break;
    case 'q':
      result = nudgeRangeInput(state.refs?.holdYawTarget, -0.06 * coarse, -Math.PI, Math.PI, 3);
      label = 'yaw';
      break;
    case 'e':
      result = nudgeRangeInput(state.refs?.holdYawTarget, 0.06 * coarse, -Math.PI, Math.PI, 3);
      label = 'yaw';
      break;
    case 'k':
      result = nudgeRangeInput(state.refs?.holdPitchTarget, -0.05 * coarse, -1.53, 1.53, 3);
      label = 'pitch';
      break;
    case 'i':
      result = nudgeRangeInput(state.refs?.holdPitchTarget, 0.05 * coarse, -1.53, 1.53, 3);
      label = 'pitch';
      break;
    default:
      return false;
  }

  updateControlBarReadouts();
  if (label) {
    state.input.lastNudge = `${label}=${formatNumber(result, 3)}${shift ? ' (coarse)' : ''}`;
    setStatus(`nudge ${state.input.lastNudge}`);
  }
  return true;
}

function releaseAllKeys() {
  const keys = state.input.keys || {};
  for (const key of Object.keys(keys)) {
    keys[key] = false;
  }
  state.input.activeInput = `locks:[A ${state.refs?.holdAmpEnabled?.checked ? 'on' : 'off'} Φ ${state.refs?.holdPhiEnabled?.checked ? 'on' : 'off'} Y ${state.refs?.holdYawEnabled?.checked ? 'on' : 'off'} P ${state.refs?.holdPitchEnabled?.checked ? 'on' : 'off'}] | targets:[A ${formatNumber(readNumberInput(state.refs?.holdAmpTarget, NaN), 3)} Φ ${formatNumber(readNumberInput(state.refs?.holdPhiTarget, NaN), 3)} Y ${formatNumber(readNumberInput(state.refs?.holdYawTarget, NaN), 3)} P ${formatNumber(readNumberInput(state.refs?.holdPitchTarget, NaN), 3)}] | ${oscillatorTargetSummary()} | final:[A 0.00 Φ 0.00 Y 0.00 P 0.00] | nudge:${state.input.lastNudge || 'none'}`;
}

function captureCurrentTargets() {
  const sample = state.game.latest;
  if (!sample) {
    setStatus('no sample to capture yet');
    return;
  }
  syncControlBarsToSample(sample);
  setStatus('captured current coupler targets');
}

function applyAssistPreset(name) {
  const key = String(name || '').toLowerCase();
  if (!state.refs) {
    return;
  }
  state.input.lockAssist = true;
  if (state.refs.autoTrim) {
    state.refs.autoTrim.checked = true;
  }

  switch (key) {
    case 'hover':
      setInputNumber(state.refs.autoWeight, 0.0, 2);
      setInputNumber(state.refs.autoVertical, 0.0, 2);
      setStatus('assist preset: hover');
      break;
    case 'neutral':
      setInputNumber(state.refs.autoWeight, 1.0, 2);
      setInputNumber(state.refs.autoVertical, 0.0, 2);
      setStatus('assist preset: normal-g');
      break;
    case 'ascend':
      setInputNumber(state.refs.autoWeight, -0.15, 2);
      setInputNumber(state.refs.autoVertical, 4.0, 2);
      setStatus('assist preset: ascend');
      break;
    case 'descend':
      setInputNumber(state.refs.autoWeight, 1.2, 2);
      setInputNumber(state.refs.autoVertical, -3.0, 2);
      setStatus('assist preset: descend');
      break;
    default:
      break;
  }
}

function updateHUD(sample) {
  if (!state.refs || !state.refs.stats) {
    return;
  }
  drawSpeedometer(sample);
  if (!sample) {
    for (const key of Object.keys(state.refs.stats)) {
      setStat(key, '-');
    }
    setStat('map_mode', currentMapMode());
    setStat('ship', selectedShipType());
    setStat('planet', selectedPlanetPreset());
    setStat('model', warpDriveLabel(selectedWarpDrive()));
    setStat('craft_scale', `${formatNumber(currentCraftScale(), 2)} x`);
    setStat('craft_span', `${formatNumber(craftSpanMetersFromScale(currentCraftScale()), 1)} m`);
    setStat('pilot_lock_cmd', state.input.lockAssist ? 'on' : 'off');
    setStat('pilot_auto_trim', state.refs?.autoTrim?.checked ? 'on' : 'off');
    setStat('pilot_active_input', state.input.activeInput || 'none');
    setStat('pilot_last_effect', state.input.lastEffect || 'none');
    setStat('view_speed_sub', 'km/h | vz');
    setStat('view_power_required_sub', 'field | climb | plasma');
    setStat('view_power_draw_sub', 'spec | hp');
    setStat('view_altitude', '-');
    setStat('view_weight', '-');
    setStat('view_lock', state.input.lockAssist ? 'cmd on' : '-');
    return;
  }

  setStat('time', `${formatNumber(sample.time, 2)} s`);
  setStat('step', `${sample.step}`);
  setStat('altitude', `${formatNumber(sample.altitude, 1)} m`);
  setStat('speed', `${formatNumber(sample.speed, 2)} m/s`);
  setStat('vertical', `${formatNumber(sample.vertical_vel, 2)} m/s`);
  const modelLabel = sample.warp_drive
    ? (String(sample.warp_drive).toLowerCase() === 'scenario_default'
      ? `${sample.gravity_model || '-'} • scenario default`
      : `${warpDriveLabel(sample.warp_drive)} • ${sample.gravity_model || '-'}${sample.coupler_enabled ? '' : ' off'}`)
    : (sample.coupler_enabled
      ? `${sample.gravity_model || '-'} (coupler on)`
      : `${sample.gravity_model || '-'} (coupler off)`);
  setStat('model', modelLabel);
  setStat('ship', String(sample.ship_type || 'saucer').toLowerCase());
  setStat('planet', String(sample.primary_name || selectedPlanetPreset()).toLowerCase());
  setStat('map_mode', currentMapMode());
  const craftScale = Number.parseFloat(sample.craft_scale);
  const appliedScale = Number.isFinite(craftScale) ? craftScale : currentCraftScale();
  const craftSpanM = Number.parseFloat(sample.craft_span_m);
  const appliedSpanM = Number.isFinite(craftSpanM) ? craftSpanM : craftSpanMetersFromScale(appliedScale);
  setStat('craft_scale', `${formatNumber(appliedScale, 2)} x`);
  setStat('craft_span', `${formatNumber(appliedSpanM, 1)} m`);

  const mass = Number.parseFloat(sample.craft_mass);
  const vertical = localVerticalMetrics(sample);
  const downRaw = vertical ? vertical.downRaw : NaN;
  const downEff = vertical ? vertical.downEff : NaN;
  const weightN = Number.isFinite(mass) && Number.isFinite(downEff) ? (mass * downEff) : NaN;
  const weightKGF = Number.isFinite(weightN) ? (weightN / 9.80665) : NaN;
  const thetaTarget = Number.parseFloat(sample.control_theta_target);
  const thetaCycle = Number.isFinite(thetaTarget) ? phaseCycle(thetaTarget) : NaN;
  const drivePower = Number.parseFloat(sample.drive_power);
  const plasmaPower = Number.parseFloat(sample.plasma_power);
  const gravPower = Number.parseFloat(sample.grav_power);
  const energyRemainingJ = Number.parseFloat(sample.energy);
  const horizonMin = clampNumber(readNumberInput(state.refs?.energyHorizon, 10), 1, 720, 10);
  const specificPower = Number.isFinite(drivePower) && Number.isFinite(mass) && mass > 0 ? (drivePower / mass) : NaN;
  const kWhPerHour = Number.isFinite(drivePower) ? (drivePower / 1000) : NaN;
  const mjPerMin = Number.isFinite(drivePower) ? ((drivePower * 60) / 1e6) : NaN;
  const missionEnergyJ = Number.isFinite(drivePower) ? (drivePower * horizonMin * 60) : NaN;
  const missionKWh = Number.isFinite(missionEnergyJ) ? (missionEnergyJ / 3.6e6) : NaN;
  const batteryNeed100KWh = Number.isFinite(missionKWh) ? (missionKWh / 100) : NaN;
  const gasolineEqLh = Number.isFinite(kWhPerHour) ? (kWhPerHour / 8.9) : NaN;
  const horsepower = Number.isFinite(drivePower) ? (drivePower * 0.00134102209) : NaN;
  const verticalVel = Number.parseFloat(sample.vertical_vel);
  const climbMinPower = Number.isFinite(mass) && Number.isFinite(downRaw) && Number.isFinite(verticalVel)
    ? (mass * downRaw * Math.max(0, verticalVel))
    : NaN;
  const climbToDriveRatio = Number.isFinite(climbMinPower) && Number.isFinite(drivePower) && Math.abs(drivePower) > 1e-9
    ? (climbMinPower / drivePower)
    : NaN;
  const fieldWorkRate = Number.isFinite(gravPower) ? Math.abs(gravPower) : NaN;
  const requiredCandidates = [];
  if (Number.isFinite(drivePower)) {
    requiredCandidates.push(Math.abs(drivePower));
  }
  if (Number.isFinite(climbMinPower)) {
    requiredCandidates.push(Math.abs(climbMinPower));
  }
  if (Number.isFinite(fieldWorkRate)) {
    requiredCandidates.push(fieldWorkRate);
  }
  const requiredCorePower = requiredCandidates.length ? Math.max(...requiredCandidates) : NaN;
  const requiredPowerNow = Number.isFinite(requiredCorePower) || Number.isFinite(plasmaPower)
    ? (Math.max(0, requiredCorePower || 0) + Math.max(0, plasmaPower || 0))
    : NaN;
  const energyInitialJ = state.game.initialEnergy;
  const runUsedJ = Number.isFinite(energyInitialJ) && Number.isFinite(energyRemainingJ)
    ? Math.max(0, energyInitialJ - energyRemainingJ)
    : NaN;
  const runRemainingPct = Number.isFinite(energyInitialJ) && energyInitialJ > 0 && Number.isFinite(energyRemainingJ)
    ? ((energyRemainingJ / energyInitialJ) * 100)
    : NaN;

  setStat('mass', `${formatNumber(mass, 1)} kg`);
  setStat('weight_n', `${formatNumber(weightN, 1)} N`);
  setStat('weight_kgf', `${formatNumber(weightKGF, 2)} kgf`);
  setStat('weight_ratio', `${formatNumber(vertical ? vertical.ratio : NaN, 3)} x`);
  setStat('down_g_raw', `${formatNumber(downRaw, 3)} m/s^2`);
  setStat('down_g_eff', `${formatNumber(downEff, 3)} m/s^2`);
  setStat('view_speed_main', formatVelocityCompact(sample.speed));
  setStat('view_speed_sub', `${formatKmhCompact(sample.speed)} | vz ${formatVelocityCompact(sample.vertical_vel)}`);
  setStat('view_power_required', formatPowerCompact(requiredPowerNow));
  setStat('view_power_required_sub', `field ${formatPowerCompact(fieldWorkRate)} | climb ${formatPowerCompact(climbMinPower)} | plasma ${formatPowerCompact(plasmaPower)}`);
  setStat('view_power_draw', formatPowerCompact(drivePower));
  setStat('view_power_draw_sub', `${formatSpecificPowerCompact(specificPower)} | ${formatCompactNumber(horsepower, 1)} hp`);
  setStat('view_altitude', formatDistanceCompact(sample.altitude));
  setStat('view_weight', `${formatCompactNumber(vertical ? vertical.ratio : NaN, 3)} xg`);
  setStat('view_lock', `${formatCompactNumber(sample.lock_quality, 3)} ${sample.lock_flag ? 'lock' : 'open'}`);

  setStat('c', formatNumber(sample.coupling_c, 4));
  setStat('k', formatNumber(sample.coupling_k, 4));
  setStat('phi', formatNumber(sample.coupling_phi, 4));
  setStat('res_omega0', `${formatNumber(sample.resonator_omega0, 2)} rad/s`);
  setStat('res_q', formatNumber(sample.resonator_q, 1));
  setStat('res_beta', formatNumber(sample.resonator_beta, 3));
  setStat('phase', formatNumber(sample.phase_error, 4));
  setStat('lock', `${formatNumber(sample.lock_quality, 4)} (${sample.lock_flag ? 'lock' : 'open'})`);
  setStat('runaway', sample.runaway_flag ? 'flagged' : 'clear');

  setStat('drive_amp', formatNumber(sample.drive_amp, 4));
  setStat('drive_omega', `${formatNumber(sample.drive_omega, 3)} rad/s`);
  setStat('omega_base', `${formatNumber(sample.omega_base, 3)} rad/s`);
  setStat('drive_phase', formatNumber(sample.drive_phase, 4));
  setStat('pll_delta', `${formatNumber(sample.pll_freq_delta, 4)} rad/s`);
  setStat('osc_mag', formatNumber(sample.osc_mag, 4));

  setStat('power', `${formatNumber(sample.drive_power, 0)} W`);
  setStat('energy', `${formatNumber(sample.energy, 0)} W*s`);
  setStat('energy_power', `${formatPower(drivePower)} (${formatNumber(horsepower, 1)} hp)`);
  setStat('energy_specific', `${formatNumber(specificPower, 2)} W/kg`);
  setStat('energy_rate', `${formatNumber(kWhPerHour, 3)} kWh/h • ${formatNumber(mjPerMin, 3)} MJ/min`);
  setStat('energy_mission', `${formatNumber(horizonMin, 0)} min -> ${formatNumber(missionKWh, 3)} kWh (${formatEnergy(missionEnergyJ)})`);
  setStat('energy_battery', `${formatNumber(batteryNeed100KWh, 3)} x 100 kWh`);
  setStat('energy_fuel_eq', `${formatNumber(gasolineEqLh, 3)} L/h gasoline-eq`);
  setStat('energy_run_used', `${formatEnergy(runUsedJ)} (${formatNumber(runUsedJ / 3.6e6, 3)} kWh)`);
  setStat('energy_run_remaining', `${formatEnergy(energyRemainingJ)} (${formatNumber(runRemainingPct, 1)}%)`);
  setStat('energy_climb_min', formatPower(climbMinPower));
  setStat('energy_climb_ratio', `${formatNumber(climbToDriveRatio * 100, 1)}%`);
  setStat('atm_enabled', sample.atmosphere_enabled ? 'on' : 'off');
  setStat('atm_rho0', `${formatCompactNumber(sample.atmosphere_rho0, 3)} kg/m^3`);
  setStat('atm_scale_height', formatDistanceCompact(sample.atmosphere_scale_height));
  setStat('plasma_target', formatNumber(sample.control_plasma_target, 3));
  setStat('plasma_reduction', formatPercentCompact(sample.plasma_drag_reduction));
  setStat('plasma_power', formatPower(sample.plasma_power));
  setStat('drag_force', `${formatNumber(sample.drag_force_mag, 1)} N`);
  setStat('drag_power', formatPower(sample.drag_power));
  setStat('drag_cd_eff', formatNumber(sample.drag_cd_eff, 3));
  setStat('drag_area_ref', `${formatNumber(sample.drag_area_ref, 2)} m^2`);
  setStat('amp_target', formatNumber(sample.control_amp_target, 3));
  setStat('theta_target', `${formatNumber(thetaTarget, 3)} rad`);
  setStat('theta_cycle', `${formatNumber(thetaCycle, 3)} cyc`);
  setStat('omega_target', `${formatNumber(sample.control_omega_target, 2)} rad/s`);
  setStat('q_target', formatNumber(sample.control_q_target, 1));
  setStat('beta_target', formatNumber(sample.control_beta_target, 3));
  setStat('plasma_target_control', formatNumber(sample.control_plasma_target, 3));
  setStat('axis_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('axis_pitch', formatNumber(sample.control_axis_pitch, 3));
  setStat('warp_x', formatNumber(sample.control_warp_x, 3));
  setStat('warp_y', formatNumber(sample.control_warp_y, 3));
  setStat('warp_z', formatNumber(sample.control_warp_z, 3));
  setStat('lock_assist', sample.control_lock_assist ? 'on' : 'off');
  setStat('amp_axis', formatNumber(sample.control_amp_axis, 2));
  setStat('phi_axis', formatNumber(sample.control_phi_axis, 2));
  setStat('yaw_axis', formatNumber(sample.control_yaw_axis, 2));
  setStat('pitch_axis', formatNumber(sample.control_pitch_axis, 2));
  setStat('pilot_set_amp', formatNumber(sample.control_amp_target, 3));
  setStat('pilot_set_phase', `${formatNumber(thetaCycle, 3)} cyc (${formatNumber(thetaTarget, 3)} rad)`);
  setStat('pilot_set_yaw', formatNumber(sample.control_axis_yaw, 3));
  setStat('pilot_set_pitch', formatNumber(sample.control_axis_pitch, 3));
  setStat('pilot_lock_cmd', state.input.lockAssist ? 'on' : 'off');
  setStat('pilot_auto_trim', state.refs?.autoTrim?.checked ? 'on' : 'off');
  setStat('pilot_active_input', state.input.activeInput || 'none');
  setStat('pilot_last_effect', state.input.lastEffect || 'none');

  const last = state.input.lastControl || {};
  setStat('control_mode', last.mode || 'manual');
  setStat('manual_amp', formatNumber(last.manualAmp, 2));
  setStat('manual_phi', formatNumber(last.manualPhi, 2));
  setStat('manual_yaw', formatNumber(last.manualYaw, 2));
  setStat('manual_pitch', formatNumber(last.manualPitch, 2));
  setStat('auto_amp', formatNumber(last.autoAmp, 2));
  setStat('auto_phi', formatNumber(last.autoPhi, 2));
  setStat('auto_yaw', formatNumber(last.autoYaw, 2));
  setStat('auto_pitch', formatNumber(last.autoPitch, 2));
}

function pushTrail(sample) {
  if (!sample || !sample.position) {
    return;
  }
  const rx = Number.isFinite(sample.position?.x) && Number.isFinite(sample.primary_position?.x)
    ? (sample.position.x - sample.primary_position.x)
    : 0;
  const ry = Number.isFinite(sample.position?.y) && Number.isFinite(sample.primary_position?.y)
    ? (sample.position.y - sample.primary_position.y)
    : 0;
  const rz = Number.isFinite(sample.position?.z) && Number.isFinite(sample.primary_position?.z)
    ? (sample.position.z - sample.primary_position.z)
    : 0;
  state.game.trailTop.push({
    x: sample.position.x,
    y: sample.position.y,
    rx,
    ry,
    rz
  });
  state.game.trailSide.push({
    x: sample.position.x,
    z: sample.position.z,
    alt: sample.altitude,
    rx,
    ry,
    rz
  });
  state.game.trail3D.push({
    x: sample.position.x,
    y: sample.position.y,
    z: sample.position.z,
    alt: sample.altitude,
    rx,
    ry,
    rz
  });

  while (state.game.trailTop.length > state.game.maxTrail) {
    state.game.trailTop.shift();
  }
  while (state.game.trailSide.length > state.game.maxTrail) {
    state.game.trailSide.shift();
  }
  while (state.game.trail3D.length > state.game.maxTrail) {
    state.game.trail3D.shift();
  }
}

function clearTrails() {
  state.game.trailTop = [];
  state.game.trailSide = [];
  state.game.trail3D = [];
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
  const warpDrive = selectedWarpDrive();
  const shipType = selectedShipType();
  const craftScale = currentCraftScale();
  const planetPreset = selectedPlanetPreset();
  state.game.mapMode = currentMapMode();
  setStatus(`starting ${scenario} • ${warpDriveLabel(warpDrive)}...`);
  const startOnGround = Boolean(state.refs?.startGround?.checked);

  try {
    const payload = await apiPost('/api/game/start', {
      scenario,
      start_on_ground: startOnGround,
      ship_type: shipType,
      warp_drive: warpDrive,
      planet_preset: planetPreset,
      craft_scale: craftScale
    });
    state.game.sessionId = payload.session_id || '';
    state.game.dt = Number.parseFloat(payload.dt) || Number.parseFloat(payload?.state?.dt) || (1 / 120);
    state.game.running = true;
    state.game.paused = false;
    state.game.requestInFlight = false;
    state.game.lastFrameTs = 0;
    state.game.accumulator = 0;
    state.game.latest = payload.state || null;
    state.game.initialEnergy = Number.parseFloat(state.game.latest?.energy);
    if (!Number.isFinite(state.game.initialEnergy)) {
      state.game.initialEnergy = NaN;
    }
    syncControlBarsToSample(state.game.latest);
    clearTrails();
    pushTrail(state.game.latest);
    state.input.lockAssist = Boolean(state.game.latest?.control_lock_assist);
    state.input.lastControl = {
      mode: 'manual',
      manualAmp: 0,
      manualPhi: 0,
      manualYaw: 0,
      manualPitch: 0,
      autoAmp: 0,
      autoPhi: 0,
      autoYaw: 0,
      autoPitch: 0,
      finalAmp: 0,
      finalPhi: 0,
      finalYaw: 0,
      finalPitch: 0
    };
    state.input.lastNudge = 'none';
    state.input.activeInput = `locks:[A on Φ on Y on P on] | targets:[A - Φ - Y - P -] | ${oscillatorTargetSummary(state.game.latest)} | final:[A 0.00 Φ 0.00 Y 0.00 P 0.00] | nudge:none`;
    updateControlEffect(null, state.game.latest);
    if (state.refs?.pauseButton) {
      state.refs.pauseButton.textContent = 'Pause';
    }
    updateHUD(state.game.latest);
    if (state.renderer) {
      state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
    }
    const mode = String(state.game.latest?.gravity_model || '').toLowerCase();
    const couplerEnabled = Boolean(state.game.latest?.coupler_enabled);
    if (!couplerEnabled) {
      setStatus(`running ${scenario} • coupler off • pilot/assist controls are telemetry-only here`);
    } else if (mode && mode !== 'coupling') {
      setStatus(`running ${scenario} • ${mode} model • coupler controls are telemetry-only here`);
    } else {
      setStatus(`running ${scenario} • planet=${planetPreset} • ship=${shipType} • scale=${formatNumber(craftScale, 2)}x • map=${state.game.mapMode} • dt=${state.game.dt.toFixed(4)} s • ${startOnGround ? 'ground start' : 'scenario start'}`);
    }
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
  state.game.initialEnergy = NaN;
  state.game.speedometerScale = 400;
  if (state.game.rafId) {
    window.cancelAnimationFrame(state.game.rafId);
    state.game.rafId = 0;
  }
  if (state.refs?.pauseButton) {
    state.refs.pauseButton.textContent = 'Pause';
  }
  state.input.activeInput = 'none';
  state.input.lastEffect = 'none';
  state.input.lastNudge = 'none';
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

function currentControlPayload(sample = state.game.latest) {
  const manualAmp = 0;
  const manualPhi = 0;
  const manualYaw = 0;
  const manualPitch = 0;
  const oscTargets = currentOscillatorTargets(sample);
  const plasmaTarget = currentPlasmaTarget(sample);

  let autoAmp = 0;
  let autoPhi = 0;
  let autoYaw = 0;
  let autoPitch = 0;
  let mode = 'manual';

  const couplerEnabled = Boolean(sample?.coupler_enabled);
  const couplingModel = String(sample?.gravity_model || '').toLowerCase() === 'coupling';
  const canAssist = couplerEnabled && couplingModel;

  const holdAmpEnabled = Boolean(state.refs?.holdAmpEnabled?.checked);
  const holdPhiEnabled = Boolean(state.refs?.holdPhiEnabled?.checked);
  const holdYawEnabled = Boolean(state.refs?.holdYawEnabled?.checked);
  const holdPitchEnabled = Boolean(state.refs?.holdPitchEnabled?.checked);
  const targetAssistEnabled = canAssist && (holdAmpEnabled || holdPhiEnabled || holdYawEnabled || holdPitchEnabled);
  const autoTrimRequested = Boolean(state.refs?.autoTrim?.checked);
  const autoTrimEnabled = autoTrimRequested && canAssist && state.input.lockAssist;

  if (targetAssistEnabled) {
    const ampTarget = readNumberInput(state.refs?.holdAmpTarget, Number.parseFloat(sample?.control_amp_target));
    const phiTarget = readNumberInput(state.refs?.holdPhiTarget, Number.parseFloat(sample?.control_theta_target));
    const yawTarget = readNumberInput(state.refs?.holdYawTarget, Number.parseFloat(sample?.control_axis_yaw));
    const pitchTarget = readNumberInput(state.refs?.holdPitchTarget, Number.parseFloat(sample?.control_axis_pitch));

    const ampCurrent = Number.parseFloat(sample?.control_amp_target);
    const phiCurrent = Number.parseFloat(sample?.control_theta_target);
    const yawCurrent = Number.parseFloat(sample?.control_axis_yaw);
    const pitchCurrent = Number.parseFloat(sample?.control_axis_pitch);

    if (holdAmpEnabled && Number.isFinite(ampTarget) && Number.isFinite(ampCurrent) && !autoTrimEnabled) {
      autoAmp += clampUnit((ampTarget - ampCurrent) / 0.35);
    }
    if (holdPhiEnabled && Number.isFinite(phiTarget) && Number.isFinite(phiCurrent) && !autoTrimEnabled) {
      autoPhi += clampUnit((phiTarget - phiCurrent) / 0.6);
    }
    if (holdYawEnabled && Number.isFinite(yawTarget) && Number.isFinite(yawCurrent)) {
      autoYaw += clampUnit(wrapRadians(yawTarget - yawCurrent) / 0.6);
    }
    if (holdPitchEnabled && Number.isFinite(pitchTarget) && Number.isFinite(pitchCurrent)) {
      autoPitch += clampUnit((pitchTarget - pitchCurrent) / 0.45);
    }

    if (!autoTrimEnabled) {
      mode = 'assist-targets';
    }
  }

  if (autoTrimEnabled) {
    const vertical = localVerticalMetrics(sample);
    const weightRatio = vertical ? vertical.ratio : NaN;
    const targetWeight = readNumberInput(state.refs?.autoWeight, 1.0);
    const targetVertical = readNumberInput(state.refs?.autoVertical, 0.0);
    const verticalVel = Number.parseFloat(sample?.vertical_vel);
    const lockQuality = Number.parseFloat(sample?.lock_quality);

    const weightErrRaw = Number.isFinite(weightRatio) ? (targetWeight - weightRatio) : 0;
    const verticalErrRaw = Number.isFinite(verticalVel) ? (targetVertical - verticalVel) : 0;
    const lockErrRaw = Number.isFinite(lockQuality) ? (0.9 - lockQuality) : 0;

    const weightErr = clampNumber(weightErrRaw, -2.5, 2.5, 0);
    const verticalErr = clampNumber(verticalErrRaw, -20, 20, 0);
    const lockErr = clampNumber(lockErrRaw, -1, 1, 0);

    if (Math.abs(weightErr) > 0.02 || Math.abs(verticalErr) > 0.08) {
      autoPhi += clampUnit((weightErr * 0.35) + (verticalErr * 0.018));
    }
    autoAmp += clampUnit(lockErr * 0.7);

    const pitchCurrent = Number.parseFloat(sample?.control_axis_pitch);
    if (Number.isFinite(pitchCurrent)) {
      // In planetary mode, neutral warp is local vertical. Auto trim only
      // needs to relax tilt back toward zero; azimuth can stay user-directed.
      autoPitch += clampUnit((-pitchCurrent) / 0.65) * 0.55;
    }
    mode = 'assist-ship';
  } else if (autoTrimRequested && canAssist && !state.input.lockAssist) {
    mode = 'assist-ship (lock off)';
  }

  const ampAxis = clampUnit(manualAmp + autoAmp);
  const phiAxis = clampUnit(manualPhi + autoPhi);
  const yawAxis = clampUnit(manualYaw + autoYaw);
  const pitchAxis = clampUnit(manualPitch + autoPitch);

  state.input.lastControl = {
    mode,
    manualAmp,
    manualPhi,
    manualYaw,
    manualPitch,
    autoAmp,
    autoPhi,
    autoYaw,
    autoPitch,
    finalAmp: ampAxis,
    finalPhi: phiAxis,
    finalYaw: yawAxis,
    finalPitch: pitchAxis
  };
  const ampTarget = readNumberInput(state.refs?.holdAmpTarget, Number.parseFloat(sample?.control_amp_target));
  const phiTarget = readNumberInput(state.refs?.holdPhiTarget, Number.parseFloat(sample?.control_theta_target));
  const yawTarget = readNumberInput(state.refs?.holdYawTarget, Number.parseFloat(sample?.control_axis_yaw));
  const pitchTarget = readNumberInput(state.refs?.holdPitchTarget, Number.parseFloat(sample?.control_axis_pitch));
  state.input.activeInput = `locks:[A ${holdAmpEnabled ? 'on' : 'off'} Φ ${holdPhiEnabled ? 'on' : 'off'} Y ${holdYawEnabled ? 'on' : 'off'} P ${holdPitchEnabled ? 'on' : 'off'}] | targets:[A ${formatNumber(ampTarget, 3)} Φ ${formatNumber(phiTarget, 3)} Y ${formatNumber(yawTarget, 3)} P ${formatNumber(pitchTarget, 3)}] | ${oscillatorTargetSummary(sample)} | final:[A ${formatNumber(ampAxis, 2)} Φ ${formatNumber(phiAxis, 2)} Y ${formatNumber(yawAxis, 2)} P ${formatNumber(pitchAxis, 2)}] | nudge:${state.input.lastNudge || 'none'}`;

  return {
    amp_axis: ampAxis,
    phi_axis: phiAxis,
    yaw_axis: yawAxis,
    pitch_axis: pitchAxis,
    omega_target: oscTargets.omega,
    q_target: oscTargets.q,
    beta_target: oscTargets.beta,
    plasma_target: plasmaTarget,
    lock_assist: state.input.lockAssist
  };
}

async function requestStep(steps) {
  if (!state.game.running || state.game.requestInFlight || !state.game.sessionId) {
    return;
  }

  state.game.requestInFlight = true;
  try {
    const prevSample = state.game.latest;
    const payload = await apiPost('/api/game/step', {
      session_id: state.game.sessionId,
      steps,
      controls: currentControlPayload(state.game.latest)
    });
    const sample = payload?.state || null;
    if (!sample) {
      throw new Error('empty step response');
    }
    state.game.latest = sample;
    updateControlEffect(prevSample, sample);
    pushTrail(sample);
    updateHUD(sample);
    const vertical = localVerticalMetrics(sample);
    const ratio = vertical ? formatNumber(vertical.ratio, 3) : '-';
    const mode = state.input.lastControl?.mode || 'manual';
    setStatus(`running • t=${formatNumber(sample.time, 2)}s • C=${formatNumber(sample.coupling_c, 3)} • W=${ratio}x • ${mode}`);
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
    state.renderer.setPlanetaryCamera(currentPlanetaryZoom(), currentPlanetaryCameraMode());
    state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
  }
  state.game.rafId = window.requestAnimationFrame(gameLoop);
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || target.isContentEditable;
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-guide-open]')) {
      event.preventDefault();
      openGuideModal();
      return;
    }

    if (event.target.closest('[data-guide-close]')) {
      event.preventDefault();
      closeGuideModal();
      return;
    }

    if (event.target instanceof Element && event.target.matches('[data-guide-modal]')) {
      event.preventDefault();
      closeGuideModal();
      return;
    }

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

    if (event.target.closest('[data-control-bars-center]')) {
      event.preventDefault();
      centerControlBars();
      return;
    }

    if (event.target.closest('[data-hold-capture]')) {
      event.preventDefault();
      captureCurrentTargets();
      return;
    }

    const presetButton = event.target.closest('[data-assist-preset]');
    if (presetButton) {
      event.preventDefault();
      const preset = presetButton.getAttribute('data-assist-preset') || '';
      applyAssistPreset(preset);
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
    const key = (event.key || '').toLowerCase();
    if (key === 'escape' && isGuideModalOpen()) {
      event.preventDefault();
      closeGuideModal();
      return;
    }
    if (isGuideModalOpen()) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        state.input.lockAssist = !state.input.lockAssist;
        setStatus(`lock assist ${state.input.lockAssist ? 'on' : 'off'}`);
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
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key === 'i' || key === 'k') {
      event.preventDefault();
      nudgeControlBarsFromKey(key, Boolean(event.shiftKey));
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = (event.key || '').toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key === 'i' || key === 'k') {
      event.preventDefault();
      state.input.keys[key] = false;
    }
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.matches('[data-map-mode]')) {
      state.game.mapMode = currentMapMode();
      updateHUD(state.game.latest);
      if (state.renderer) {
        state.renderer.setPlanetaryCamera(currentPlanetaryZoom(), currentPlanetaryCameraMode());
        state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
      }
      return;
    }
    if (target.matches('[data-planetary-camera]') || target.matches('[data-planetary-zoom]')) {
      if (state.renderer) {
        state.renderer.setPlanetaryCamera(currentPlanetaryZoom(), currentPlanetaryCameraMode());
        state.renderer.draw(state.game.latest, state.game.trailTop, state.game.trailSide, state.game.trail3D, currentMapMode());
      }
      return;
    }
    if (target.matches('[data-planet-preset]')) {
      updateHUD(state.game.latest);
      return;
    }
    if (target.matches('[data-warp-drive]')) {
      updateHUD(state.game.latest);
      if (state.game.running) {
        setStatus(`${warpDriveLabel(selectedWarpDrive())} selected • reset/start session to apply`);
      }
      return;
    }
    if (target.matches('[data-craft-scale]')) {
      updateCraftScaleReadout();
      updateHUD(state.game.latest);
      if (state.game.running) {
        setStatus(`craft scale set to ${formatNumber(currentCraftScale(), 2)}x • reset/start session to apply`);
      }
      return;
    }
    if (target.matches('[data-ship-type]')) {
      updateHUD(state.game.latest);
      return;
    }
    if (
      target.matches('[data-hold-amp-target]') ||
      target.matches('[data-hold-phi-target]') ||
      target.matches('[data-osc-omega-target]') ||
      target.matches('[data-osc-q-target]') ||
      target.matches('[data-osc-beta-target]') ||
      target.matches('[data-plasma-target]') ||
      target.matches('[data-hold-yaw-target]') ||
      target.matches('[data-hold-pitch-target]') ||
      target.matches('[data-hold-amp-enabled]') ||
      target.matches('[data-hold-phi-enabled]') ||
      target.matches('[data-hold-yaw-enabled]') ||
      target.matches('[data-hold-pitch-enabled]')
    ) {
      updateControlBarReadouts();
      updateHUD(state.game.latest);
    }
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.matches('[data-craft-scale]') ||
      target.matches('[data-hold-amp-target]') ||
      target.matches('[data-hold-phi-target]') ||
      target.matches('[data-osc-omega-target]') ||
      target.matches('[data-osc-q-target]') ||
      target.matches('[data-osc-beta-target]') ||
      target.matches('[data-plasma-target]') ||
      target.matches('[data-hold-yaw-target]') ||
      target.matches('[data-hold-pitch-target]')
    ) {
      if (target.matches('[data-craft-scale]')) {
        updateCraftScaleReadout();
        updateHUD(state.game.latest);
      }
      updateControlBarReadouts();
    }
  }, true);

  document.addEventListener('gx:updated', () => {
    normalizePaperNavSelection();
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

  window.addEventListener('blur', () => {
    releaseAllKeys();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      releaseAllKeys();
    }
  });
}

async function boot() {
  ensureRecyclrMount();
  normalizePaperNavSelection();
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
