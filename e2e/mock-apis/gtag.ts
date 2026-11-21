/**
 * The GA4 side of the e2e world (PLAN Addendum 2, scenario V19): what www.googletagmanager.com and the Firebase
 * config endpoint answer, so the viewer's real Firebase Analytics SDK runs end to end and every event it logs becomes
 * a recorded `POST https://region1.google-analytics.com/g/collect` call.
 *
 * `GTAG_SCRIPT` stands in for gtag.js: it reads the data layer Firebase writes (`gtag('config' | 'consent' | 'event',
 * …)` as `arguments` objects) and, like the real script, sends an event only while `analytics_storage` is granted and
 * the property is not disabled (`window['ga-disable-<id>']`, which `setAnalyticsCollectionEnabled(false)` sets). The
 * beacon carries the event name (`en`), its parameters (`ep.<name>`) and the page location (`dl`), nothing else; like
 * the real script, `dl` is the event's `page_location`, else the configured one, else `location.href` with its hash, so
 * a viewer that stopped setting it would leak the visitor's view into the recorded beacons. Like the real script it
 * writes the first-party cookies `_ga` and `_ga_<container>` (host-only on 127.0.0.1, path `/`, two years) once the
 * property is configured with `analytics_storage` granted, and never while it is denied, so the consent specs can check
 * that a withdrawal expires them. Plain ES5 with no `eval`, so the page's CSP runs it as it would run Google's script.
 */
export const GTAG_SCRIPT = `(function () {
  var script = document.currentScript;
  var query = new URLSearchParams(script && script.src.indexOf('?') >= 0 ? script.src.split('?')[1] : '');
  var name = query.get('l') || 'dataLayer';
  var layer = (window[name] = window[name] || []);
  var state = { tid: query.get('id') || '', location: '', granted: false, configured: false };
  var NOT_PARAMETERS = { send_to: true, page_location: true };
  function pageLocation(params) {
    return (params && params.page_location) || state.location || location.href;
  }
  function send(event, params) {
    if (!state.granted || window['ga-disable-' + state.tid] === true) { return; }
    var beacon = new URLSearchParams({ v: '2', tid: state.tid, en: String(event), dl: pageLocation(params) });
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (!NOT_PARAMETERS[key] && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        beacon.set('ep.' + key, String(value));
      }
    });
    fetch('https://region1.google-analytics.com/g/collect?' + beacon.toString(), { method: 'POST', keepalive: true, mode: 'no-cors', credentials: 'omit' });
  }
  function writeCookies() {
    if (!state.granted || !state.configured) { return; }
    var tail = '; Path=/; Max-Age=63072000; SameSite=Lax';
    document.cookie = '_ga=GA1.1.1000000001.1700000000' + tail;
    document.cookie = '_ga_' + state.tid.replace(/^G-/, '') + '=GS1.1.1700000000.1.0.1700000000.0.0.0' + tail;
  }
  function handle(entry) {
    if (!entry || typeof entry.length !== 'number') { return; }
    if (entry[0] === 'config') {
      state.tid = String(entry[1]);
      state.location = (entry[2] && entry[2].page_location) || state.location;
      state.configured = true;
      writeCookies();
    } else if (entry[0] === 'consent' && entry[2]) {
      state.granted = entry[2].analytics_storage === 'granted';
      writeCookies();
    } else if (entry[0] === 'event') {
      send(entry[1], entry[2]);
    }
  }
  for (var index = 0; index < layer.length; index += 1) { handle(layer[index]); }
  var push = layer.push;
  layer.push = function () {
    for (var at = 0; at < arguments.length; at += 1) { handle(arguments[at]); }
    return push.apply(layer, arguments);
  };
})();
`;

/** Firebase's dynamic config for a web app (`GET /v1alpha/projects/-/apps/<appId>/webConfig`). */
export function firebaseWebConfig(appId: string, measurementId: string): Record<string, string> {
    return { appId, measurementId, projectId: 'demo-hcm-e2e' };
}
