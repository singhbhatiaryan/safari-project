/**
 * Content-script relay for the Safari Start Page website.
 *
 * The page cannot talk to the extension directly, so this tiny script bridges
 * window CustomEvents ⇄ chrome.runtime messages. It is deliberately plain ES5-ish
 * JS with zero imports: Chrome loads it as a classic script, so it must be able to
 * run straight from `public/` without a bundler.
 *
 * It only activates on pages that advertise themselves as the start page
 * (`<html data-safari-startpage>`), and it is only injected on the hosts listed in
 * manifest.json (localhost by default — add your own domain there to enable live
 * sync on a hosted copy).
 */
(() => {
  'use strict';

  var MARKER = 'data-safari-startpage';

  // Keep these in sync with shared/src/types.ts
  var EVENTS = {
    LOCAL_CHANGE: 'safari:store-local-change',
    EXTERNAL_CHANGE: 'safari:store-external',
    SYNC_REQUEST: 'safari:sync-request',
    BRIDGE_READY: 'safari:bridge-ready'
  };
  var MESSAGES = {
    HELLO: 'SAFARI_BRIDGE_HELLO',
    PUSH: 'SAFARI_STORE_PUSH',
    APPLY: 'SAFARI_STORE_APPLY',
    PING: 'SAFARI_PING'
  };

  if (!document.documentElement.hasAttribute(MARKER)) return;

  var send = function (message, callback) {
    try {
      chrome.runtime.sendMessage(message, function (reply) {
        // Reading lastError prevents "Unchecked runtime.lastError" noise when the
        // service worker is asleep or the extension was just reloaded.
        void chrome.runtime.lastError;
        if (callback) callback(reply);
      });
    } catch (error) {
      /* extension context invalidated */
    }
  };

  var apply = function (state) {
    if (!state) return;
    window.dispatchEvent(new CustomEvent(EVENTS.EXTERNAL_CHANGE, { detail: { state: state } }));
  };

  var announce = function () {
    window.dispatchEvent(new CustomEvent(EVENTS.BRIDGE_READY));
  };

  window.addEventListener(EVENTS.LOCAL_CHANGE, function (event) {
    var detail = event && event.detail;
    if (detail && detail.state) send({ type: MESSAGES.PUSH, state: detail.state });
  });

  window.addEventListener(EVENTS.SYNC_REQUEST, function () {
    send({ type: MESSAGES.HELLO }, function (reply) {
      if (reply && reply.state) apply(reply.state);
      announce();
    });
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === MESSAGES.APPLY) apply(message.state);
  });

  // Handshake: tell the page the extension is here, then hand it the truth.
  send({ type: MESSAGES.PING });
  announce();
  send({ type: MESSAGES.HELLO }, function (reply) {
    if (reply && reply.state) apply(reply.state);
    announce();
  });
})();
